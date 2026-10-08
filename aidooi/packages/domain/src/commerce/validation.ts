import { fils, sum, times, type Fils } from '../kernel/money.ts';
import { addHours, type Instant } from '../kernel/time.ts';
import type { Offer } from '../catalogue/types.ts';
import type { OfferId, PartnerId } from '../kernel/ids.ts';
import { PURCHASE_WINDOW_HOURS } from '../standards/constants.ts';

/** What the buyer was shown and agreed to buy. */
export interface CartLine {
  readonly offerId: OfferId;
  readonly partnerId: PartnerId;
  readonly quantity: number;
  readonly displayedUnitPrice: Fils;
}

export type ValidationStatus =
  'Confirmed' | 'Stock Unavailable' | 'Offer Inactive' | 'Price Changed';

export interface LineValidation {
  readonly line: CartLine;
  readonly status: ValidationStatus;
  /** The seller's current price; differs from the displayed price when status is 'Price Changed'. */
  readonly currentUnitPrice: Fils;
}

/**
 * AID-LOG-014 §3 — final seller validation of one line against the live offer.
 * A price change is never applied silently: the buyer must approve it (gap #9).
 */
/** The live facts validation needs, so callers need not build a whole `Offer`. */
export type LiveOffer = Pick<Offer, 'offerStatus' | 'availability' | 'stockQty' | 'sellingPrice'>;

export function validateLine(line: CartLine, live: LiveOffer | undefined): LineValidation {
  if (!live || live.offerStatus !== 'Active') {
    return { line, status: 'Offer Inactive', currentUnitPrice: line.displayedUnitPrice };
  }
  if (live.availability === 'Out of Stock' || live.stockQty < line.quantity) {
    return { line, status: 'Stock Unavailable', currentUnitPrice: live.sellingPrice };
  }
  if (live.sellingPrice !== line.displayedUnitPrice) {
    return { line, status: 'Price Changed', currentUnitPrice: live.sellingPrice };
  }
  return { line, status: 'Confirmed', currentUnitPrice: live.sellingPrice };
}

/**
 * Offers are the seller's own declared truth, so checkout validates them automatically. Where that
 * truth is thin — the last units of stock — a human seller must confirm before money is taken
 * (ADR-028).
 */
export const needsExplicitConfirmation = (o: Pick<Offer, 'availability'>): boolean =>
  o.availability === 'Low Stock';

export interface ReservationPlan {
  readonly outcome: 'Active' | 'Rebuild Required' | 'Approval Required';
  readonly expiresAt: Instant | null;
  readonly lines: readonly LineValidation[];
  readonly total: Fils;
}

/**
 * The 24-hour purchase window starts when the *last* required seller confirmation arrives
 * (AID-LOG-014 §3), so a slow seller never shortens the buyer's time.
 */
export function planReservation(
  lines: readonly LineValidation[],
  lastConfirmationAt: Instant,
): ReservationPlan {
  const total = sum(lines.map((l) => times(l.currentUnitPrice, l.line.quantity)));
  const blocked = lines.some(
    (l) => l.status === 'Stock Unavailable' || l.status === 'Offer Inactive',
  );
  const priceChanged = lines.some((l) => l.status === 'Price Changed');
  if (blocked) return { outcome: 'Rebuild Required', expiresAt: null, lines, total };
  if (priceChanged) return { outcome: 'Approval Required', expiresAt: null, lines, total };
  return {
    outcome: 'Active',
    expiresAt: addHours(lastConfirmationAt, PURCHASE_WINDOW_HOURS),
    lines,
    total,
  };
}

export const isReservationExpired = (expiresAt: Instant, now: Instant): boolean => now > expiresAt;

export const ZERO_FILS = fils(0);
