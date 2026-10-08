import type { Fils } from '@aidooi/domain';
import type { Tx } from './context.ts';

export interface LedgerLeg {
  readonly account: string;
  readonly direction: 'debit' | 'credit';
  readonly amount: Fils;
}

/**
 * Post one balanced entry group (chart of accounts: docs/module-guide.md). Legs of zero are
 * dropped; the database refuses an unbalanced group at commit, but we check first so the failure
 * names the caller instead of surfacing at COMMIT.
 */
export async function postLedger(
  trx: Tx,
  group: {
    readonly id: string;
    readonly refType: string;
    readonly refId: string;
    readonly memo?: string;
  },
  legs: readonly LedgerLeg[],
): Promise<void> {
  const real = legs.filter((l) => l.amount > 0);
  const net = real.reduce((t, l) => t + (l.direction === 'debit' ? l.amount : -l.amount), 0);
  if (net !== 0)
    throw new Error(`Unbalanced ledger group ${group.refType}:${group.refId} (${net} fils)`);
  if (real.length === 0) return;
  await trx
    .insertInto('commerce.ledger_entry')
    .values(
      real.map((l) => ({
        entry_group: group.id,
        account: l.account,
        direction: l.direction,
        amount_fils: l.amount,
        ref_type: group.refType,
        ref_id: group.refId,
        memo: group.memo ?? null,
      })),
    )
    .execute();
}
