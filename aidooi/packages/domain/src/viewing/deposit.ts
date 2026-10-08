import { DEPOSIT_CAP, DEPOSIT_CREDIT_WINDOW_DAYS, DEPOSIT_RATE } from '../standards/constants.ts';
import { min, percentOf, sum, times, type Fils } from '../kernel/money.ts';
import { HOUR_MS, type Instant } from '../kernel/time.ts';
import type { Offer } from '../catalogue/types.ts';

export interface ViewingProduct {
  readonly offer: Pick<Offer, 'sellingPrice'>;
  readonly qty: number;
}

export interface DepositQuote {
  /** Σ Current Selling Price of the selected products. */
  readonly base: Fils;
  readonly amount: Fils;
  readonly capped: boolean;
}

/** AID-LOG-012 §5 — 5% of the selected products' Current Selling Price, at most AED 500 per request. */
export function quoteDeposit(items: readonly ViewingProduct[]): DepositQuote {
  const base = sum(items.map((i) => times(i.offer.sellingPrice, i.qty)));
  const raw = percentOf(base, DEPOSIT_RATE);
  return { base, amount: min(raw, DEPOSIT_CAP), capped: raw > DEPOSIT_CAP };
}

export type ViewingOutcome = 'Completed' | 'No-show' | 'Cancelled';
export type DepositDisposition =
  | { readonly kind: 'hold'; readonly until: Instant }
  | { readonly kind: 'refund' }
  | { readonly kind: 'forfeit' };

/**
 * What happens to a Paid deposit once the viewing outcome is known (AID-LOG-012 §9–12):
 * Completed → held for the credit window, then credited on purchase or refunded in full;
 * No-show → non-refundable; Cancelled by the customer or a seller → refunded in full.
 */
export function dispositionAfter(outcome: ViewingOutcome, at: Instant): DepositDisposition {
  switch (outcome) {
    case 'Completed':
      return { kind: 'hold', until: (at + DEPOSIT_CREDIT_WINDOW_DAYS * 24 * HOUR_MS) as Instant };
    case 'No-show':
      return { kind: 'forfeit' };
    case 'Cancelled':
      return { kind: 'refund' };
  }
}

/** A held deposit past its window with no purchase is refunded in full. */
export const creditWindowElapsed = (until: Instant, now: Instant): boolean => now >= until;
