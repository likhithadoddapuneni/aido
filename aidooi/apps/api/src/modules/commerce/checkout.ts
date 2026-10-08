import { sql, type Selectable } from 'kysely';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Checkout, StartCheckoutBodySchema } from '@aidooi/contracts';
import type { DB } from '@aidooi/db';
import {
  PURCHASE_CONFIRMATION_SLA_HOURS,
  PURCHASE_WINDOW_HOURS,
  addHours,
  fils,
  needsExplicitConfirmation,
  planReservation,
  sum,
  times,
  validateLine,
  type Fils,
  type LineValidation,
  type CartLine,
} from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext, type Tx } from '../../context.ts';
import { requireBuyer } from '../../http/actor.ts';
import { conflict, notFound } from '../../http/problem.ts';
import { quoteCredit } from './deposit.ts';
import { checkoutState, type StateFacts } from './state.ts';

type Body = z.infer<typeof StartCheckoutBodySchema>;
type RequestRow = Selectable<DB['commerce.purchase_request']>;
type ReservationRow = Selectable<DB['commerce.reservation']>;

const ts = (d: Date | string) => new Date(d).getTime();
const iso = (d: Date | string) => new Date(d).toISOString();

export interface LiveLine {
  readonly offerId: string;
  readonly productId: string;
  readonly productName: string;
  readonly partnerId: string;
  readonly sellerName: string;
  readonly quantity: number;
  readonly quotedUnitPrice: Fils;
  readonly commissionRate: number;
  readonly deliveryDays: number;
  readonly live: {
    readonly sellingPrice: Fils;
    readonly availability: 'In Stock' | 'Low Stock' | 'Out of Stock';
    readonly stockQty: number;
    readonly offerStatus: 'Active' | 'Inactive';
  };
}

export interface CheckoutView {
  readonly request: RequestRow;
  readonly lines: readonly LiveLine[];
  readonly validations: readonly LineValidation[];
  readonly reservation: ReservationRow | null;
  readonly openTasks: number;
  readonly payment: { id: string; state: string; providerRef: string | null } | null;
  readonly orderId: string | null;
}

/** Everything about a checkout, read fresh, with each line validated against the live offer. */
export async function loadView(trx: Tx, requestId: string): Promise<CheckoutView> {
  const request = await trx
    .selectFrom('commerce.purchase_request')
    .selectAll()
    .where('id', '=', requestId)
    .executeTakeFirst();
  if (!request) throw notFound('Checkout');
  const rows = await trx
    .selectFrom('commerce.purchase_request_line as l')
    .innerJoin('catalogue.seller_offer as o', 'o.id', 'l.offer_id')
    .innerJoin('catalogue.product as p', 'p.id', 'o.product_id')
    .innerJoin('catalogue.partner as pt', 'pt.id', 'o.partner_id')
    .select([
      'l.offer_id',
      'l.quantity',
      'l.quoted_unit_price_fils',
      'o.product_id',
      'o.partner_id',
      'o.selling_price_fils',
      'o.availability',
      'o.stock_qty',
      'o.offer_status',
      'o.commission_rate',
      'o.delivery_days',
      'p.name as product_name',
      'pt.trade_name',
    ])
    .where('l.purchase_request_id', '=', requestId)
    .orderBy('l.offer_id')
    .execute();
  const lines: LiveLine[] = rows.map((r) => ({
    offerId: r.offer_id,
    productId: r.product_id,
    productName: r.product_name,
    partnerId: r.partner_id,
    sellerName: r.trade_name,
    quantity: r.quantity,
    quotedUnitPrice: fils(Number(r.quoted_unit_price_fils)),
    commissionRate: Number(r.commission_rate),
    deliveryDays: r.delivery_days,
    live: {
      sellingPrice: fils(Number(r.selling_price_fils)),
      availability: r.availability as LiveLine['live']['availability'],
      stockQty: r.stock_qty,
      offerStatus: r.offer_status as 'Active' | 'Inactive',
    },
  }));
  const validations = lines.map((l) =>
    validateLine(
      {
        offerId: l.offerId as CartLine['offerId'],
        partnerId: l.partnerId as CartLine['partnerId'],
        quantity: l.quantity,
        displayedUnitPrice: l.quotedUnitPrice,
      },
      l.live,
    ),
  );
  const reservation =
    (await trx
      .selectFrom('commerce.reservation')
      .selectAll()
      .where('purchase_request_id', '=', requestId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst()) ?? null;
  const open = reservation
    ? await trx
        .selectFrom('commerce.confirmation_task')
        .select((e) => e.fn.countAll<string>().as('n'))
        .where('reservation_id', '=', reservation.id)
        .where('response', 'is', null)
        .executeTakeFirstOrThrow()
    : { n: '0' };
  const pay = await trx
    .selectFrom('commerce.payment')
    .select(['id', 'state', 'provider_ref'])
    .where('purchase_request_id', '=', requestId)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  const order = await trx
    .selectFrom('commerce.master_order')
    .select('id')
    .where('purchase_request_id', '=', requestId)
    .executeTakeFirst();
  return {
    request,
    lines,
    validations,
    reservation,
    openTasks: Number(open.n),
    payment: pay ? { id: pay.id, state: pay.state, providerRef: pay.provider_ref } : null,
    orderId: order?.id ?? null,
  };
}

export const grossOf = (lines: readonly LiveLine[], use: 'quoted' | 'current'): Fils =>
  sum(
    lines.map((l) => times(use === 'quoted' ? l.quotedUnitPrice : l.live.sellingPrice, l.quantity)),
  );

export async function toCheckoutDto(ctx: AppContext, trx: Tx, v: CheckoutView): Promise<Checkout> {
  const anyBlocked = v.validations.some(
    (x) => x.status === 'Stock Unavailable' || x.status === 'Offer Inactive',
  );
  const anyPriceChanged = v.validations.some((x) => x.status === 'Price Changed');
  const reservationExpired =
    v.reservation !== null &&
    v.reservation.state === 'Active' &&
    ts(v.reservation.expires_at) < ctx.clock.now();
  const state = checkoutState({
    validationState: v.request.validation_state as
      'Validation Pending' | 'Validated' | 'Rebuild Required',
    reservationState: (v.reservation?.state ?? null) as StateFacts['reservationState'],
    reservationExpired,
    hasOrder: v.orderId !== null,
    pendingConfirmations: v.openTasks,
    anyPriceChanged,
    anyBlocked: v.orderId === null && anyBlocked,
    paymentAwaitingAction: v.payment?.state === 'Pending' && v.payment.providerRef !== null,
  });

  const total = grossOf(v.lines, 'current');
  let credit = fils(0);
  if (v.request.viewing_request_id && v.orderId === null && state !== 'Rebuild Required') {
    credit = await quoteCredit(ctx, trx, v.request, total);
  }
  const statusOf = (x: LineValidation, l: LiveLine): Checkout['lines'][number]['status'] =>
    x.status === 'Confirmed' && v.openTasks > 0 && needsExplicitConfirmation(l.live)
      ? 'Awaiting Seller'
      : x.status;

  return {
    id: v.request.id,
    state,
    lines: v.lines.map((l, i) => ({
      offerId: l.offerId,
      productId: l.productId,
      productName: l.productName,
      sellerName: l.sellerName,
      quantity: l.quantity,
      quotedUnitPrice: l.quotedUnitPrice,
      currentUnitPrice: l.live.sellingPrice,
      status: statusOf(v.validations[i] as LineValidation, l),
    })),
    total,
    depositCredit: credit,
    payable: fils(total - credit),
    expiresAt:
      v.reservation &&
      v.reservation.state === 'Active' &&
      v.request.validation_state === 'Validated'
        ? iso(v.reservation.expires_at)
        : null,
    pendingSellerConfirmations: v.openTasks,
    orderId: v.orderId,
  };
}

/* ------------------------------ starting a checkout ------------------------------ */

interface Wanted {
  readonly offerId: string;
  readonly quantity: number;
  readonly expectedUnitPrice: Fils;
}

async function wantedFrom(trx: Tx, customerId: string, source: Body['source']): Promise<Wanted[]> {
  if (source.kind === 'lines') {
    const merged = new Map<string, Wanted>();
    for (const l of source.lines) {
      const prev = merged.get(l.offerId);
      if (prev && prev.expectedUnitPrice !== l.expectedUnitPrice)
        throw conflict(
          'conflicting_lines',
          'The same product appears twice with different prices.',
        );
      merged.set(l.offerId, {
        offerId: l.offerId,
        quantity: (prev?.quantity ?? 0) + l.quantity,
        expectedUnitPrice: fils(l.expectedUnitPrice),
      });
    }
    return [...merged.values()];
  }
  // A composition is bought as the buyer last saw it: its stored items and prices, which they may have edited.
  const comp = await trx
    .selectFrom('recommendation.composition as c')
    .innerJoin('recommendation.recommendation_run as r', 'r.id', 'c.run_id')
    .innerJoin('recommendation.project as p', 'p.id', 'r.project_id')
    .select(['c.id', 'c.state', 'p.customer_id'])
    .where('c.id', '=', source.compositionId)
    .executeTakeFirst();
  if (!comp || comp.customer_id !== customerId) throw notFound('Composition');
  if (comp.state !== 'Valid')
    throw conflict('composition_not_buyable', 'This composition is not available to buy.');
  const items = await trx
    .selectFrom('recommendation.composition_item')
    .select(['offer_id', 'quantity', 'unit_price_fils'])
    .where('composition_id', '=', source.compositionId)
    .execute();
  if (items.length === 0)
    throw conflict('composition_empty', 'This composition has nothing in it.');
  return items.map((i) => ({
    offerId: i.offer_id,
    quantity: i.quantity,
    expectedUnitPrice: fils(Number(i.unit_price_fils)),
  }));
}

export async function startCheckout(
  ctx: AppContext,
  req: FastifyRequest,
  body: Body,
): Promise<Checkout> {
  const buyer = requireBuyer(req, { registered: true });
  const customerId = buyer.customerId as string;
  return runAsSystem(
    ctx,
    async (trx) => {
      const wanted = (await wantedFrom(trx, customerId, body.source)).sort((a, b) =>
        a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0,
      );
      const offers = await trx
        .selectFrom('catalogue.seller_offer')
        .select([
          'id',
          'partner_id',
          'selling_price_fils',
          'availability',
          'stock_qty',
          'offer_status',
        ])
        .where(
          'id',
          'in',
          wanted.map((w) => w.offerId),
        )
        // Exclusive lock FIRST, in a fixed order. Taking it after rows that reference the offer (a
        // shared lock) lets two buyers each hold a shared lock and wait for the exclusive one: deadlock.
        .orderBy('id')
        .forUpdate()
        .execute();
      const byId = new Map(offers.map((o) => [o.id, o]));
      if (wanted.some((w) => !byId.has(w.offerId))) throw notFound('Offer');

      const live = (id: string): LiveLine['live'] => {
        const o = byId.get(id)!;
        return {
          sellingPrice: fils(Number(o.selling_price_fils)),
          availability: o.availability as LiveLine['live']['availability'],
          stockQty: o.stock_qty,
          offerStatus: o.offer_status as 'Active' | 'Inactive',
        };
      };
      const checks = wanted.map((w) =>
        validateLine(
          {
            offerId: w.offerId as CartLine['offerId'],
            partnerId: byId.get(w.offerId)!.partner_id as CartLine['partnerId'],
            quantity: w.quantity,
            displayedUnitPrice: w.expectedUnitPrice,
          },
          live(w.offerId),
        ),
      );
      const blocked = checks.some(
        (c) => c.status === 'Stock Unavailable' || c.status === 'Offer Inactive',
      );
      const total = sum(wanted.map((w) => times(live(w.offerId).sellingPrice, w.quantity)));

      const now = ctx.clock.now();
      const request = await trx
        .insertInto('commerce.purchase_request')
        .values({
          customer_id: customerId,
          composition_id: body.source.kind === 'composition' ? body.source.compositionId : null,
          viewing_request_id: body.viewingRequestId ?? null,
          validation_state: blocked ? 'Rebuild Required' : 'Validation Pending',
          total_fils: total,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('commerce.purchase_request_line')
        .values(
          wanted.map((w) => ({
            purchase_request_id: request.id,
            offer_id: w.offerId,
            quantity: w.quantity,
            quoted_unit_price_fils: w.expectedUnitPrice,
          })),
        )
        .execute();

      if (!blocked) {
        const plan = planReservation(checks, now);
        const reservation = await trx
          .insertInto('commerce.reservation')
          .values({
            purchase_request_id: request.id,
            expires_at: new Date(addHours(now, PURCHASE_WINDOW_HOURS)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        // Hold the stock. A refusal means someone else's live reservation already covers the last units.
        let held = true;
        for (const w of wanted) {
          const { rows } = await sql<{
            ok: boolean;
          }>`SELECT commerce.try_reserve(${reservation.id}::uuid, ${w.offerId}, ${w.quantity}) AS ok`.execute(
            trx,
          );
          if (!rows[0]?.ok) held = false;
        }
        if (!held) {
          await trx
            .updateTable('commerce.reservation')
            .set({ state: 'Released' })
            .where('id', '=', reservation.id)
            .execute();
          await trx
            .updateTable('commerce.purchase_request')
            .set({ validation_state: 'Rebuild Required' })
            .where('id', '=', request.id)
            .execute();
        } else {
          // Explicit seller confirmation only where the data is thin (ADR-028): one task per seller.
          const partners = new Set(
            wanted
              .filter((w) => needsExplicitConfirmation(live(w.offerId)))
              .map((w) => byId.get(w.offerId)!.partner_id),
          );
          for (const partnerId of partners) {
            await trx
              .insertInto('commerce.confirmation_task')
              .values({
                task_type: 'purchase',
                partner_id: partnerId,
                reservation_id: reservation.id,
                due_at: new Date(addHours(now, PURCHASE_CONFIRMATION_SLA_HOURS)),
              })
              .execute();
          }
          const needsApproval = plan.outcome === 'Approval Required';
          if (partners.size === 0 && !needsApproval) {
            await trx
              .updateTable('commerce.purchase_request')
              .set({ validation_state: 'Validated' })
              .where('id', '=', request.id)
              .execute();
          }
        }
      }
      await recordAudit(trx, {
        entityType: 'purchase_request',
        entityId: request.id,
        from: null,
        to: blocked ? 'Rebuild Required' : 'Validation Pending',
        actor: req.actor!,
        data: { total },
      });
      return toCheckoutDto(ctx, trx, await loadView(trx, request.id));
    },
    req.id,
  );
}

export async function loadOwnedRequestId(
  trx: Tx,
  customerId: string,
  checkoutId: string,
): Promise<void> {
  const row = await trx
    .selectFrom('commerce.purchase_request')
    .select('customer_id')
    .where('id', '=', checkoutId)
    .executeTakeFirst();
  if (!row || row.customer_id !== customerId) throw notFound('Checkout');
}

export async function getCheckout(
  ctx: AppContext,
  req: FastifyRequest,
  checkoutId: string,
): Promise<Checkout> {
  const buyer = requireBuyer(req, { registered: true });
  return runAsSystem(
    ctx,
    async (trx) => {
      await loadOwnedRequestId(trx, buyer.customerId as string, checkoutId);
      return toCheckoutDto(ctx, trx, await loadView(trx, checkoutId));
    },
    req.id,
  );
}

/* ------------------------------ price approval ------------------------------ */

/**
 * The buyer approves the *current* prices, naming the total they approve so approval is of a
 * specific number. Quotes move to the live price; if nothing else is pending the checkout becomes
 * Validated and the purchase window restarts (a buyer is never penalised for deciding).
 */
export async function approvePrices(
  ctx: AppContext,
  req: FastifyRequest,
  checkoutId: string,
  approvedTotal: number,
): Promise<Checkout> {
  const buyer = requireBuyer(req, { registered: true });
  return runAsSystem(
    ctx,
    async (trx) => {
      await loadOwnedRequestId(trx, buyer.customerId as string, checkoutId);
      const v = await loadView(trx, checkoutId);
      if (v.request.validation_state === 'Rebuild Required' || v.orderId)
        throw conflict('checkout_not_approvable', 'This checkout can no longer be changed.');
      if (
        v.validations.some((x) => x.status === 'Stock Unavailable' || x.status === 'Offer Inactive')
      )
        throw conflict('checkout_blocked', 'A product is no longer available.');
      const current = grossOf(v.lines, 'current');
      if (current !== approvedTotal)
        throw conflict(
          'total_changed',
          'Prices changed again. Review the new total before approving.',
        );
      for (const l of v.lines) {
        if (l.quotedUnitPrice !== l.live.sellingPrice) {
          await trx
            .updateTable('commerce.purchase_request_line')
            .set({ quoted_unit_price_fils: l.live.sellingPrice })
            .where('purchase_request_id', '=', checkoutId)
            .where('offer_id', '=', l.offerId)
            .execute();
        }
      }
      await trx
        .updateTable('commerce.purchase_request')
        .set({ total_fils: current })
        .where('id', '=', checkoutId)
        .execute();
      if (v.openTasks === 0) await validateAndExtend(ctx, trx, checkoutId);
      await recordAudit(trx, {
        entityType: 'purchase_request',
        entityId: checkoutId,
        from: v.request.validation_state,
        to: v.openTasks === 0 ? 'Validated' : v.request.validation_state,
        actor: req.actor!,
        reason: 'prices approved',
        data: { approvedTotal },
      });
      return toCheckoutDto(ctx, trx, await loadView(trx, checkoutId));
    },
    req.id,
  );
}

/**
 * All validations are in: mark Validated and restart the purchase window from now, which is the
 * last confirmation (AID-LOG-014 §3). The window only ever extends.
 */
export async function validateAndExtend(
  ctx: AppContext,
  trx: Tx,
  checkoutId: string,
): Promise<void> {
  const expires = new Date(addHours(ctx.clock.now(), PURCHASE_WINDOW_HOURS));
  await trx
    .updateTable('commerce.purchase_request')
    .set({ validation_state: 'Validated' })
    .where('id', '=', checkoutId)
    .execute();
  await sql`UPDATE commerce.reservation SET expires_at = GREATEST(expires_at, ${expires}) WHERE purchase_request_id = ${checkoutId}::uuid AND state = 'Active'`.execute(
    trx,
  );
}

/** Release a reservation and mark the checkout Rebuild Required (a seller declined or lapsed). */
export async function failValidation(trx: Tx, checkoutId: string): Promise<void> {
  await trx
    .updateTable('commerce.reservation')
    .set({ state: 'Released' })
    .where('purchase_request_id', '=', checkoutId)
    .where('state', '=', 'Active')
    .execute();
  await trx
    .updateTable('commerce.purchase_request')
    .set({ validation_state: 'Rebuild Required' })
    .where('id', '=', checkoutId)
    .execute();
}
