import type { Selectable } from 'kysely';
import type { DB } from '@aidooi/db';
import { assertTransition, payment as paymentMachine, type PaymentState } from '@aidooi/domain';
import type { Tx } from '../../context.ts';
import { notFound } from '../../http/problem.ts';

export type PaymentRow = Selectable<DB['commerce.payment']>;
export type AttemptKind = 'authorize' | 'capture' | 'void' | 'refund';

/** Lock the payment row for the duration of the transaction: the saga's steps must not interleave. */
export async function lockPayment(trx: Tx, paymentId: string): Promise<PaymentRow> {
  const row = await trx
    .selectFrom('commerce.payment')
    .selectAll()
    .where('id', '=', paymentId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw notFound('Payment');
  return row;
}

/** Every call to the provider is recorded, append-only, with what we sent and what came back. */
export async function recordAttempt(
  trx: Tx,
  paymentId: string,
  kind: AttemptKind,
  outcome: 'Succeeded' | 'Failed' | 'Pending',
  request: unknown,
  response: unknown,
  providerEventId?: string,
): Promise<boolean> {
  const res = await trx
    .insertInto('commerce.payment_attempt')
    .values({
      payment_id: paymentId,
      kind,
      outcome,
      // SQL NULL (not JSON null) when there is nothing to record, so "has a request" is a plain IS NOT NULL.
      request: request === undefined || request === null ? null : JSON.stringify(request),
      response: response === undefined || response === null ? null : JSON.stringify(response),
      provider_event_id: providerEventId ?? null,
    })
    // Webhooks are delivered at least once; a repeated event id is a no-op.
    .onConflict((oc) => oc.doNothing())
    .returning('id')
    .executeTakeFirst();
  return res !== undefined;
}

/** Move a payment along its state machine, checked in code first and by the database trigger as backstop. */
export async function setPaymentState(
  trx: Tx,
  row: PaymentRow,
  to: PaymentState,
  extra: Partial<{
    provider_ref: string;
    authorized_at: Date;
    captured_at: Date;
    voided_at: Date;
    failure_code: string;
  }> = {},
): Promise<void> {
  assertTransition(paymentMachine, row.state as PaymentState, to);
  await trx
    .updateTable('commerce.payment')
    .set({ state: to, ...extra })
    .where('id', '=', row.id)
    .execute();
}
