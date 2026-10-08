import type { Fils } from '@aidooi/domain';
import type { AppContext, Tx } from '../../context.ts';

export type LedgerAccount =
  | 'psp_clearing'
  | 'deposits_held'
  | 'sales_collected'
  | 'forfeited_deposits_revenue'
  | 'commission_revenue'
  | 'bank'
  | `seller_payable:${string}`;

/**
 * Post one balanced pair (docs/module-guide.md, "The ledger"). The group is balanced by
 * construction; the database re-checks it at commit.
 */
export async function postTransfer(
  trx: Tx,
  ctx: AppContext,
  t: {
    debit: LedgerAccount;
    credit: LedgerAccount;
    amount: Fils;
    refType: string;
    refId: string;
    memo: string;
  },
): Promise<void> {
  const group = ctx.ids.uuid();
  await trx
    .insertInto('commerce.ledger_entry')
    .values([
      {
        entry_group: group,
        account: t.debit,
        direction: 'debit',
        amount_fils: t.amount,
        ref_type: t.refType,
        ref_id: t.refId,
        memo: t.memo,
      },
      {
        entry_group: group,
        account: t.credit,
        direction: 'credit',
        amount_fils: t.amount,
        ref_type: t.refType,
        ref_id: t.refId,
        memo: t.memo,
      },
    ])
    .execute();
}
