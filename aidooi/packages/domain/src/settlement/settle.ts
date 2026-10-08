import type { OrderLineId, PartnerId } from '../kernel/ids.ts';
import { ZERO, add, sub, type Fils } from '../kernel/money.ts';

/** The facts settlement needs about one line. Everything money-related comes from the locked snapshot. */
export interface SettlementLine {
  readonly lineId: OrderLineId;
  readonly partnerId: PartnerId;
  readonly gross: Fils;
  readonly commission: Fils;
  readonly state: 'Receipt Confirmed' | 'Refunded' | 'Other';
  readonly settlement: 'Not Eligible' | 'Eligible' | 'On Hold' | 'Included' | 'Paid' | 'Adjusted';
  /** The run that already paid this line, if any. */
  readonly settledInRun: string | null;
  /** True once a clawback for this line has been recorded. */
  readonly clawedBack: boolean;
}

export type SettlementEntry =
  | { readonly kind: 'Sale'; readonly lineId: OrderLineId; readonly amount: Fils }
  | { readonly kind: 'Clawback'; readonly lineId: OrderLineId; readonly amount: Fils };

export interface PartnerSettlement {
  readonly partnerId: PartnerId;
  readonly gross: Fils;
  readonly commission: Fils;
  /** Net payable on sales, before clawbacks. */
  readonly salesNet: Fils;
  readonly clawbacks: Fils;
  readonly net: Fils;
  /** Gross of lines held back by an open issue; reported, never paid. */
  readonly held: Fils;
  readonly entries: readonly SettlementEntry[];
}

/**
 * AID-LOG-014 / WF-08 — per partner, per period:
 *
 *   net = Σ(gross − commission) over eligible lines  −  Σ(gross − commission) clawed back
 *
 * Commission comes from the snapshot, rounded once per line, so the run is exactly reproducible.
 * A refund before settlement simply never makes a line eligible — there is nothing to claw back.
 * Only a line already paid in an earlier run and refunded since is clawed back, once.
 * (The MVP prototype subtracted adjustments for refunds that were never added; fixed here — ADR-032.)
 */
export function settle(lines: readonly SettlementLine[]): PartnerSettlement[] {
  const byPartner = new Map<PartnerId, SettlementLine[]>();
  for (const l of lines) {
    const list = byPartner.get(l.partnerId) ?? [];
    list.push(l);
    byPartner.set(l.partnerId, list);
  }

  return [...byPartner.entries()]
    .map(([partnerId, ls]) => {
      let gross: Fils = ZERO;
      let commission: Fils = ZERO;
      let clawbacks: Fils = ZERO;
      let held: Fils = ZERO;
      const entries: SettlementEntry[] = [];
      for (const l of ls) {
        const net = sub(l.gross, l.commission);
        if (l.settlement === 'Eligible' && l.state === 'Receipt Confirmed') {
          gross = add(gross, l.gross);
          commission = add(commission, l.commission);
          entries.push({ kind: 'Sale', lineId: l.lineId, amount: net });
        } else if (l.settlement === 'On Hold') {
          held = add(held, l.gross);
        } else if (l.state === 'Refunded' && l.settledInRun !== null && !l.clawedBack) {
          clawbacks = add(clawbacks, net);
          entries.push({ kind: 'Clawback', lineId: l.lineId, amount: net });
        }
      }
      const salesNet = sub(gross, commission);
      return {
        partnerId,
        gross,
        commission,
        salesNet,
        clawbacks,
        net: sub(salesNet, clawbacks),
        held,
        entries,
      };
    })
    .sort((a, b) => (a.partnerId < b.partnerId ? -1 : 1));
}
