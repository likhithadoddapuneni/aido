import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext } from '../../context.ts';
import { HttpError } from '../../http/problem.ts';
import type { GatewayEvent } from '../../payments/gateway.ts';
import { finalizeCheckout, type Delivery } from './finalize.ts';
import { lockPayment, recordAttempt, setPaymentState } from './payments-repo.ts';

/**
 * Provider webhooks are delivered at least once and out of order. Each is verified by the route, recorded by its
 * event id (so a repeat is a no-op) and then drives the same idempotent steps the request path uses.
 */
export async function handlePaymentEvent(
  ctx: AppContext,
  event: GatewayEvent,
): Promise<{ handled: boolean }> {
  const found = await runAsSystem(ctx, async (trx) => {
    const pay = await trx
      .selectFrom('commerce.payment')
      .selectAll()
      .where('provider', '=', 'mock')
      .where('provider_ref', '=', event.providerRef)
      .executeTakeFirst();
    if (!pay) return null;
    const fresh = await recordAttempt(
      trx,
      pay.id,
      kindOf(event),
      'Succeeded',
      null,
      event,
      event.id,
    );
    return { pay, fresh };
  });
  // An event for a payment we do not know is not ours; acknowledge so the provider stops retrying.
  if (!found || !found.fresh) return { handled: false };
  const { pay } = found;
  if (pay.purpose !== 'Order') return { handled: false }; // viewing deposits are handled by the viewing module

  switch (event.type) {
    case 'authorization.succeeded': {
      const advanced = await runAsSystem(ctx, async (trx) => {
        const locked = await lockPayment(trx, pay.id);
        if (locked.state !== 'Pending') return false;
        await setPaymentState(trx, locked, 'Authorized', {
          authorized_at: new Date(ctx.clock.now()),
        });
        await recordAudit(trx, {
          entityType: 'payment',
          entityId: pay.id,
          from: 'Pending',
          to: 'Authorized',
          actor: 'system',
          reason: 'provider confirmed authorisation',
        });
        return true;
      });
      if (advanced) await resume(ctx, pay.id);
      break;
    }
    case 'authorization.failed':
      await runAsSystem(ctx, async (trx) => {
        const locked = await lockPayment(trx, pay.id);
        if (locked.state !== 'Pending') return;
        await setPaymentState(trx, locked, 'Failed', {
          failure_code: event.type === 'authorization.failed' ? event.code : 'failed',
        });
        await recordAudit(trx, {
          entityType: 'payment',
          entityId: pay.id,
          from: 'Pending',
          to: 'Failed',
          actor: 'system',
          reason: 'provider reported failure',
        });
      });
      break;
    case 'capture.succeeded':
      // We may have crashed after the provider captured: finish placing the order.
      await resume(ctx, pay.id);
      break;
    case 'refund.succeeded':
      break;
  }
  return { handled: true };
}

const kindOf = (e: GatewayEvent) =>
  (e.type.startsWith('authorization')
    ? 'authorize'
    : e.type.startsWith('capture')
      ? 'capture'
      : 'refund') as 'authorize' | 'capture' | 'refund';

/** Finish an authorised payment using the delivery details stored with its authorisation attempt. */
export async function resume(ctx: AppContext, paymentId: string): Promise<void> {
  const delivery = await runAsSystem(ctx, async (trx) => {
    const attempt = await trx
      .selectFrom('commerce.payment_attempt')
      .select('request')
      .where('payment_id', '=', paymentId)
      .where('kind', '=', 'authorize')
      .where('request', 'is not', null)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return (attempt?.request as { delivery?: Delivery } | null)?.delivery ?? null;
  });
  if (!delivery) return;
  try {
    await finalizeCheckout(ctx, paymentId, delivery);
  } catch (error) {
    // Business outcomes (the checkout changed, capture failed) are already recorded and the payment
    // voided or refunded; there is nobody to return them to. Anything else must surface for retry.
    if (!(error instanceof HttpError) || error.status >= 500) throw error;
  }
}
