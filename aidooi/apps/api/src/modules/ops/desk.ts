import { sql, type Kysely, type Transaction } from 'kysely';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type {
  OpsOrderQuerySchema,
  OpsViewingQuerySchema,
  OrderNoteBodySchema,
} from '@aidooi/contracts';
import type { DB } from '@aidooi/db';
import type { MasterStatus } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAs, type AppContext } from '../../context.ts';
import { decodeCursor, pageOf } from '../../http/pagination.ts';
import { notFound } from '../../http/problem.ts';
import { before, iso } from './cursors.ts';
import { guard, ROLES } from './guard.ts';

type Q = Kysely<DB> | Transaction<DB>;

/**
 * Per-order status in SQL, the same rule as the domain's `masterStatus` (a parity test keeps them
 * equal): lines that are Cancelled or Refunded do not count; an open issue wins; then Completed,
 * Confirmed, else In Progress.
 */
const statusSql = sql<MasterStatus>`(
  SELECT CASE
    WHEN count(*) FILTER (WHERE l.state NOT IN ('Cancelled', 'Refunded')) = 0 THEN 'Cancelled'
    WHEN count(*) FILTER (WHERE l.state NOT IN ('Cancelled', 'Refunded') AND EXISTS (
           SELECT 1 FROM fulfilment.issue i WHERE i.order_line_id = l.id AND i.state IN ('Open', 'Partner Handling'))) > 0 THEN 'Issue Reported'
    WHEN count(*) FILTER (WHERE l.state NOT IN ('Cancelled', 'Refunded') AND l.state <> 'Receipt Confirmed') = 0 THEN 'Completed'
    WHEN count(*) FILTER (WHERE l.state NOT IN ('Cancelled', 'Refunded') AND l.state <> 'Confirmed') = 0 THEN 'Confirmed'
    ELSE 'In Progress' END
  FROM fulfilment.order_line l WHERE l.master_order_id = mo.id)`;

/** Reading a person's data is itself an auditable event; the audit row never contains the data. */
async function auditPiiRead(
  trx: Transaction<DB>,
  req: FastifyRequest,
  entityType: string,
  entityId: string,
  fields: string[],
) {
  await recordAudit(trx, {
    entityType: 'pii_read',
    entityId: `${entityType}:${entityId}`,
    from: null,
    to: 'read',
    actor: req.actor!,
    data: { fields },
  });
}

const digits = (s: string) => s.replace(/\D/g, '');

export async function listOrders(
  ctx: AppContext,
  req: FastifyRequest,
  q: z.infer<typeof OpsOrderQuerySchema>,
) {
  guard(req, ROLES.deskRead);
  const cursor = decodeCursor(q.cursor);
  return runAs(ctx, req, async (trx) => {
    let query = trx
      .selectFrom('commerce.master_order as mo')
      .select(['mo.id', 'mo.customer_id', 'mo.gross_fils', 'mo.paid_fils', 'mo.placed_at'])
      .select(sql<string>`mo.placed_at::text`.as('pt'))
      .select(statusSql.as('status'))
      .select(
        sql<string>`(SELECT count(*) FROM fulfilment.order_line l WHERE l.master_order_id = mo.id)`.as(
          'line_count',
        ),
      )
      .where(before('mo.placed_at', 'mo.id', cursor));
    if (q.partnerId)
      query = query.where(
        sql<boolean>`EXISTS (SELECT 1 FROM commerce.seller_order so WHERE so.master_order_id = mo.id AND so.partner_id = ${q.partnerId}::uuid)`,
      );
    if (q.status) query = query.where(sql<boolean>`${statusSql} = ${q.status}`);
    if (q.search) {
      const s = q.search.trim();
      const d = digits(s);
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
        query = query.where('mo.id', '=', s.toLowerCase());
      } else {
        // Customer lookup by exact email, exact phone, or the last digits of a phone (what a caller reads out).
        query = query.where(
          sql<boolean>`mo.customer_id IN (SELECT c.id FROM identity.customer c WHERE c.email = ${s.toLowerCase()}
            OR c.phone_e164 = ${s.startsWith('+') ? `+${d}` : s}
            OR (${d.length >= 4} AND c.phone_e164 LIKE ${'%' + d}))`,
        );
        await auditPiiRead(trx, req, 'order_search', 'customer', ['phone', 'email']);
      }
    }
    const rows = await query
      .orderBy('mo.placed_at', 'desc')
      .orderBy('mo.id', 'desc')
      .limit(q.limit + 1)
      .execute();
    const page = pageOf(rows, q.limit, (r) => ({ t: r.pt, id: r.id }));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        placedAt: iso(r.placed_at),
        customerId: r.customer_id,
        grossFils: Number(r.gross_fils),
        paidFils: Number(r.paid_fils),
        status: r.status,
        lineCount: Number(r.line_count),
      })),
      nextCursor: page.nextCursor,
    };
  });
}

export async function orderDetail(ctx: AppContext, req: FastifyRequest, id: string) {
  guard(req, ROLES.deskRead);
  return runAs(ctx, req, async (trx) => {
    const mo = await trx
      .selectFrom('commerce.master_order as mo')
      .selectAll('mo')
      .select(statusSql.as('status'))
      .where('mo.id', '=', id)
      .executeTakeFirst();
    if (!mo) throw notFound('Order');
    const [delivery, sellerOrders, lines, payment, notes] = await Promise.all([
      trx
        .selectFrom('commerce.order_delivery')
        .selectAll()
        .where('master_order_id', '=', id)
        .executeTakeFirst(),
      trx
        .selectFrom('commerce.seller_order as so')
        .innerJoin('catalogue.partner as p', 'p.id', 'so.partner_id')
        .select(['so.id', 'so.partner_id', 'p.trade_name', 'so.subtotal_fils'])
        .where('so.master_order_id', '=', id)
        .execute(),
      trx
        .selectFrom('fulfilment.order_line')
        .selectAll()
        .where('master_order_id', '=', id)
        .orderBy('created_at')
        .orderBy('id')
        .execute(),
      mo.payment_id
        ? trx
            .selectFrom('commerce.payment')
            .selectAll()
            .where('id', '=', mo.payment_id)
            .executeTakeFirst()
        : Promise.resolve(undefined),
      trx
        .selectFrom('commerce.order_note')
        .selectAll()
        .where('master_order_id', '=', id)
        .orderBy('created_at')
        .execute(),
    ]);
    const refunds = mo.payment_id
      ? await trx
          .selectFrom('commerce.refund')
          .selectAll()
          .where('payment_id', '=', mo.payment_id)
          .orderBy('created_at')
          .execute()
      : [];
    const refIds = [id, ...lines.map((l) => l.id), ...refunds.map((r) => r.id)];
    const ledger = await trx
      .selectFrom('commerce.ledger_entry')
      .selectAll()
      .where('ref_id', 'in', refIds)
      .orderBy('at')
      .orderBy('id')
      .execute();
    const auditIds = [id, ...lines.map((l) => l.id), ...(payment ? [payment.id] : [])];
    const audit = await trx
      .selectFrom('audit.event')
      .select(['at', 'entity_type', 'entity_id', 'from_state', 'to_state', 'actor_type', 'reason'])
      .where('entity_id', 'in', auditIds)
      .where('entity_type', '<>', 'pii_read')
      .orderBy('at')
      .limit(300)
      .execute();
    await auditPiiRead(trx, req, 'master_order', id, ['delivery']);

    return {
      order: {
        id: mo.id,
        placedAt: iso(mo.placed_at),
        customerId: mo.customer_id,
        grossFils: Number(mo.gross_fils),
        paidFils: Number(mo.paid_fils),
        status: mo.status,
        lineCount: lines.length,
        depositCreditFils: Number(mo.deposit_credit_fils),
        viewingRequestId: mo.viewing_request_id,
      },
      delivery: delivery
        ? {
            recipientName: delivery.recipient_name,
            phone: delivery.phone_e164,
            line1: delivery.line1,
            line2: delivery.line2,
            area: delivery.area,
            emirate: delivery.emirate,
            instructions: delivery.instructions,
          }
        : null,
      sellerOrders: sellerOrders.map((s) => ({
        id: s.id,
        partnerId: s.partner_id,
        tradeName: s.trade_name,
        subtotalFils: Number(s.subtotal_fils),
      })),
      lines: lines.map((l) => ({
        id: l.id,
        sellerOrderId: l.seller_order_id,
        productId: l.product_id,
        productName: String((l.snapshot as { productName?: string }).productName ?? ''),
        quantity: l.quantity,
        unitPriceFils: Number(l.unit_price_fils),
        grossLineFils: Number(l.gross_line_fils),
        commissionFils: Number(l.commission_fils),
        state: l.state,
        settlementState: l.settlement_state,
      })),
      payment: payment
        ? {
            id: payment.id,
            state: payment.state,
            amountFils: Number(payment.amount_fils),
            providerRef: payment.provider_ref,
          }
        : null,
      refunds: refunds.map((r) => ({
        id: r.id,
        amountFils: Number(r.amount_fils),
        state: r.state,
        reason: r.reason,
        orderLineId: r.order_line_id,
      })),
      ledger: ledger.map((e) => ({
        entryGroup: e.entry_group,
        at: iso(e.at),
        account: e.account,
        direction: e.direction as 'debit' | 'credit',
        amountFils: Number(e.amount_fils),
        memo: e.memo,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        opsUserId: n.ops_user_id,
        body: n.body,
        createdAt: iso(n.created_at),
      })),
      audit: audit.map((a) => ({
        at: iso(a.at),
        entityType: a.entity_type,
        entityId: a.entity_id,
        fromState: a.from_state,
        toState: a.to_state,
        actorType: a.actor_type,
        reason: a.reason,
      })),
    };
  });
}

export async function addOrderNote(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  b: z.infer<typeof OrderNoteBodySchema>,
) {
  const actor = guard(req, ROLES.deskWrite);
  return runAs(ctx, req, async (trx) => {
    const exists = await trx
      .selectFrom('commerce.master_order')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!exists) throw notFound('Order');
    const n = await trx
      .insertInto('commerce.order_note')
      .values({ master_order_id: id, ops_user_id: actor.opsUserId, body: b.body })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      entityType: 'order_note',
      entityId: n.id,
      from: null,
      to: 'added',
      actor,
      data: { orderId: id },
    });
    return { id: n.id, opsUserId: n.ops_user_id, body: n.body, createdAt: iso(n.created_at) };
  });
}

const maskPhone = (p: string | null) =>
  p ? `${p.slice(0, 4)}${'*'.repeat(Math.max(0, p.length - 7))}${p.slice(-3)}` : null;
const maskEmail = (e: string | null) => {
  if (!e) return null;
  const [user = '', domain = ''] = e.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
};

export async function customerSummary(ctx: AppContext, req: FastifyRequest, id: string) {
  guard(req, ROLES.deskRead);
  return runAs(ctx, req, async (trx) => {
    const c = await trx
      .selectFrom('identity.customer')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!c) throw notFound('Customer');
    const n = await trx
      .selectFrom('commerce.master_order')
      .select((e) => e.fn.countAll<string>().as('n'))
      .where('customer_id', '=', id)
      .executeTakeFirstOrThrow();
    await auditPiiRead(trx, req, 'customer', id, ['name', 'phone', 'email']);
    return {
      id: c.id,
      status: c.status as 'Active' | 'Erased',
      locale: c.locale as 'en' | 'ar',
      fullName: c.full_name,
      phoneMasked: maskPhone(c.phone_e164),
      emailMasked: maskEmail(c.email),
      createdAt: iso(c.created_at),
      orderCount: Number(n.n),
    };
  });
}

const viewingSelect = (trx: Q) =>
  trx
    .selectFrom('viewing.viewing_request as r')
    .leftJoin('viewing.viewing_deposit as d', 'd.viewing_request_id', 'r.id')
    .select([
      'r.id',
      'r.state',
      'r.customer_id',
      'r.scheduled_at',
      'r.created_at',
      'd.amount_fils',
      'd.state as deposit_state',
    ])
    .select(sql<string>`r.created_at::text`.as('ct'))
    .select(
      sql<string>`(SELECT count(*) FROM viewing.viewing_stop s WHERE s.viewing_request_id = r.id)`.as(
        'stop_count',
      ),
    );

const viewingDto = (
  r: Awaited<ReturnType<ReturnType<typeof viewingSelect>['execute']>>[number],
) => ({
  id: r.id,
  state: r.state,
  customerId: r.customer_id,
  scheduledAt: r.scheduled_at ? iso(r.scheduled_at) : null,
  createdAt: iso(r.created_at),
  stopCount: Number(r.stop_count),
  depositFils: r.amount_fils === null ? null : Number(r.amount_fils),
  depositState: r.deposit_state,
});

export async function listViewings(
  ctx: AppContext,
  req: FastifyRequest,
  q: z.infer<typeof OpsViewingQuerySchema>,
) {
  guard(req, ROLES.deskRead);
  const cursor = decodeCursor(q.cursor);
  return runAs(ctx, req, async (trx) => {
    let query = viewingSelect(trx).where(before('r.created_at', 'r.id', cursor));
    if (q.state) query = query.where('r.state', '=', q.state);
    if (q.partnerId)
      query = query.where(
        sql<boolean>`EXISTS (SELECT 1 FROM viewing.viewing_stop s WHERE s.viewing_request_id = r.id AND s.partner_id = ${q.partnerId}::uuid)`,
      );
    const rows = await query
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id', 'desc')
      .limit(q.limit + 1)
      .execute();
    const page = pageOf(rows, q.limit, (r) => ({ t: r.ct, id: r.id }));
    return { items: page.items.map(viewingDto), nextCursor: page.nextCursor };
  });
}

export async function viewingDetail(ctx: AppContext, req: FastifyRequest, id: string) {
  guard(req, ROLES.deskRead);
  return runAs(ctx, req, async (trx) => {
    const r = await viewingSelect(trx).where('r.id', '=', id).executeTakeFirst();
    if (!r) throw notFound('Viewing');
    const stops = await trx
      .selectFrom('viewing.viewing_stop as s')
      .innerJoin('catalogue.partner as p', 'p.id', 's.partner_id')
      .select(['s.id', 's.partner_id', 'p.trade_name', 's.confirmation_state'])
      .where('s.viewing_request_id', '=', id)
      .orderBy('s.stop_no')
      .execute();
    const products = await trx
      .selectFrom('viewing.viewing_product')
      .selectAll()
      .where('stop_id', 'in', stops.map((s) => s.id).concat('00000000-0000-0000-0000-000000000000'))
      .execute();
    const attribution = await trx
      .selectFrom('viewing.attribution_event')
      .select(['stage', 'at'])
      .where('viewing_request_id', '=', id)
      .orderBy('at')
      .execute();
    return {
      ...viewingDto(r),
      stops: stops.map((s) => ({
        id: s.id,
        partnerId: s.partner_id,
        tradeName: s.trade_name,
        confirmationState: s.confirmation_state,
        products: products
          .filter((p) => p.stop_id === s.id)
          .map((p) => ({
            offerId: p.offer_id,
            productId: p.product_id,
            quantity: p.quantity,
            unitPriceFils: Number(p.unit_price_fils),
          })),
      })),
      attribution: attribution.map((a) => ({ stage: a.stage, at: iso(a.at) })),
    };
  });
}
