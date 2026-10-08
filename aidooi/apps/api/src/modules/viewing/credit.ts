import {
  creditWindowElapsed,
  dispositionAfter,
  fils,
  instant,
  type Fils,
  type Instant,
} from '@aidooi/domain';
import type { AppContext, Tx } from '../../context.ts';
import { createRefund } from './refunds.ts';
import { addAttribution, setDepositState } from './transitions.ts';
import type { DepositRow } from './repo.ts';

/**
 * Contract with the commerce module. Both credit functions run inside the caller's transaction, as
 * the system actor, and are idempotent per viewing request. They share one evaluator, so a quote
 * taken before payment and the credit applied at finalisation can never disagree for the same state.
 *
 * A held deposit is creditable only when the request is Completed, belongs to `customerId`, the
 * deposit is Paid, no refund of it is under way, and `now` is inside the seven-day credit window
 * (ADR-030). Otherwise the credit is zero and checkout proceeds without one. The credit is
 * min(deposit, orderGross); the excess is refunded to the original deposit payment by a job after
 * commit.
 *
 * `quoteDepositCredit` is a pure read. `creditDepositForOrder` marks the deposit Credited and records
 * the excess refund; it posts no ledger entries for the credit itself — the caller's order entries
 * debit `deposits_held` for it. Calling it again returns the same figures.
 */
export interface CreditArgs {
  readonly viewingRequestId: string;
  readonly customerId: string;
  readonly orderGross: Fils;
  readonly now: Instant;
}
export interface CreditQuote {
  readonly credit: Fils;
  readonly excess: Fils;
}

type Evaluation =
  | { readonly kind: 'none' }
  | { readonly kind: 'applied'; readonly credit: Fils; readonly excess: Fils }
  | {
      readonly kind: 'creditable';
      readonly deposit: DepositRow;
      readonly credit: Fils;
      readonly excess: Fils;
    };

async function evaluate(trx: Tx, args: CreditArgs, lock: boolean): Promise<Evaluation> {
  const none: Evaluation = { kind: 'none' };
  let rq = trx
    .selectFrom('viewing.viewing_request')
    .selectAll()
    .where('id', '=', args.viewingRequestId);
  if (lock) rq = rq.forUpdate();
  const request = await rq.executeTakeFirst();
  if (
    !request ||
    request.customer_id !== args.customerId ||
    request.state !== 'Completed' ||
    !request.outcome_at
  )
    return none;

  let dq = trx
    .selectFrom('viewing.viewing_deposit')
    .selectAll()
    .where('viewing_request_id', '=', request.id);
  if (lock) dq = dq.forUpdate();
  const deposit = await dq.executeTakeFirst();
  if (!deposit) return none;
  const amount = fils(Number(deposit.amount_fils));

  if (deposit.state === 'Credited' && deposit.credited_fils !== null) {
    const credit = fils(Number(deposit.credited_fils));
    return { kind: 'applied', credit, excess: fils(amount - credit) };
  }
  if (deposit.state !== 'Paid') return none;

  const hold = dispositionAfter('Completed', instant(new Date(request.outcome_at).getTime()));
  if (hold.kind !== 'hold' || creditWindowElapsed(hold.until, args.now)) return none;
  const refunding = await trx
    .selectFrom('commerce.refund as r')
    .innerJoin('commerce.payment as p', 'p.id', 'r.payment_id')
    .select('r.id')
    .where('p.viewing_deposit_id', '=', deposit.id)
    .where('r.state', '<>', 'Failed')
    .executeTakeFirst();
  if (refunding) return none;

  const credit = fils(Math.min(amount, args.orderGross));
  return { kind: 'creditable', deposit, credit, excess: fils(amount - credit) };
}

export async function quoteDepositCredit(trx: Tx, args: CreditArgs): Promise<CreditQuote> {
  const e = await evaluate(trx, args, false);
  return e.kind === 'none'
    ? { credit: fils(0), excess: fils(0) }
    : { credit: e.credit, excess: e.excess };
}

export async function creditDepositForOrder(
  trx: Tx,
  ctx: AppContext,
  args: CreditArgs,
): Promise<{ credit: Fils; excessRefundDue: Fils }> {
  const e = await evaluate(trx, args, true);
  if (e.kind === 'none') return { credit: fils(0), excessRefundDue: fils(0) };
  if (e.kind === 'applied') return { credit: e.credit, excessRefundDue: e.excess };
  await setDepositState(trx, e.deposit, 'Credited', 'system', { credited_fils: e.credit });
  if (e.excess > 0)
    await createRefund(trx, ctx, {
      depositId: e.deposit.id,
      amount: e.excess,
      reason: 'deposit_excess',
    });
  return { credit: e.credit, excessRefundDue: e.excess };
}

export async function markViewingPurchased(trx: Tx, viewingRequestId: string): Promise<void> {
  const seen = await trx
    .selectFrom('viewing.attribution_event')
    .select('id')
    .where('viewing_request_id', '=', viewingRequestId)
    .where('stage', '=', 'Purchased')
    .executeTakeFirst();
  if (!seen) await addAttribution(trx, viewingRequestId, 'Purchased');
}
