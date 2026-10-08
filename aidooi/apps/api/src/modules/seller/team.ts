import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { InviteBodySchema, TeamMemberSchema, UpdateMemberBodySchema } from '@aidooi/contracts';
import { recordAudit } from '../../audit.ts';
import { runAs, runAsSystem, type AppContext, type Tx } from '../../context.ts';
import { conflict, notFound } from '../../http/problem.ts';
import { inviteSellerUser } from '../auth/staff.ts';
import { requireOwner } from './common.ts';

type Member = z.infer<typeof TeamMemberSchema>;

const toMember = (r: {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  partner_location_id: string | null;
}): Member => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  role: r.role as Member['role'],
  status: r.status as Member['status'],
  locationId: r.partner_location_id,
});

export async function listTeam(ctx: AppContext, req: FastifyRequest): Promise<Member[]> {
  const seller = requireOwner(req);
  return runAs(ctx, req, async (trx) =>
    (
      await trx
        .selectFrom('identity.seller_user')
        .select(['id', 'email', 'full_name', 'role', 'status', 'partner_location_id'])
        .where('partner_id', '=', seller.partnerId)
        .orderBy('created_at')
        .execute()
    ).map(toMember),
  );
}

/** The invitation reaches the invitee through the notifier; the token is never returned to the inviter. */
export async function invite(
  ctx: AppContext,
  req: FastifyRequest,
  body: z.infer<typeof InviteBodySchema>,
): Promise<Member> {
  const seller = requireOwner(req);
  // Invitation credentials are platform-only rows; the owner check above and the showroom check below are the authorisation.
  const { member, token, userId, expiresAt } = await runAsSystem(ctx, async (trx) => {
    if (body.locationId) {
      const loc = await trx
        .selectFrom('catalogue.partner_location')
        .select('id')
        .where('id', '=', body.locationId)
        .where('partner_id', '=', seller.partnerId)
        .executeTakeFirst();
      if (!loc) throw notFound('Location');
    }
    const inv = await inviteSellerUser(
      trx,
      { clock: ctx.clock, ids: ctx.ids },
      {
        partnerId: seller.partnerId,
        email: body.email,
        fullName: body.fullName,
        role: body.role,
        locationId: body.locationId,
      },
    );
    const row = await trx
      .selectFrom('identity.seller_user')
      .select(['id', 'email', 'full_name', 'role', 'status', 'partner_location_id'])
      .where('id', '=', inv.userId)
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      entityType: 'seller_user',
      entityId: inv.userId,
      from: null,
      to: 'Invited',
      actor: req.actor!,
      data: { role: body.role },
    });
    return {
      member: toMember(row),
      token: inv.inviteToken,
      userId: inv.userId,
      expiresAt: inv.expiresAt,
    };
  });
  await ctx.notifier.send({
    template: 'seller.team_invitation',
    to: { kind: 'partner', id: seller.partnerId },
    data: { email: member.email, inviteToken: token, expiresAt: expiresAt.toISOString() },
    dedupeKey: `seller-invite:${userId}:${expiresAt.getTime()}`,
  });
  return member;
}

/** Active owners other than `excludeId` — the partner must always keep at least one. */
async function otherActiveOwners(trx: Tx, partnerId: string, excludeId: string): Promise<number> {
  const r = await trx
    .selectFrom('identity.seller_user')
    .select((e) => e.fn.countAll<string>().as('n'))
    .where('partner_id', '=', partnerId)
    .where('role', '=', 'seller_owner')
    .where('status', '=', 'Active')
    .where('id', '!=', excludeId)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

export async function updateMember(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  body: z.infer<typeof UpdateMemberBodySchema>,
): Promise<Member> {
  const seller = requireOwner(req);
  return runAs(ctx, req, async (trx) => {
    const target = await trx
      .selectFrom('identity.seller_user')
      .selectAll()
      .where('id', '=', id)
      .where('partner_id', '=', seller.partnerId)
      .forUpdate()
      .executeTakeFirst();
    if (!target) throw notFound('Team member');
    if (body.status === 'Active' && target.status === 'Invited')
      throw conflict('invitation_pending', 'This person has not accepted their invitation yet.');

    const wasActiveOwner = target.role === 'seller_owner' && target.status === 'Active';
    const demoted = body.role !== undefined && body.role !== 'seller_owner';
    const disabled = body.status === 'Disabled';
    if (
      wasActiveOwner &&
      (demoted || disabled) &&
      (await otherActiveOwners(trx, seller.partnerId, id)) === 0
    ) {
      throw conflict(
        'last_owner',
        'A partner must keep at least one active owner. Make someone else an owner first.',
      );
    }
    if (body.locationId) {
      const loc = await trx
        .selectFrom('catalogue.partner_location')
        .select('id')
        .where('id', '=', body.locationId)
        .where('partner_id', '=', seller.partnerId)
        .executeTakeFirst();
      if (!loc) throw notFound('Location');
    }
    const row = await trx
      .updateTable('identity.seller_user')
      .set({
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.locationId !== undefined ? { partner_location_id: body.locationId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      })
      .where('id', '=', id)
      .returning(['id', 'email', 'full_name', 'role', 'status', 'partner_location_id'])
      .executeTakeFirstOrThrow();
    if (disabled && target.status !== 'Disabled') {
      // Access ends now, not when the access token happens to expire: end every login of this person.
      await trx
        .updateTable('identity.refresh_token_family')
        .set({ revoked_at: new Date(ctx.clock.now()), revoked_reason: 'admin' })
        .where('seller_user_id', '=', id)
        .where('revoked_at', 'is', null)
        .execute();
    }
    await recordAudit(trx, {
      entityType: 'seller_user',
      entityId: id,
      from: target.status,
      to: row.status,
      actor: req.actor!,
      data: {
        before: { role: target.role, locationId: target.partner_location_id },
        after: { role: row.role, locationId: row.partner_location_id },
      },
    });
    return toMember(row);
  });
}
