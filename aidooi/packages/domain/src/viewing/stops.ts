import type { Offer } from '../catalogue/types.ts';
import { isOnDisplay } from '../catalogue/eligibility.ts';
import type { PartnerLocationId } from '../kernel/ids.ts';
import { VIEWING_RECONFIRM_HOURS } from '../standards/constants.ts';
import { hoursBetween, type Instant } from '../kernel/time.ts';

export interface StopProduct<T = unknown> {
  readonly offer: Offer;
  readonly locationId: PartnerLocationId;
  readonly ref: T;
}

export interface Stop<T = unknown> {
  readonly stopNo: number;
  readonly locationId: PartnerLocationId;
  readonly products: readonly StopProduct<T>[];
  /** On Display offers with a fresh confirmation need no seller action (AID-LOG-012 §4). */
  readonly needsSellerConfirmation: boolean;
}

/**
 * A confirmation is fresh while the seller has confirmed display/availability recently enough;
 * stale confirmations must be re-obtained before reuse (AID-LOG-012 §4).
 */
export function isConfirmationFresh(offer: Offer, now: Instant): boolean {
  return (
    offer.viewingConfirmedAt !== null &&
    hoursBetween(offer.viewingConfirmedAt, now) <= VIEWING_RECONFIRM_HOURS
  );
}

/** Group selected products into viewing stops by physical partner location, minimising stops (§3). */
export function buildStops<T>(products: readonly StopProduct<T>[], now: Instant): Stop<T>[] {
  const byLocation = new Map<PartnerLocationId, StopProduct<T>[]>();
  for (const p of products) {
    const list = byLocation.get(p.locationId) ?? [];
    list.push(p);
    byLocation.set(p.locationId, list);
  }
  return [...byLocation.entries()].map(([locationId, list], i) => ({
    stopNo: i + 1,
    locationId,
    products: list,
    needsSellerConfirmation: !list.every(
      (p) => isOnDisplay(p.offer) && isConfirmationFresh(p.offer, now),
    ),
  }));
}
