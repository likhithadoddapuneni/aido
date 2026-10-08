import { enqueue } from '@aidooi/db';
import { assertTransition, fils, payment as paymentMachine, type Fils } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext, type Tx } from '../../context.ts';
import { postTransfer } from './ledger.ts';
import { Outbox, setDepositState } from './transitions.ts';

/** Why a deposit (or part of one) goes back to the buyer. Doubles as the refund's idempotency discriminator. */
export type RefundReason = 'viewing_cancelled' | 'deposit_unused' | 'deposit_excess';

/**
 * Record the intent to refund, in the caller's transaction, and schedule its execution. Recording and
 * executing are separate on purpose: the intent commits atomically with the state change that caused
 * it, while the provider call (which can time out) is retried by a job. Calling again for the same
 * deposit and reason returns the existing refund, so a retried request never refunds twice.
 */
export async function createRefund(
  trx: Tx,
  _ctx: AppContext,
  args: { depositId: string; amount: Fils; reason: RefundReason },
): Promise<string> {
  const pay = await trx
    .selectFrom('commerce.payment')
    .select('id')
    .where('viewing_deposit_id', '=', args.depositId)
    .where('state', 'in', ['Successful', 'Refunded'])
    .executeTakeFirstOrThrow();
  const existing = await trx
    .selectFrom('commerce.refund')
    .select('id')
    .where('payment_id', '=', pay.id)
    .where('reason', '=', args.reason)
    .where('state', '<>', 'Failed')
    .executeTakeFirst();
  if (existing) return existing.id;
  const row = await trx
    .insertInto('commerce.refund')
    .values({ payment_id: pay.id, amount_fils: args.amount, reason: args.reason })
    .returning('id')
    .executeTakeFirstOrThrow();
  await enqueue(
    trx,
    'viewing.process_refund',
    { refundId: row.id },
    { dedupeKey: `viewing.refund:${row.id}` },
  );
  return row.id;
}

/**
 * Execute one recorded refund. Safe to run any number of times: the provider call carries a
 * deterministic idempotency key, and the final bookkeeping happens once, under a row lock, only if the
 * refund is still Pending.
 */
export async function processRefund(ctx: AppContext, refundId: string): Promise<void> {
  const target = await runAsSystem(ctx, async (trx) => {
    const r = await trx
      .selectFrom('commerce.refund as r')
      .innerJoin('commerce.payment as p', 'p.id', 'r.payment_id')
      .select(['r.id', 'r.state', 'r.amount_fils', 'r.reason', 'p.provider_ref'])
      .where('r.id', '=', refundId)
      .executeTakeFirst();
    return r && r.state === 'Pending' && r.provider_ref
      ? { ...r, providerRef: r.provider_ref }
      : null;
  });
  if (!target) return;

  // A GatewayUnavailable propagates: the job retries with the same key and the provider replays its outcome.
  const result = await ctx.gateway.refund({
    idempotencyKey: `viewing-refund:${refundId}`,
    providerRef: target.providerRef,
    amount: fils(Number(target.amount_fils)),
  });

  const out = new Outbox();
  await runAsSystem(ctx, async (trx) => {
    const refund = await trx
      .selectFrom('commerce.refund')
      .selectAll()
      .where('id', '=', refundId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (refund.state !== 'Pending') return;
    const pay = await trx
      .selectFrom('commerce.payment')
      .selectAll()
      .where('id', '=', refund.payment_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const deposit = await trx
      .selectFrom('viewing.viewing_deposit')
      .selectAll()
      .where('id', '=', pay.viewing_deposit_id as string)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const request = await trx
      .selectFrom('viewing.viewing_request')
      .select(['id', 'customer_id'])
      .where('id', '=', deposit.viewing_request_id)
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('commerce.payment_attempt')
      .values({
        payment_id: pay.id,
        kind: 'refund',
        outcome: result.status === 'refunded' ? 'Succeeded' : 'Failed',
        request: JSON.stringify({ refundId, amountFils: refund.amount_fils }),
        response: JSON.stringify(result),
      })
      .execute();

    if (result.status !== 'refunded') {
      await trx
        .updateTable('commerce.refund')
        .set({ state: 'Failed' })
        .where('id', '=', refundId)
        .execute();
      await recordAudit(trx, {
        entityType: 'refund',
        entityId: refundId,
        from: 'Pending',
        to: 'Failed',
        actor: 'system',
        reason: result.code,
      });
      out.add({
        template: 'viewing.refund_failed',
        to: { kind: 'ops' },
        data: { refundId, code: result.code },
        dedupeKey: `viewing.refund-failed:${refundId}`,
      });
      return;
    }

    await trx
      .updateTable('commerce.refund')
      .set({ state: 'Succeeded', provider_ref: result.refundRef })
      .where('id', '=', refundId)
      .execute();
    await recordAudit(trx, {
      entityType: 'refund',
      entityId: refundId,
      from: 'Pending',
      to: 'Succeeded',
      actor: 'system',
      reason: refund.reason,
    });
    await postTransfer(trx, ctx, {
      debit: 'deposits_held',
      credit: 'psp_clearing',
      amount: fils(Number(refund.amount_fils)),
      refType: 'viewing_deposit',
      refId: deposit.id,
      memo: `deposit refund: ${refund.reason}`,
    });

    if (refund.reason !== 'deposit_excess' && deposit.state === 'Paid') {
      await setDepositState(trx, deposit, 'Refunded', 'system');
    }
    const refunded = await trx
      .selectFrom('commerce.refund')
      .select((e) => e.fn.sum<string>('amount_fils').as('total'))
      .where('payment_id', '=', pay.id)
      .where('state', '=', 'Succeeded')
      .executeTakeFirstOrThrow();
    if (Number(refunded.total) === Number(pay.amount_fils) && pay.state === 'Successful') {
      assertTransition(paymentMachine, 'Successful', 'Refunded');
      await trx
        .updateTable('commerce.payment')
        .set({ state: 'Refunded' })
        .where('id', '=', pay.id)
        .execute();
      await recordAudit(trx, {
        entityType: 'payment',
        entityId: pay.id,
        from: 'Successful',
        to: 'Refunded',
        actor: 'system',
      });
    }
    out.add({
      template: 'viewing.deposit_refunded',
      to: { kind: 'customer', id: request.customer_id },
      data: { viewingId: deposit.viewing_request_id, amountFils: Number(refund.amount_fils) },
      dedupeKey: `viewing.refunded:${refundId}`,
    });
  });
  await out.flush(ctx);
}
