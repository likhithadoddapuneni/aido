import { sql } from 'kysely';
import { enqueue } from '@aidooi/db';
import { RuleViolation, fils, planRefund, type Fils } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext, type Tx } from '../../context.ts';
import type { ApiActor } from '../../http/actor.ts';
import { postLedger } from '../../ledger.ts';
import type { LineRow } from './lines.ts';

/**
 * Plan and persist the refunds for one refunded or cancelled line. Runs inside the caller's
 * transaction and only writes `Pending` rows plus a job: the provider is called after commit, so a
 * crash at any point leaves a durable, retryable record (never a refund the database does not know of).
 *
 * The buyer may have paid with two instruments (the order capture and an earlier viewing deposit
 * that was credited); `planRefund` returns to the capture first, then to the deposit payment.
 */
export async function createRefundsForLine(
  ctx: AppContext,
  trx: Tx,
  args: { line: LineRow; reason: string; actor: ApiActor | 'system'; amount?: Fils },
): Promise<string[]> {
  const { line } = args;
  const amount = args.amount ?? line.grossLine;
  if (amount !== line.grossLine) {
    throw new RuleViolation(
      'partial_refund_unsupported',
      'Only a refund of the whole line is supported.',
    );
  }

  // Refunds of different lines of one order draw on the same two payments; serialise them.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${'refund:' + line.masterOrderId}))`.execute(trx);

  const order = await trx
    .selectFrom('commerce.master_order')
    .select(['payment_id', 'viewing_request_id', 'deposit_credit_fils'])
    .where('id', '=', line.masterOrderId)
    .executeTakeFirstOrThrow();

  const capture = order.payment_id
    ? await trx
        .selectFrom('commerce.payment')
        .select(['id', 'amount_fils'])
        .where('id', '=', order.payment_id)
        .executeTakeFirstOrThrow()
    : null;
  const deposit =
    order.viewing_request_id && order.deposit_credit_fils > 0
      ? await trx
          .selectFrom('commerce.payment as p')
          .innerJoin('viewing.viewing_deposit as d', 'd.id', 'p.viewing_deposit_id')
          .select(['p.id', 'p.amount_fils'])
          .where('d.viewing_request_id', '=', order.viewing_request_id)
          .executeTakeFirst()
      : null;

  const refunded = async (paymentId: string | undefined): Promise<Fils> => {
    if (!paymentId) return fils(0);
    const r = await trx
      .selectFrom('commerce.refund')
      .select((e) => e.fn.sum<string>('amount_fils').as('s'))
      .where('payment_id', '=', paymentId)
      .where('state', '<>', 'Failed')
      .executeTakeFirstOrThrow();
    return fils(Number(r.s ?? 0));
  };

  const plan = planRefund({
    refundAmount: amount,
    captured: fils(capture ? capture.amount_fils : 0),
    alreadyRefundedToCapture: await refunded(capture?.id),
    depositCredited: fils(deposit ? Math.min(order.deposit_credit_fils, deposit.amount_fils) : 0),
    alreadyRefundedToDeposit: await refunded(deposit?.id),
  });

  const parts = [
    { paymentId: capture?.id, amount: plan.toCapture },
    { paymentId: deposit?.id, amount: plan.toDeposit },
  ].filter(
    (p): p is { paymentId: string; amount: Fils } => p.paymentId !== undefined && p.amount > 0,
  );

  const ids: string[] = [];
  for (const p of parts) {
    const { id } = await trx
      .insertInto('commerce.refund')
      .values({
        payment_id: p.paymentId,
        order_line_id: line.id,
        amount_fils: p.amount,
        reason: args.reason,
        state: 'Pending',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(id);
    await enqueue(trx, 'fulfilment.retry_refund', { refundId: id }, { dedupeKey: `refund:${id}` });
    await recordAudit(trx, {
      entityType: 'refund',
      entityId: id,
      from: null,
      to: 'Pending',
      actor: args.actor,
      reason: args.reason,
      data: { orderLineId: line.id, amountFils: p.amount },
    });
  }
  return ids;
}

export type RefundOutcome = 'succeeded' | 'failed' | 'already_done';

/**
 * Finish one Pending refund. Safe to call any number of times, from the request path and from the
 * `fulfilment.retry_refund` job: the provider call is idempotent on the refund id, and only the caller
 * that wins the Pending → Succeeded update posts the ledger. A provider timeout propagates, so the
 * job runner retries with backoff.
 */
export async function executeRefund(ctx: AppContext, refundId: string): Promise<RefundOutcome> {
  const r = await runAsSystem(ctx, (trx) =>
    trx
      .selectFrom('commerce.refund as f')
      .innerJoin('commerce.payment as p', 'p.id', 'f.payment_id')
      .select([
        'f.id',
        'f.state',
        'f.amount_fils',
        'f.order_line_id',
        'f.payment_id',
        'p.provider_ref',
        'p.customer_id',
      ])
      .where('f.id', '=', refundId)
      .executeTakeFirst(),
  );
  if (!r || r.state !== 'Pending') return 'already_done';
  if (!r.provider_ref)
    throw new Error(`Payment ${r.payment_id} has no provider reference to refund against`);

  const result = await ctx.gateway.refund({
    idempotencyKey: `refund:${r.id}`,
    providerRef: r.provider_ref,
    amount: fils(r.amount_fils),
  });

  const outcome = await runAsSystem(ctx, async (trx) => {
    if (result.status === 'refunded') {
      const won = await trx
        .updateTable('commerce.refund')
        .set({ state: 'Succeeded', provider_ref: result.refundRef })
        .where('id', '=', r.id)
        .where('state', '=', 'Pending')
        .returning('id')
        .executeTakeFirst();
      if (!won) return 'already_done' as const;
      await postLedger(trx, { id: ctx.ids.uuid(), refType: 'refund', refId: r.id }, [
        { account: 'sales_collected', direction: 'debit', amount: fils(r.amount_fils) },
        { account: 'psp_clearing', direction: 'credit', amount: fils(r.amount_fils) },
      ]);
      // A payment refunded in full is no longer a live payment.
      const paid = await trx
        .selectFrom('commerce.refund')
        .select((e) => e.fn.sum<string>('amount_fils').as('s'))
        .where('payment_id', '=', r.payment_id)
        .where('state', '=', 'Succeeded')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('commerce.payment')
        .set({ state: 'Refunded' })
        .where('id', '=', r.payment_id)
        .where('state', '=', 'Successful')
        .where('amount_fils', '=', Number(paid.s ?? 0))
        .execute();
      await recordAudit(trx, {
        entityType: 'refund',
        entityId: r.id,
        from: 'Pending',
        to: 'Succeeded',
        actor: 'system',
      });
      return 'succeeded' as const;
    }
    const lost = await trx
      .updateTable('commerce.refund')
      .set({ state: 'Failed' })
      .where('id', '=', r.id)
      .where('state', '=', 'Pending')
      .returning('id')
      .executeTakeFirst();
    if (!lost) return 'already_done' as const;
    await recordAudit(trx, {
      entityType: 'refund',
      entityId: r.id,
      from: 'Pending',
      to: 'Failed',
      actor: 'system',
      reason: result.code,
    });
    return 'failed' as const;
  });

  if (outcome === 'failed') {
    await ctx.notifier.send({
      template: 'fulfilment.refund_failed',
      to: { kind: 'ops' },
      data: { refundId: r.id, code: result.status === 'failed' ? result.code : null },
      dedupeKey: `refund-failed:${r.id}`,
    });
  } else if (outcome === 'succeeded') {
    await ctx.notifier.send({
      template: 'fulfilment.refund_issued',
      to: { kind: 'customer', id: r.customer_id },
      data: { refundId: r.id, amountFils: r.amount_fils },
      dedupeKey: `refund-issued:${r.id}`,
    });
  }
  return outcome;
}

/** Best-effort immediate attempt after commit; the job is the guarantee. */
export async function executeRefundsNow(ctx: AppContext, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    try {
      await executeRefund(ctx, id);
    } catch {
      // Left Pending; fulfilment.retry_refund will retry with backoff.
    }
  }
}
