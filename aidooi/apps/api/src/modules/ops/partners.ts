import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type {
  CreatePartnerBodySchema,
  OpsPartnerSchema,
  OwnerInvitationBodySchema,
  PartnerListQuerySchema,
  PartnerTransitionBodySchema,
  PatchPartnerBodySchema,
} from '@aidooi/contracts';
import type { DB } from '@aidooi/db';
import { assertTransition, partnerStatus, type PartnerStatus } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAs, runAsSystem, type AppContext, type Tx } from '../../context.ts';
import { forbidden, HttpError, notFound } from '../../http/problem.ts';
import { decodeCursor, pageOf } from '../../http/pagination.ts';
import { inviteSellerUser } from '../auth/staff.ts';
import { before, iso } from './cursors.ts';
import { guard, ROLES } from './guard.ts';

type PartnerRow = Selectable<DB['catalogue.partner']>;
type Partner = z.infer<typeof OpsPartnerSchema>;

const bpsOf = (rate: string | number): number => Math.round(Number(rate) * 10_000);

const dto = (r: PartnerRow): Partner => ({
  id: r.id,
  code: r.code,
  legalName: r.legal_name,
  tradeName: r.trade_name,
  taxRegistrationNo: r.tax_registration_no,
  status: r.status as PartnerStatus,
  commissionBps: bpsOf(r.commission_rate),
  afterSalesTerms: r.after_sales_terms,
  contactEmail: r.contact_email,
  contactPhone: r.contact_phone,
  activatedAt: r.activated_at ? iso(r.activated_at) : null,
  createdAt: iso(r.created_at),
});

async function load(trx: Tx, id: string, lock = false): Promise<PartnerRow> {
  let q = trx.selectFrom('catalogue.partner').selectAll().where('id', '=', id);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw notFound('Partner');
  return row;
}

export async function listPartners(
  ctx: AppContext,
  req: FastifyRequest,
  q: z.infer<typeof PartnerListQuerySchema>,
) {
  guard(req, [...ROLES.catalogueRead, ...ROLES.deskRead]);
  const cursor = decodeCursor(q.cursor);
  return runAs(ctx, req, async (trx) => {
    let query = trx
      .selectFrom('catalogue.partner')
      .selectAll()
      .select(sql<string>`created_at::text`.as('ct'))
      .where(before('created_at', 'id', cursor));
    if (q.status) query = query.where('status', '=', q.status);
    if (q.search) {
      const like = `%${q.search.replace(/[%_\\]/g, '\\$&')}%`;
      query = query.where((e) =>
        e.or([
          e('trade_name', 'ilike', like),
          e('legal_name', 'ilike', like),
          e('code', 'ilike', like),
        ]),
      );
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(q.limit + 1)
      .execute();
    const page = pageOf(rows, q.limit, (r) => ({ t: r.ct, id: r.id }));
    return { items: page.items.map(dto), nextCursor: page.nextCursor };
  });
}

export async function getPartner(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<Partner> {
  guard(req, [...ROLES.catalogueRead, ...ROLES.deskRead]);
  return runAs(ctx, req, async (trx) => dto(await load(trx, id)));
}

export async function createPartner(
  ctx: AppContext,
  req: FastifyRequest,
  b: z.infer<typeof CreatePartnerBodySchema>,
): Promise<Partner> {
  guard(req, ROLES.catalogueWrite);
  return runAs(ctx, req, async (trx) => {
    // Codes are PRT-#### in creation order. The lock makes "next" safe under concurrent creates.
    await sql`SELECT pg_advisory_xact_lock(7243092)`.execute(trx);
    const { n } = await trx
      .selectFrom('catalogue.partner')
      .select(sql<number>`coalesce(max(substr(code, 5)::int), 0) + 1`.as('n'))
      .executeTakeFirstOrThrow();
    const row = await trx
      .insertInto('catalogue.partner')
      .values({
        code: `PRT-${String(n).padStart(4, '0')}`,
        legal_name: b.legalName,
        trade_name: b.tradeName,
        tax_registration_no: b.taxRegistrationNo,
        commission_rate: b.commissionBps / 10_000,
        after_sales_terms: b.afterSalesTerms,
        contact_email: b.contactEmail,
        contact_phone: b.contactPhone,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      entityType: 'partner',
      entityId: row.id,
      from: null,
      to: 'Requested',
      actor: req.actor!,
      data: { code: row.code },
    });
    return dto(row);
  });
}

/**
 * Ops-owned partner fields. A commission change moves the partner's *offers* to the new rate, which
 * is what future orders snapshot; every order line already placed keeps the rate it was sold at
 * (order lines are write-once, ADR-022), so settlement of past sales never shifts.
 */
export async function patchPartner(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  b: z.infer<typeof PatchPartnerBodySchema>,
): Promise<Partner> {
  guard(req, ROLES.catalogueWrite);
  return runAs(ctx, req, async (trx) => {
    const before = await load(trx, id, true);
    const set: Partial<PartnerRow> = {};
    if (b.legalName !== undefined) set.legal_name = b.legalName;
    if (b.tradeName !== undefined) set.trade_name = b.tradeName;
    if (b.taxRegistrationNo !== undefined) set.tax_registration_no = b.taxRegistrationNo;
    if (b.afterSalesTerms !== undefined) set.after_sales_terms = b.afterSalesTerms;
    if (b.contactEmail !== undefined) set.contact_email = b.contactEmail;
    if (b.contactPhone !== undefined) set.contact_phone = b.contactPhone;
    if (b.commissionBps !== undefined) set.commission_rate = String(b.commissionBps / 10_000);
    const row = await trx
      .updateTable('catalogue.partner')
      .set(set)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (b.commissionBps !== undefined && b.commissionBps !== bpsOf(before.commission_rate)) {
      await trx
        .updateTable('catalogue.seller_offer')
        .set({ commission_rate: b.commissionBps / 10_000 })
        .where('partner_id', '=', id)
        .execute();
      await recordAudit(trx, {
        entityType: 'partner',
        entityId: id,
        from: before.status,
        to: row.status,
        actor: req.actor!,
        reason: 'commission changed',
        data: { fromBps: bpsOf(before.commission_rate), toBps: b.commissionBps },
      });
    } else {
      await recordAudit(trx, {
        entityType: 'partner',
        entityId: id,
        from: before.status,
        to: row.status,
        actor: req.actor!,
        reason: 'details updated',
        data: { fields: Object.keys(b) },
      });
    }
    return dto(row);
  });
}

const UNDELIVERED = ['Confirmed', 'Preparing', 'Ready for Dispatch', 'Dispatched'];

/** What must be true before a partner may trade (AID-LOG-013), each with a stable key and whether it holds. */
export const ACTIVATION_CHECKS = [
  { key: 'location', label: 'at least one active location' },
  { key: 'owner', label: 'an invited owner' },
  { key: 'commission', label: 'a commission rate' },
  { key: 'afterSales', label: 'after-sales terms' },
] as const;

async function activationChecklist(trx: Tx, p: PartnerRow): Promise<Record<string, boolean>> {
  const loc = await trx
    .selectFrom('catalogue.partner_location')
    .select((e) => e.fn.countAll<string>().as('n'))
    .where('partner_id', '=', p.id)
    .where('status', '=', 'Active')
    .executeTakeFirstOrThrow();
  const owner = await trx
    .selectFrom('identity.seller_user')
    .select((e) => e.fn.countAll<string>().as('n'))
    .where('partner_id', '=', p.id)
    .where('role', '=', 'seller_owner')
    .where('status', 'in', ['Invited', 'Active'])
    .executeTakeFirstOrThrow();
  return {
    location: Number(loc.n) > 0,
    owner: Number(owner.n) > 0,
    commission: Number(p.commission_rate) > 0,
    afterSales: Boolean(p.after_sales_terms?.trim()),
  };
}

/** Every unmet condition, in words. */
async function activationProblems(trx: Tx, p: PartnerRow): Promise<string[]> {
  const met = await activationChecklist(trx, p);
  return ACTIVATION_CHECKS.filter((c) => !met[c.key]).map((c) => c.label);
}

/** The checklist as the console shows it: each condition and whether it holds right now. */
export async function partnerActivationChecklist(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<{
  items: { key: (typeof ACTIVATION_CHECKS)[number]['key']; met: boolean }[];
  ready: boolean;
}> {
  guard(req, [...ROLES.catalogueRead, ...ROLES.deskRead]);
  return runAsSystem(
    ctx,
    async (trx) => {
      const met = await activationChecklist(trx, await load(trx, id, false));
      const items = ACTIVATION_CHECKS.map((c) => ({ key: c.key, met: Boolean(met[c.key]) }));
      return { items, ready: items.every((i) => i.met) };
    },
    req.id,
  );
}

export async function transitionPartner(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  b: z.infer<typeof PartnerTransitionBodySchema>,
): Promise<Partner> {
  const actor = guard(req, ROLES.catalogueWrite);
  const gate = b.to === 'Active' || b.to === 'Inactive';
  if (gate && actor.role !== 'ops_admin')
    throw forbidden('Only an administrator can activate or deactivate a partner.');
  if (b.force && actor.role !== 'ops_admin')
    throw forbidden('Only an administrator can force a deactivation.');

  return runAsSystem(
    ctx,
    async (trx) => {
      const p = await load(trx, id, true);
      assertTransition(partnerStatus, p.status as PartnerStatus, b.to);
      if (b.to === 'Active') {
        const problems = await activationProblems(trx, p);
        if (problems.length > 0) {
          throw new HttpError(
            422,
            'activation_preconditions',
            `Cannot activate: needs ${problems.join(', ')}.`,
          );
        }
      }
      if (b.to === 'Inactive') {
        const open = await trx
          .selectFrom('fulfilment.order_line')
          .select((e) => e.fn.countAll<string>().as('n'))
          .where('partner_id', '=', id)
          .where('state', 'in', UNDELIVERED)
          .executeTakeFirstOrThrow();
        if (Number(open.n) > 0 && !b.force) {
          throw new HttpError(
            409,
            'undelivered_lines',
            `${open.n} order line(s) are still undelivered. Resolve them, or force with a reason.`,
          );
        }
      }
      const row = await trx
        .updateTable('catalogue.partner')
        .set({
          status: b.to,
          ...(b.to === 'Active' && !p.activated_at
            ? { activated_at: new Date(ctx.clock.now()) }
            : {}),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordAudit(trx, {
        entityType: 'partner',
        entityId: id,
        from: p.status,
        to: b.to,
        actor,
        reason: b.reason,
        data: b.force ? { forced: true } : {},
      });
      return row;
    },
    req.id,
  ).then(dto);
}

export async function inviteOwner(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  b: z.infer<typeof OwnerInvitationBodySchema>,
) {
  guard(req, ROLES.catalogueWrite);
  const invitation = await runAsSystem(
    ctx,
    async (trx) => {
      const p = await load(trx, id);
      if (p.status === 'Inactive')
        throw new HttpError(
          409,
          'partner_inactive',
          'Reactivate the partner before inviting users.',
        );
      const inv = await inviteSellerUser(
        trx,
        { clock: ctx.clock, ids: ctx.ids },
        {
          partnerId: id,
          email: b.email,
          fullName: b.fullName,
          role: 'seller_owner',
          locationId: b.locationId,
          phone: b.phone,
        },
      );
      await recordAudit(trx, {
        entityType: 'seller_user',
        entityId: inv.userId,
        from: null,
        to: 'Invited',
        actor: req.actor!,
        data: { partnerId: id },
      });
      return inv;
    },
    req.id,
  );
  // The token leaves the system only through the notifier; the API response never carries it.
  await ctx.notifier.send({
    template: 'partner.owner_invited',
    to: { kind: 'partner', id },
    data: { email: b.email.toLowerCase(), inviteToken: invitation.inviteToken },
    dedupeKey: `invite:${invitation.userId}:${invitation.expiresAt.getTime()}`,
  });
  return { userId: invitation.userId, expiresAt: invitation.expiresAt.toISOString() };
}

export async function partnerTeam(ctx: AppContext, req: FastifyRequest, id: string) {
  guard(req, ROLES.catalogueRead);
  // Credentials are readable only by the platform actor (identity RLS), hence the system role after the role check.
  return runAsSystem(
    ctx,
    async (trx) => {
      await load(trx, id);
      const rows = await trx
        .selectFrom('identity.seller_user as u')
        .leftJoin('identity.staff_credential as c', 'c.seller_user_id', 'u.id')
        .select(['u.id', 'u.email', 'u.full_name', 'u.role', 'u.status', 'c.totp_confirmed_at'])
        .where('u.partner_id', '=', id)
        .orderBy('u.created_at')
        .execute();
      return {
        members: rows.map((r) => ({
          id: r.id,
          email: r.email,
          fullName: r.full_name,
          role: r.role as 'seller_owner' | 'seller_manager' | 'seller_staff',
          status: r.status as 'Invited' | 'Active' | 'Disabled',
          mfaEnrolled: r.totp_confirmed_at !== null,
        })),
      };
    },
    req.id,
  );
}
