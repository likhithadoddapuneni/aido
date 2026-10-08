import {
  isEligibleOffer,
  isEligibleProduct,
  isOnDisplay,
  isViewable,
} from '../catalogue/eligibility.ts';
import type { Offer, Product } from '../catalogue/types.ts';
import { colourScore, styleScore } from '../standards/compatibility.ts';
import {
  BUDGET_REJECT_ABOVE,
  FAST_DELIVERY_DAYS,
  FIT_DEVIATION_BANDS,
  MATCH_WEIGHTS,
  MIN_FIT,
  MIN_PRODUCT_MATCH,
  USABLE_WALL_SHARE,
} from '../standards/constants.ts';
import type { ColourPreference, StylePreference } from '../standards/vocab.ts';
import type { RoomSpec } from '../standards/rooms.ts';
import type { RoomGeometry, ScoredCandidate, Slot } from './types.ts';

export interface ScoringContext {
  readonly style: StylePreference | undefined;
  readonly colour: ColourPreference | undefined;
  readonly spec: RoomSpec;
  /** `null` for the Individual Product path, which has no room to fit. */
  readonly room: RoomGeometry | null;
}

/** AID-LOG-009 §4 — Fit Quality, 0–100. Returns 0 when a hard spatial requirement fails. */
export function fitScore(product: Product, slot: Slot, room: RoomGeometry | null): number {
  const band = slot.w;
  if (!band) return 85;

  // An anchor cannot exceed the longest usable wall run once circulation is reserved
  // (AID-LOG-002 §2, §10 step 4). Gap #6: "usable" is an approximation until floor plans are parsed.
  if (room && room.longestWallCm > 0) {
    const usable =
      room.longestWallCm *
      (slot.role === 'anchor' ? USABLE_WALL_SHARE.anchor : USABLE_WALL_SHARE.other);
    if (product.widthCm > usable) return 0;
  }

  const [lo, hi] = band;
  const w = product.widthCm;
  if (w >= lo && w <= hi) return 100;
  const deviation = w < lo ? (lo - w) / lo : (w - hi) / hi;
  for (const b of FIT_DEVIATION_BANDS) if (deviation <= b.maxDeviation) return b.score;
  return 0;
}

/** AID-LOG-009 §7 — Budget / Value on price ÷ the slot's own allocation. -1 = unworkable (reject). */
export function budgetScore(priceFils: number, allocatedFils: number): number {
  if (!allocatedFils) return 85;
  const r = priceFils / allocatedFils;
  if (r >= 0.85 && r <= 1.05) return 100; // ideal value zone
  if (r >= 0.7 && r < 0.85) return 90; // slightly below target
  if (r > 1.05 && r <= 1.2) return 75; // slightly above, manageable
  if (r < 0.7) return 65; // significantly below the expected level
  if (r <= BUDGET_REJECT_ABOVE) return 50; // near the maximum tolerable allocation
  return -1;
}

/** AID-LOG-009 §9 — Availability Convenience. -1 = unavailable (reject). */
export function availabilityScore(offer: Offer): number {
  if (offer.availability === 'Out of Stock') return -1;
  const fast = offer.deliveryDays <= FAST_DELIVERY_DAYS;
  if (offer.availability === 'In Stock' && isOnDisplay(offer) && fast) return 100;
  if (offer.availability === 'In Stock' && isViewable(offer) && fast) return 85;
  if (offer.availability === 'In Stock') return 70;
  return 50; // low stock or longer delivery
}

/** AID-LOG-009 §8 — Practical Match against the mandatory attributes of the category. -1 = unmet. */
export function practicalScore(product: Product, spec: RoomSpec): number {
  switch (product.type) {
    case 'Bed':
      return product.attrs.bedSize === (spec.bedSize ?? 'Queen') ? 100 : -1;
    case 'Dining Table':
      return (product.attrs.capacity ?? 0) >= (spec.capacity ?? 4) ? 100 : -1;
    case 'Office Chair':
      return product.attrs.adjustable ? 100 : 85;
    case 'Desk':
      return product.attrs.cableManagement ? 100 : 85;
    default:
      return 100; // no mandatory practical requirement for this category
  }
}

/**
 * AID-LOG-009 §3 — the weighted Match Score for one offer in one slot.
 * Hard requirements decide eligibility; a strong soft score never offsets a failed one (§14).
 */
export function scoreProduct(
  product: Product,
  offer: Offer,
  slot: Slot,
  ctx: ScoringContext,
): ScoredCandidate {
  const fit = fitScore(product, slot, ctx.room);
  const practical = practicalScore(product, ctx.spec);
  const avail = availabilityScore(offer);
  const budget = budgetScore(offer.sellingPrice, slot.allocatedFils);
  const style = styleScore(ctx.style, product.primaryStyle, product.secondaryStyle);
  const colour = colourScore(ctx.colour, product.primaryColour, product.secondaryColour);

  const hardFail =
    !isEligibleProduct(product) || !isEligibleOffer(offer)
      ? 'Not eligible'
      : fit === 0
        ? 'Fit'
        : fit < MIN_FIT
          ? 'Minimum Fit'
          : practical < 0
            ? 'Practical requirement'
            : avail < 0
              ? 'Availability'
              : budget < 0
                ? 'Budget'
                : null;

  const w = MATCH_WEIGHTS;
  const total = hardFail
    ? 0
    : Math.round(
        fit * w.fit +
          style * w.style +
          colour * w.colour +
          budget * w.budget +
          practical * w.practical +
          avail * w.availability,
      );
  // Quality ignores budget and renormalises, for the "budget exceeds need" upgrade sequence
  // (AID-LOG-008 §6): improve quality, scale/fit and material match — never add products.
  const quality = hardFail
    ? 0
    : Math.round(
        (fit * w.fit +
          style * w.style +
          colour * w.colour +
          practical * w.practical +
          avail * w.availability) /
          (1 - w.budget),
      );

  return {
    product,
    offer,
    fit,
    style,
    colour,
    budget,
    practical,
    avail,
    total,
    quality,
    eligible: !hardFail && total >= MIN_PRODUCT_MATCH,
    rejectedFor:
      hardFail ??
      (total < MIN_PRODUCT_MATCH ? `Match Score ${total} < ${MIN_PRODUCT_MATCH}` : null),
  };
}

export const classifyMatch = (s: number): string =>
  s >= 90
    ? 'Excellent Match'
    : s >= 80
      ? 'Strong Match'
      : s >= 70
        ? 'Good Match'
        : s >= 60
          ? 'Acceptable Match'
          : 'Do Not Recommend';

export const classifyComposition = (s: number): string =>
  s >= 90
    ? 'Excellent Composition'
    : s >= 80
      ? 'Strong Composition'
      : s >= 70
        ? 'Good Composition'
        : 'Do Not Recommend';

/** AID-LOG-009 §11 tie-break: Fit → Style → Availability → Value; ids last so output is deterministic. */
export function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  return (
    b.total - a.total ||
    b.fit - a.fit ||
    b.style - a.style ||
    b.avail - a.avail ||
    b.budget - a.budget ||
    (a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0) ||
    (a.offer.id < b.offer.id ? -1 : a.offer.id > b.offer.id ? 1 : 0)
  );
}
