import { sql } from 'kysely';
import { masterStatus, type OrderLineState } from '@aidooi/domain';
import type { BuyerOrder, IssueView, SellerLine } from '@aidooi/contracts';
import type { Tx } from '../../context.ts';
import { decodeCursor, pageOf } from '../../http/pagination.ts';

const iso = (d: Date | string | null): string | null =>
  d === null ? null : new Date(d).toISOString();
const LIVE = ['Open', 'Partner Handling'] as const;

/** Buyer view of their orders: one order per checkout, lines grouped, the seller split hidden. */
export async function buyerOrders(
  trx: Tx,
  customerId: string,
  opts: { limit: number; cursor?: string | undefined; orderId?: string },
) {
  const cursor = decodeCursor(opts.cursor);
  let q = trx
    .selectFrom('commerce.master_order')
    .select([
      'id',
      'payment_id',
      'gross_fils',
      'deposit_credit_fils',
      'paid_fils',
      'placed_at',
      sql<string>`placed_at::text`.as('placed_text'),
    ])
    .where('customer_id', '=', customerId)
    .orderBy('placed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(opts.limit + 1);
  if (opts.orderId) q = q.where('id', '=', opts.orderId);
  if (cursor)
    q = q.where(sql<boolean>`(placed_at, id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
  const all = await q.execute();
  const page = pageOf(all, opts.limit, (o) => ({ t: o.placed_text, id: o.id }));
  const orders = page.items;
  if (orders.length === 0) return { items: [] as BuyerOrder[], nextCursor: page.nextCursor };

  const ids = orders.map((o) => o.id);
  const lines = await trx
    .selectFrom('fulfilment.order_line as l')
    .innerJoin('catalogue.product as p', 'p.id', 'l.product_id')
    .select([
      'l.id',
      'l.master_order_id',
      'l.product_id',
      'p.name as product_name',
      'l.quantity',
      'l.unit_price_fils',
      'l.gross_line_fils',
      'l.state',
      'l.delivered_at',
      'l.receipt_confirmed_at',
      sql<number | null>`(l.snapshot ->> 'deliveryDays')::int`.as('delivery_days'),
    ])
    .where('l.master_order_id', 'in', ids)
    .orderBy('l.created_at')
    .orderBy('l.id')
    .execute();
  const issues = lines.length
    ? await trx
        .selectFrom('fulfilment.issue')
        .select(['id', 'order_line_id', 'flag', 'state'])
        .where(
          'order_line_id',
          'in',
          lines.map((l) => l.id),
        )
        .where('state', 'in', [...LIVE])
        .execute()
    : [];
  const paymentIds = orders.map((o) => o.payment_id).filter((x): x is string => x !== null);
  const payments = paymentIds.length
    ? await trx
        .selectFrom('commerce.payment')
        .select(['id', 'state', 'captured_at'])
        .where('id', 'in', paymentIds)
        .execute()
    : [];

  const items = orders.map((o): BuyerOrder => {
    const ls = lines.filter((l) => l.master_order_id === o.id);
    const lineViews = ls.map((l) => ({
      id: l.id,
      productId: l.product_id,
      productName: l.product_name,
      quantity: l.quantity,
      unitPriceFils: l.unit_price_fils,
      grossLineFils: l.gross_line_fils,
      state: l.state as OrderLineState,
      deliveredAt: iso(l.delivered_at),
      receiptConfirmedAt: iso(l.receipt_confirmed_at),
      openIssues: issues
        .filter((i) => i.order_line_id === l.id)
        .map((i) => ({
          id: i.id,
          flag: i.flag as IssueView['flag'],
          state: i.state as IssueView['state'],
        })),
    }));
    const days = ls.map((l) => l.delivery_days).filter((d): d is number => d !== null);
    const pay = payments.find((p) => p.id === o.payment_id);
    return {
      id: o.id,
      placedAt: new Date(o.placed_at).toISOString(),
      status: masterStatus(
        lineViews.map((l) => ({ state: l.state, openIssues: l.openIssues.length })),
      ),
      grossFils: o.gross_fils,
      depositCreditFils: o.deposit_credit_fils,
      paidFils: o.paid_fils,
      payment: pay ? { state: pay.state, capturedAt: iso(pay.captured_at) } : null,
      estimatedDeliveryBy: days.length
        ? new Date(new Date(o.placed_at).getTime() + Math.max(...days) * 86_400_000).toISOString()
        : null,
      lines: lineViews,
    };
  });
  return { items, nextCursor: page.nextCursor };
}

export async function sellerLines(
  trx: Tx,
  partnerId: string,
  opts: { state?: string | undefined; limit: number; cursor?: string | undefined },
) {
  const cursor = decodeCursor(opts.cursor);
  let q = trx
    .selectFrom('fulfilment.order_line as l')
    .innerJoin('catalogue.product as p', 'p.id', 'l.product_id')
    .leftJoin('commerce.order_delivery as d', 'd.master_order_id', 'l.master_order_id')
    .select([
      'l.id',
      'l.master_order_id',
      'l.product_id',
      'p.name as product_name',
      'l.quantity',
      'l.unit_price_fils',
      'l.gross_line_fils',
      'l.state',
      'l.created_at',
      sql<string>`l.created_at::text`.as('created_text'),
      'l.delivered_at',
      sql<number>`(SELECT count(*) FROM fulfilment.issue i WHERE i.order_line_id = l.id AND i.state IN ('Open','Partner Handling'))::int`.as(
        'open_issues',
      ),
      'd.recipient_name',
      'd.phone_e164',
      'd.line1',
      'd.line2',
      'd.area',
      'd.emirate',
      'd.instructions',
    ])
    .where('l.partner_id', '=', partnerId)
    .orderBy('l.created_at', 'desc')
    .orderBy('l.id', 'desc')
    .limit(opts.limit + 1);
  if (opts.state) q = q.where('l.state', '=', opts.state);
  if (cursor)
    q = q.where(
      sql<boolean>`(l.created_at, l.id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`,
    );
  const rows = await q.execute();
  const page = pageOf(rows, opts.limit, (r) => ({ t: r.created_text, id: r.id }));
  return {
    items: page.items.map((r): SellerLine => ({
      id: r.id,
      orderId: r.master_order_id,
      productId: r.product_id,
      productName: r.product_name,
      quantity: r.quantity,
      unitPriceFils: r.unit_price_fils,
      grossLineFils: r.gross_line_fils,
      state: r.state as OrderLineState,
      createdAt: new Date(r.created_at).toISOString(),
      deliveredAt: iso(r.delivered_at),
      openIssues: r.open_issues,
      delivery: r.recipient_name
        ? {
            recipientName: r.recipient_name,
            phone: r.phone_e164 as string,
            line1: r.line1 as string,
            line2: r.line2,
            area: r.area,
            emirate: r.emirate as string,
            instructions: r.instructions,
          }
        : null,
    })),
    nextCursor: page.nextCursor,
  };
}

export async function listIssues(
  trx: Tx,
  scope: { partnerId?: string },
  opts: { state?: string | undefined; limit: number; cursor?: string | undefined },
) {
  const cursor = decodeCursor(opts.cursor);
  let q = trx
    .selectFrom('fulfilment.issue as i')
    .innerJoin('fulfilment.order_line as l', 'l.id', 'i.order_line_id')
    .innerJoin('catalogue.product as p', 'p.id', 'l.product_id')
    .select([
      'i.id',
      'i.order_line_id',
      'i.flag',
      'i.state',
      'i.note',
      'i.raised_at',
      sql<string>`i.raised_at::text`.as('raised_text'),
      'i.resolved_at',
      'i.resolution_note',
      'p.name as product_name',
    ])
    .orderBy('i.raised_at', 'desc')
    .orderBy('i.id', 'desc')
    .limit(opts.limit + 1);
  if (scope.partnerId) q = q.where('i.partner_id', '=', scope.partnerId);
  if (opts.state) q = q.where('i.state', '=', opts.state);
  if (cursor)
    q = q.where(sql<boolean>`(i.raised_at, i.id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
  const rows = await q.execute();
  const page = pageOf(rows, opts.limit, (r) => ({ t: r.raised_text, id: r.id }));
  return {
    items: page.items.map((r): IssueView => ({
      id: r.id,
      orderLineId: r.order_line_id,
      flag: r.flag as IssueView['flag'],
      state: r.state as IssueView['state'],
      note: r.note,
      raisedAt: new Date(r.raised_at).toISOString(),
      resolvedAt: iso(r.resolved_at),
      resolutionNote: r.resolution_note,
      productName: r.product_name,
    })),
    nextCursor: page.nextCursor,
  };
}
