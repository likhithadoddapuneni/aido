import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { z } from 'zod';
import type { DeliverySchema } from '@aidooi/contracts';
import {
  RuleViolation,
  assertCapturable,
  bpsFromRate,
  fils,
  instant,
  splitOrder,
  type Fils,
  type PricedLine,
} from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext, type Tx } from '../../context.ts';
import { HttpError, conflict } from '../../http/problem.ts';
import type { CaptureResult, VoidResult } from '../../payments/gateway.ts';
import { GatewayUnavailable } from '../../payments/gateway.ts';
import { grossOf, loadView, type CheckoutView } from './checkout.ts';
import { applyCredit, quoteCredit } from './deposit.ts';
import { lockPayment, recordAttempt, setPaymentState, type PaymentRow } from './payments-repo.ts';

export type Delivery = z.infer<typeof DeliverySchema>;

export interface PaidOutcome {
  readonly orderId: string;
  readonly paid: Fils;
  readonly depositCredit: Fils;
}

const unavailable = () =>
  new HttpError(
    503,
    'payment_provider_unavailable',
    'The payment provider did not respond. Please retry — you will not be charged twice.',
  );

/**
 * Why a checkout cannot be paid right now, as the precise error the client needs. Every answer is a
 * conflict with the checkout's current state (409): the buyer's remedy is to act on the checkout,
 * not to fix their request.
 */
function whyNotPayable(ctx: AppContext, v: CheckoutView): HttpError | null {
  const blocked = v.validations.some(
    (x) => x.status === 'Stock Unavailable' || x.status === 'Offer Inactive',
  );
  if (v.request.validation_state === 'Rebuild Required' || blocked) {
    return conflict(
      'seller_validation_failed',
      'A seller could not confirm; the composition must be rebuilt.',
    );
  }
  if (v.openTasks > 0)
    return conflict(
      'awaiting_seller_confirmation',
      'Waiting for a seller to confirm availability.',
    );
  if (v.validations.some((x) => x.status === 'Price Changed'))
    return conflict(
      'price_approval_required',
      'A price changed; approve the new total to continue.',
    );
  if (v.request.validation_state !== 'Validated' || !v.reservation)
    return conflict('not_validated', 'This checkout has not been validated.');
  const plan = {
    outcome: 'Active' as const,
    expiresAt: instant(new Date(v.reservation.expires_at).getTime()),
    lines: v.validations,
    total: grossOf(v.lines, 'current'),
  };
  if (v.reservation.state !== 'Active') {
    return conflict(
      'reservation_expired',
      'The purchase window has ended. Revalidate to continue.',
    );
  }
  try {
    assertCapturable(plan, ctx.clock.now());
  } catch (e) {
    // The window lapsed but the sweeper has not marked it yet.
    if (e instanceof RuleViolation) return conflict(e.code, e.message);
    throw e;
  }
  return null;
}

export { whyNotPayable };

/* ------------------------------ void / capture wrappers ------------------------------ */

async function callGateway<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GatewayUnavailable) throw unavailable();
    throw e;
  }
}

/**
 * Ask the provider to release an authorisation and record the call. Idempotent at the provider
 * (the key is derived from the payment), so any failure path may call it freely.
 */
export async function releaseAtProvider(
  ctx: AppContext,
  paymentId: string,
  providerRef: string,
  reason: string,
): Promise<VoidResult> {
  const res: VoidResult = await callGateway(() =>
    ctx.gateway.void({ idempotencyKey: `${paymentId}:void`, providerRef }),
  );
  await runAsSystem(ctx, (trx) =>
    recordAttempt(
      trx,
      paymentId,
      'void',
      res.status === 'voided' ? 'Succeeded' : 'Failed',
      { reason },
      res,
    ),
  );
  return res;
}

/** Release an authorisation we will not use, and mark the payment Voided. */
export async function voidAuthorization(
  ctx: AppContext,
  paymentId: string,
  reason: string,
): Promise<void> {
  const row = await runAsSystem(ctx, (trx) =>
    trx
      .selectFrom('commerce.payment')
      .selectAll()
      .where('id', '=', paymentId)
      .executeTakeFirstOrThrow(),
  );
  if (row.state !== 'Authorized' || !row.provider_ref) return;
  const res = await releaseAtProvider(ctx, paymentId, row.provider_ref, reason);
  if (res.status !== 'voided') return;
  await runAsSystem(ctx, async (trx) => {
    const locked = await lockPayment(trx, paymentId);
    if (locked.state !== 'Authorized') return;
    await setPaymentState(trx, locked, 'Voided', {
      voided_at: new Date(ctx.clock.now()),
      failure_code: reason,
    });
    await recordAudit(trx, {
      entityType: 'payment',
      entityId: paymentId,
      from: 'Authorized',
      to: 'Voided',
      actor: 'system',
      reason,
    });
  });
}

/* ------------------------------ finalisation ------------------------------ */

/**
 * Take an authorised payment to a placed order. Re-entrant by construction: the webhook, the request
 * thread and the recovery job may all call it for the same payment, in any order, any number of times.
 *
 *   1. Re-validate under the same rules checkout used. Anything changed → void, never capture.
 *   2. Capture (idempotent at the provider).
 *   3. One transaction: payment Successful, stock decremented, reservation Converted, order split with
 *      locked snapshots, ledger, audit, outbox. All of it or none of it.
 */
export async function finalizeCheckout(
  ctx: AppContext,
  paymentId: string,
  delivery: Delivery,
): Promise<PaidOutcome> {
  // Phase 1 — decide, under lock, whether this payment may be captured.
  const decision = await runAsSystem(ctx, async (trx) => {
    const pay = await lockPayment(trx, paymentId);
    if (!pay.purchase_request_id) throw new Error('Order payment without a purchase request');
    const existing = await trx
      .selectFrom('commerce.master_order')
      .select(['id', 'payment_id', 'paid_fils', 'deposit_credit_fils'])
      .where('purchase_request_id', '=', pay.purchase_request_id)
      .executeTakeFirst();
    if (existing) {
      return {
        kind: 'done' as const,
        orderId: existing.id,
        paid: fils(Number(existing.paid_fils)),
        credit: fils(Number(existing.deposit_credit_fils)),
        // Another payment won the race: this authorisation must be released, not left holding the buyer's funds.
        supersededBy:
          existing.payment_id !== pay.id && pay.state === 'Authorized' ? existing.payment_id : null,
      };
    }
    if (pay.state !== 'Authorized' && pay.state !== 'Successful') {
      throw conflict('payment_not_authorised', `Payment is ${pay.state}; it cannot be captured.`);
    }
    const v = await loadView(trx, pay.purchase_request_id);
    const gross = grossOf(v.lines, 'current');
    const credit = await quoteCredit(ctx, trx, v.request, gross);
    const problem = pay.state === 'Authorized' ? whyNotPayable(ctx, v) : null;
    const changed = fils(gross - credit) !== fils(Number(pay.amount_fils));
    return { kind: 'proceed' as const, pay, view: v, gross, credit, problem, changed };
  });
  if (decision.kind === 'done') {
    if (decision.supersededBy)
      await voidAuthorization(ctx, paymentId, 'superseded_by_other_payment');
    return { orderId: decision.orderId, paid: decision.paid, depositCredit: decision.credit };
  }

  const { pay, problem, changed } = decision;
  if (problem || changed) {
    await voidAuthorization(ctx, paymentId, problem ? 'revalidation_failed' : 'amount_changed');
    if (problem) throw problem;
    throw conflict(
      'checkout_changed',
      'The total changed while you were paying. Please review it and try again — you have not been charged.',
    );
  }

  // Phase 2 — capture. Skipped when the payment is already Successful (a previous run crashed after capturing).
  if (pay.state === 'Authorized') {
    const res: CaptureResult = await callGateway(() =>
      ctx.gateway.capture({
        idempotencyKey: `${paymentId}:capture`,
        providerRef: pay.provider_ref as string,
        amount: fils(Number(pay.amount_fils)),
      }),
    );
    await runAsSystem(ctx, (trx) =>
      recordAttempt(
        trx,
        paymentId,
        'capture',
        res.status === 'captured' ? 'Succeeded' : 'Failed',
        { amount: pay.amount_fils },
        res,
      ),
    );
    if (res.status !== 'captured') {
      await runAsSystem(ctx, async (trx) => {
        const locked = await lockPayment(trx, paymentId);
        if (locked.state === 'Authorized')
          await setPaymentState(trx, locked, 'Failed', { failure_code: res.code });
        await recordAudit(trx, {
          entityType: 'payment',
          entityId: paymentId,
          from: 'Authorized',
          to: 'Failed',
          actor: 'system',
          reason: res.code,
        });
      });
      await releaseAfterFailedCapture(ctx, paymentId, pay.provider_ref as string);
      throw new HttpError(
        402,
        'payment_capture_failed',
        'The payment could not be completed. You have not been charged.',
      );
    }
  }

  // Phase 3 — one atomic transaction.
  try {
    return await runAsSystem(ctx, (trx) => placeOrder(ctx, trx, paymentId, delivery));
  } catch (error) {
    // Money was captured but the order could not be placed (for example the seller lowered stock below
    // the reservation). The buyer must never be left paying for nothing: refund in full.
    await compensate(
      ctx,
      paymentId,
      error instanceof Error ? error.message : 'order_placement_failed',
    );
    throw new HttpError(
      409,
      'order_could_not_be_placed',
      'We could not place your order and have refunded your payment in full.',
    );
  }
}

/** The capture failed, so the hold must not linger on the buyer's card. Never masks the original failure. */
async function releaseAfterFailedCapture(
  ctx: AppContext,
  paymentId: string,
  providerRef: string,
): Promise<void> {
  try {
    await releaseAtProvider(ctx, paymentId, providerRef, 'capture_failed');
  } catch {
    /* the recovery job retries releases; the caller must see the capture failure */
  }
}

/** The atomic step. Locks the payment, so a concurrent finaliser sees the finished order and returns it. */
async function placeOrder(
  ctx: AppContext,
  trx: Tx,
  paymentId: string,
  delivery: Delivery,
): Promise<PaidOutcome> {
  const pay = await lockPayment(trx, paymentId);
  return placeOrderFor(ctx, trx, pay.purchase_request_id as string, pay, delivery);
}

/** An order whose deposit credit covers it entirely: no card is charged, but everything else is identical. */
export async function placeCoveredOrder(
  ctx: AppContext,
  checkoutId: string,
  delivery: Delivery,
): Promise<PaidOutcome> {
  return runAsSystem(ctx, async (trx) => {
    await trx
      .selectFrom('commerce.purchase_request')
      .select('id')
      .where('id', '=', checkoutId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const out = await placeOrderFor(ctx, trx, checkoutId, null, delivery);
    if (out.paid !== 0)
      throw new RuleViolation('not_covered', 'The deposit does not cover this order.');
    return out;
  });
}

async function placeOrderFor(
  ctx: AppContext,
  trx: Tx,
  requestId: string,
  pay: PaymentRow | null,
  delivery: Delivery,
): Promise<PaidOutcome> {
  const prior = await trx
    .selectFrom('commerce.master_order')
    .select(['id', 'paid_fils', 'deposit_credit_fils'])
    .where('purchase_request_id', '=', requestId)
    .executeTakeFirst();
  if (prior)
    return {
      orderId: prior.id,
      paid: fils(Number(prior.paid_fils)),
      depositCredit: fils(Number(prior.deposit_credit_fils)),
    };

  const v = await loadView(trx, requestId);
  const now = new Date(ctx.clock.now());

  if (pay?.state === 'Authorized')
    await setPaymentState(trx, pay, 'Successful', { captured_at: now });

  // Stock moves only now, with the order (try_reserve held it; consume_reservation spends it).
  if (v.reservation)
    await sql`SELECT commerce.consume_reservation(${v.reservation.id}::uuid)`.execute(trx);

  const priced: PricedLine[] = v.lines.map((l) => ({
    productId: l.productId as PricedLine['productId'],
    offerId: l.offerId as PricedLine['offerId'],
    partnerId: l.partnerId as PricedLine['partnerId'],
    productName: l.productName,
    quantity: l.quantity,
    unitPrice: l.quotedUnitPrice,
    commissionRate: bpsFromRate(l.commissionRate),
  }));

  const credit = await applyCredit(ctx, trx, v.request, grossOf(v.lines, 'quoted'));
  const draft = splitOrder(priced, credit);
  if (draft.payable !== fils(pay ? Number(pay.amount_fils) : 0)) {
    throw new RuleViolation(
      'amount_mismatch',
      'The captured amount does not match the order total.',
    );
  }

  const master = await trx
    .insertInto('commerce.master_order')
    .values({
      customer_id: v.request.customer_id,
      payment_id: draft.payable > 0 && pay ? pay.id : null,
      purchase_request_id: requestId,
      viewing_request_id: v.request.viewing_request_id,
      gross_fils: draft.gross,
      deposit_credit_fils: draft.depositCredit,
      paid_fils: draft.payable,
      placed_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  for (const so of draft.sellerOrders) {
    const seller = await trx
      .insertInto('commerce.seller_order')
      .values({
        master_order_id: master.id,
        partner_id: so.partnerId,
        customer_id: v.request.customer_id,
        subtotal_fils: so.gross,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const line of so.lines) {
      const s = line.snapshot;
      await trx
        .insertInto('fulfilment.order_line')
        .values({
          master_order_id: master.id,
          seller_order_id: seller.id,
          partner_id: s.partnerId,
          customer_id: v.request.customer_id,
          product_id: s.productId,
          offer_id: s.offerId,
          quantity: s.quantity,
          unit_price_fils: s.unitPrice,
          gross_line_fils: s.grossLine,
          commission_rate: s.commissionRate / 10_000,
          commission_fils: s.commission,
          snapshot: JSON.stringify({
            productId: s.productId,
            offerId: s.offerId,
            sellerId: s.partnerId,
            productName: s.productName,
            deliveryDays: v.lines.find((l) => l.offerId === s.offerId)?.deliveryDays ?? null,
            quantity: s.quantity,
            unitPriceFils: s.unitPrice,
            grossLineFils: s.grossLine,
            commissionRate: s.commissionRate / 10_000,
            commissionFils: s.commission,
          }),
        })
        .execute();
    }
  }

  await trx
    .insertInto('commerce.order_delivery')
    .values({
      master_order_id: master.id,
      customer_id: v.request.customer_id,
      recipient_name: delivery.recipientName,
      phone_e164: delivery.phone,
      line1: delivery.line1,
      line2: delivery.line2 ?? null,
      area: delivery.area ?? null,
      emirate: delivery.emirate,
      lat: delivery.lat ?? null,
      lng: delivery.lng ?? null,
      instructions: delivery.instructions ?? null,
    })
    .execute();

  // Double entry: what came in (card + deposit) equals what is now owed onward (sales collected).
  const group = ctx.ids.uuid();
  const entries = [
    ...(draft.payable > 0
      ? [{ account: 'psp_clearing', direction: 'debit', amount_fils: draft.payable }]
      : []),
    ...(draft.depositCredit > 0
      ? [{ account: 'deposits_held', direction: 'debit', amount_fils: draft.depositCredit }]
      : []),
    { account: 'sales_collected', direction: 'credit', amount_fils: draft.gross },
  ];
  await trx
    .insertInto('commerce.ledger_entry')
    .values(
      entries.map((e) => ({
        entry_group: group,
        ...e,
        ref_type: 'order',
        ref_id: master.id,
        memo: 'Order placed',
      })),
    )
    .execute();

  if (v.request.viewing_request_id)
    await ctx.depositCredit.markPurchased(trx, v.request.viewing_request_id);

  await trx
    .insertInto('platform.outbox_event')
    .values({
      topic: 'order.placed',
      aggregate_id: master.id,
      payload: JSON.stringify({
        orderId: master.id,
        customerId: v.request.customer_id,
        partnerIds: draft.sellerOrders.map((s) => s.partnerId),
        gross: draft.gross,
      }),
    })
    .execute();
  if (pay) {
    await recordAudit(trx, {
      entityType: 'payment',
      entityId: pay.id,
      from: 'Authorized',
      to: 'Successful',
      actor: 'system',
    });
  }
  await recordAudit(trx, {
    entityType: 'master_order',
    entityId: master.id,
    from: null,
    to: 'Confirmed',
    actor: 'system',
    data: { gross: draft.gross, paid: draft.payable, depositCredit: draft.depositCredit },
  });
  return { orderId: master.id, paid: draft.payable, depositCredit: draft.depositCredit };
}

/**
 * Refund a captured payment in full because its order could not be placed. No ledger entries: the
 * order's entries are what book a capture, and the order never existed, so there is nothing to reverse.
 */
async function compensate(ctx: AppContext, paymentId: string, reason: string): Promise<void> {
  const pay = await runAsSystem(ctx, (trx) =>
    trx
      .selectFrom('commerce.payment')
      .selectAll()
      .where('id', '=', paymentId)
      .executeTakeFirstOrThrow(),
  );
  if (!pay.provider_ref) return;
  const refundId = randomUUID();
  await runAsSystem(ctx, async (trx) => {
    const locked = await lockPayment(trx, paymentId);
    // The failed placement rolled back; make the capture visible so the refund has something to refund.
    if (locked.state === 'Authorized')
      await setPaymentState(trx, locked, 'Successful', { captured_at: new Date(ctx.clock.now()) });
    await trx
      .insertInto('commerce.refund')
      .values({
        id: refundId,
        payment_id: paymentId,
        amount_fils: Number(pay.amount_fils),
        reason: `order_not_placed: ${reason}`,
      })
      .execute();
    await trx
      .updateTable('commerce.purchase_request')
      .set({ validation_state: 'Rebuild Required' })
      .where('id', '=', pay.purchase_request_id as string)
      .execute();
    await trx
      .updateTable('commerce.reservation')
      .set({ state: 'Released' })
      .where('purchase_request_id', '=', pay.purchase_request_id as string)
      .where('state', '=', 'Active')
      .execute();
  });
  const res = await callGateway(() =>
    ctx.gateway.refund({
      idempotencyKey: `${paymentId}:compensate`,
      providerRef: pay.provider_ref as string,
      amount: fils(Number(pay.amount_fils)),
    }),
  );
  await runAsSystem(ctx, async (trx) => {
    await recordAttempt(
      trx,
      paymentId,
      'refund',
      res.status === 'refunded' ? 'Succeeded' : 'Failed',
      { reason },
      res,
    );
    if (res.status === 'refunded') {
      await trx
        .updateTable('commerce.refund')
        .set({ state: 'Succeeded', provider_ref: res.refundRef })
        .where('id', '=', refundId)
        .execute();
      const locked = await lockPayment(trx, paymentId);
      if (locked.state === 'Successful') await setPaymentState(trx, locked, 'Refunded');
    }
    await recordAudit(trx, {
      entityType: 'payment',
      entityId: paymentId,
      from: 'Successful',
      to: res.status === 'refunded' ? 'Refunded' : 'Successful',
      actor: 'system',
      reason,
    });
  });
}
