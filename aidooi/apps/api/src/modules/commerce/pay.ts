import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { PayBodySchema, PayResponseSchema } from '@aidooi/contracts';
import { fils } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext } from '../../context.ts';
import { requireBuyer } from '../../http/actor.ts';
import { HttpError, conflict } from '../../http/problem.ts';
import { GatewayUnavailable, type AuthorizeResult } from '../../payments/gateway.ts';
import { grossOf, loadOwnedRequestId, loadView } from './checkout.ts';
import { quoteCredit } from './deposit.ts';
import {
  finalizeCheckout,
  placeCoveredOrder,
  releaseAtProvider,
  whyNotPayable,
} from './finalize.ts';
import { lockPayment, recordAttempt, setPaymentState } from './payments-repo.ts';

type PayBody = z.infer<typeof PayBodySchema>;
export type PayResponse = z.infer<typeof PayResponseSchema>;

/** A pending authentication this old is assumed abandoned: a new attempt replaces it. */
const SUPERSEDE_AFTER_MS = 60_000;

const isUniqueViolation = (e: unknown, constraint: string): boolean =>
  typeof e === 'object' &&
  e !== null &&
  (e as { code?: string }).code === '23505' &&
  (e as { constraint?: string }).constraint === constraint;

const DECLINE_TEXT: Record<string, string> = {
  card_declined: 'Your card was declined.',
  insufficient_funds: 'Your card has insufficient funds.',
  expired_card: 'Your card has expired.',
  authentication_failed: 'Card authentication failed.',
  fraud_suspected: 'Your bank blocked this payment.',
};

/**
 * One cart → one checkout → one payment to AIDOOi (AID-LOG-014).
 *
 * Authorise → (validate again) → capture → place the order. No money is captured until every seller
 * validation stands, and anything that goes wrong after authorisation voids or refunds it.
 * `clientKey` is the request's Idempotency-Key; the payment row is keyed on it, so a retry after a
 * timeout resumes the same payment instead of starting another.
 */
export async function pay(
  ctx: AppContext,
  req: FastifyRequest,
  checkoutId: string,
  body: PayBody,
  clientKey: string,
): Promise<PayResponse> {
  const buyer = requireBuyer(req, { registered: true });
  const customerId = buyer.customerId as string;

  // Step 0: decide what is owed, and find or create the single payment row for this attempt.
  const start = await runAsSystem(
    ctx,
    async (trx) => {
      await loadOwnedRequestId(trx, customerId, checkoutId);
      const v = await loadView(trx, checkoutId);
      if (v.orderId) {
        const o = await trx
          .selectFrom('commerce.master_order')
          .select(['id', 'paid_fils', 'deposit_credit_fils'])
          .where('id', '=', v.orderId)
          .executeTakeFirstOrThrow();
        return {
          kind: 'already' as const,
          orderId: o.id,
          paid: fils(Number(o.paid_fils)),
          credit: fils(Number(o.deposit_credit_fils)),
        };
      }
      const problem = whyNotPayable(ctx, v);
      if (problem) throw problem;

      const gross = grossOf(v.lines, 'current');
      const credit = await quoteCredit(ctx, trx, v.request, gross);
      const payable = fils(gross - credit);

      const key = `checkout:${checkoutId}:${clientKey}`;
      const existing = await trx
        .selectFrom('commerce.payment')
        .selectAll()
        .where('idempotency_key', '=', key)
        .executeTakeFirst();
      if (existing) return { kind: 'resume' as const, payment: existing, payable, credit };
      if (payable === 0) return { kind: 'covered' as const, payable, credit };

      // One live payment per checkout (also enforced by a unique index). A 3-D Secure attempt the buyer
      // walked away from may be replaced once it is clearly stale; anything further along may not.
      const live = await trx
        .selectFrom('commerce.payment')
        .selectAll()
        .where('purchase_request_id', '=', checkoutId)
        .where('purpose', '=', 'Order')
        .where('state', 'in', ['Pending', 'Authorized', 'Successful'])
        .executeTakeFirst();
      if (live) {
        const ageMs = ctx.clock.now() - new Date(live.created_at).getTime();
        if (live.state !== 'Pending' || ageMs < SUPERSEDE_AFTER_MS) {
          throw conflict(
            'payment_in_progress',
            'A payment for this checkout is already in progress.',
          );
        }
        await setPaymentState(trx, live, 'Failed', { failure_code: 'superseded' });
        await recordAudit(trx, {
          entityType: 'payment',
          entityId: live.id,
          from: 'Pending',
          to: 'Failed',
          actor: 'system',
          reason: 'superseded by a new attempt',
        });
      }

      const created = await trx
        .insertInto('commerce.payment')
        .values({
          purpose: 'Order',
          customer_id: customerId,
          purchase_request_id: checkoutId,
          amount_fils: payable,
          idempotency_key: key,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordAudit(trx, {
        entityType: 'payment',
        entityId: created.id,
        from: null,
        to: 'Pending',
        actor: req.actor!,
        data: { amount: payable },
      });
      return { kind: 'resume' as const, payment: created, payable, credit };
    },
    req.id,
  ).catch((error: unknown) => {
    // Two attempts passed the check together; the database index decides which one wins.
    if (isUniqueViolation(error, 'payment_one_live_order_uq')) {
      throw conflict('payment_in_progress', 'A payment for this checkout is already in progress.');
    }
    throw error;
  });

  if (start.kind === 'already')
    return {
      status: 'paid',
      orderId: start.orderId,
      paid: start.paid,
      depositCredit: start.credit,
    };

  // A deposit that covers the whole order: nothing to authorise, the order is placed directly.
  if (start.kind === 'covered') {
    const done = await placeCoveredOrder(ctx, checkoutId, body.delivery);
    return {
      status: 'paid',
      orderId: done.orderId,
      paid: done.paid,
      depositCredit: done.depositCredit,
    };
  }

  const { payment } = start;
  if (payment.state === 'Failed')
    throw new HttpError(
      402,
      'payment_declined',
      DECLINE_TEXT[payment.failure_code ?? ''] ?? 'Your payment was not accepted.',
    );
  if (payment.state === 'Voided' || payment.state === 'Refunded')
    throw new HttpError(409, 'payment_closed', 'This payment was cancelled. Start again.');

  // Step 1: authorise (unless a previous run already did).
  if (payment.state === 'Pending') {
    let auth: AuthorizeResult;
    try {
      auth = await ctx.gateway.authorize({
        idempotencyKey: `${payment.id}:authorize`,
        amount: fils(Number(payment.amount_fils)),
        paymentToken: body.paymentToken,
        reference: checkoutId,
      });
    } catch (e) {
      if (e instanceof GatewayUnavailable) {
        throw new HttpError(
          503,
          'payment_provider_unavailable',
          'The payment provider did not respond. Please retry — you will not be charged twice.',
        );
      }
      throw e;
    }

    const outcome = await runAsSystem(ctx, async (trx) => {
      const locked = await lockPayment(trx, payment.id);
      // The delivery details travel with the attempt so a 3-D Secure completion (a webhook, later) can finish the order.
      await recordAttempt(
        trx,
        payment.id,
        'authorize',
        auth.status === 'declined'
          ? 'Failed'
          : auth.status === 'authorized'
            ? 'Succeeded'
            : 'Pending',
        { delivery: body.delivery },
        auth,
      );
      if (locked.state !== 'Pending') return locked.state;
      if (auth.status === 'declined') {
        await setPaymentState(trx, locked, 'Failed', { failure_code: auth.code });
        await recordAudit(trx, {
          entityType: 'payment',
          entityId: payment.id,
          from: 'Pending',
          to: 'Failed',
          actor: 'system',
          reason: auth.code,
        });
        return 'Failed' as const;
      }
      if (auth.status === 'requires_action') {
        await trx
          .updateTable('commerce.payment')
          .set({ provider_ref: auth.providerRef })
          .where('id', '=', payment.id)
          .execute();
        return 'Pending' as const;
      }
      await setPaymentState(trx, locked, 'Authorized', {
        provider_ref: auth.providerRef,
        authorized_at: new Date(ctx.clock.now()),
      });
      await recordAudit(trx, {
        entityType: 'payment',
        entityId: payment.id,
        from: 'Pending',
        to: 'Authorized',
        actor: 'system',
      });
      return 'Authorized' as const;
    });

    if (auth.status === 'authorized' && outcome !== 'Authorized') {
      // The attempt was replaced while we were at the provider: release the hold so it cannot linger.
      await releaseAtProvider(ctx, payment.id, auth.providerRef, 'superseded');
      throw conflict('payment_superseded', 'A newer payment attempt replaced this one.');
    }
    if (auth.status === 'declined')
      throw new HttpError(
        402,
        'payment_declined',
        DECLINE_TEXT[auth.code] ?? 'Your payment was not accepted.',
      );
    if (auth.status === 'requires_action')
      return { status: 'requires_action', paymentId: payment.id, actionUrl: auth.actionUrl };
    if (outcome === 'Failed')
      throw new HttpError(402, 'payment_declined', 'Your payment was not accepted.');
  }

  // Steps 2–3: validate again, capture, place the order.
  const done = await finalizeCheckout(ctx, payment.id, body.delivery);
  return {
    status: 'paid',
    orderId: done.orderId,
    paid: done.paid,
    depositCredit: done.depositCredit,
  };
}
