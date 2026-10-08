import { isEligibleOffer, isEligibleProduct } from '../catalogue/eligibility.ts';
import type { Catalogue } from '../catalogue/types.ts';
import { aed, fils, type Fils } from '../kernel/money.ts';
import { ALLOCATION_SHARE } from '../standards/constants.ts';
import { priceRange } from '../standards/price-matrix.ts';
import { compositionFor, type RoomPath, type RoomSpec } from '../standards/rooms.ts';
import { TIERS, type Tier } from '../standards/vocab.ts';
import { compareCandidates, scoreProduct, type ScoringContext } from './scoring.ts';
import type { ScoredCandidate, Slot } from './types.ts';

/** Mid-range fallback when LOG-001 publishes no row for a type at a tier. */
const FALLBACK_RANGE: readonly [Fils, Fils] = [aed(100), aed(300)];

/**
 * AID-LOG-007 §4 — allocate the ceiling across slots by each slot's relative cost weight
 * (tier midpoint × quantity). Never fixed room percentages.
 */
export function buildSlots(
  path: RoomPath,
  sizeCls: Parameters<typeof compositionFor>[1],
  spec: RoomSpec,
  ceiling: Fils,
  tier: Tier,
): Slot[] {
  const templates = compositionFor(path, sizeCls, spec);
  const tierIdx = TIERS.indexOf(tier);
  const weights = templates.map((s) => {
    const r =
      priceRange(s.type, s.branch, tier) ??
      priceRange(s.type, s.branch, TIERS[Math.max(0, tierIdx - 1)] as Tier) ??
      FALLBACK_RANGE;
    return ((r[0] + r[1]) / 2) * s.qty;
  });
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  // Allocate a share of the ceiling so replacements and price movement keep headroom (call B).
  const pot = ceiling * ALLOCATION_SHARE;
  return templates.map((s, i) => {
    const allocatedTotalFils = ((weights[i] as number) / sum) * pot;
    return {
      ...s,
      key: `${s.type}#${i}`,
      allocatedTotalFils,
      allocatedFils: allocatedTotalFils / s.qty,
    };
  });
}

/** Every scored candidate (eligible or not) for one slot, in tie-break order. */
export function slotCandidates(
  slot: Slot,
  ctx: ScoringContext,
  catalogue: Catalogue,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const product of catalogue.productsOfType(slot.type, slot.branch)) {
    if (!isEligibleProduct(product)) continue;
    for (const offer of catalogue.offersOf(product.id)) {
      if (!isEligibleOffer(offer)) continue;
      out.push(scoreProduct(product, offer, slot, ctx));
    }
  }
  return out.sort(compareCandidates);
}

export function buildPools(
  slots: readonly Slot[],
  ctx: ScoringContext,
  catalogue: Catalogue,
): Map<string, readonly ScoredCandidate[]> {
  return new Map(slots.map((s) => [s.key, slotCandidates(s, ctx, catalogue)] as const));
}

export const toFils = (n: number): Fils => fils(Math.round(n));
