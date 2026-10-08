import { sum, times, type Fils } from '../kernel/money.ts';
import { tierOfPrice } from '../standards/price-matrix.ts';
import {
  CONSISTENCY_PICK_BONUS,
  MIN_PRODUCT_MATCH,
  PREMIUM_SLOT_FLOOR,
  UPGRADE_FLOOR_SHARE,
  UPGRADE_MAX_PASSES,
} from '../standards/constants.ts';
import { TIERS } from '../standards/vocab.ts';
import { scoreComposition } from './composition.ts';
import type { Item, ObjectiveKey, Option, ScoredCandidate, Slot } from './types.ts';

interface Objective {
  readonly label: string;
  readonly blurb: string;
  readonly pick: (c: ScoredCandidate, slot: Slot) => number;
}

/** AID-LOG-010 §4–7 — the four option objectives. */
export const OBJECTIVES: Readonly<Record<ObjectiveKey, Objective>> = {
  bestOverall: {
    label: 'Best Overall Match',
    blurb: 'The highest-quality complete composition for this space.',
    pick: (c) => c.total,
  },
  bestValue: {
    label: 'Best Value',
    blurb: 'The strongest recommendation quality for every dirham spent.',
    // Quality per budget spent — not the cheapest composition (§5).
    pick: (c, slot) =>
      c.total / Math.max(0.45, c.offer.sellingPrice / (slot.allocatedFils || c.offer.sellingPrice)),
  },
  bestStyle: {
    label: 'Best Style Match',
    blurb: 'Maximum stylistic and material coherence, fit and budget intact.',
    pick: (c) => c.style * 0.55 + c.colour * 0.3 + c.total * 0.15,
  },
  premium: {
    label: 'Premium Choice',
    blurb: 'A meaningful upgrade within a controlled +20% budget stretch.',
    // Tier is derived from the Current Selling Price, never stored on the product (AID-DATA-010).
    pick: (c) =>
      c.total +
      TIERS.indexOf(tierOfPrice(c.product.type, c.product.branch, c.offer.sellingPrice)) * 4,
  },
};

const DECOR_TYPES: ReadonlySet<string> = new Set([
  'Vase',
  'Decorative Object',
  'Planter',
  'Wall Art',
  'Mirror',
  'Cushion',
  'Throw',
]);

const itemCost = (i: Item): number => i.offer.sellingPrice * i.qty;
const totalOf = (items: readonly Item[]): Fils =>
  sum(items.map((i) => times(i.offer.sellingPrice, i.qty)));

/** The best candidate by `better`, first one winning ties (pools arrive in tie-break order). */
function maxBy<T>(xs: readonly T[], score: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const x of xs) {
    const s = score(x);
    if (s > bestScore) {
      best = x;
      bestScore = s;
    }
  }
  return best;
}

export interface BuildInput {
  readonly key: ObjectiveKey;
  readonly slots: readonly Slot[];
  readonly pools: ReadonlyMap<string, readonly ScoredCandidate[]>;
  readonly range: readonly [Fils, Fils];
  readonly ceiling: Fils;
  /** Parent products already used as anchors by earlier options (AID-LOG-010 §8 anchor diversity). */
  readonly avoidAnchorParents?: ReadonlySet<string> | undefined;
  /** Bedroom consistency: product type → the parent product another bedroom chose. */
  readonly preferParents?: ReadonlyMap<string, string> | undefined;
}

const poolOf = (pools: BuildInput['pools'], slot: Slot): readonly ScoredCandidate[] =>
  pools.get(slot.key) ?? [];

export function buildOption(input: BuildInput): Option {
  const { key, slots, pools, range, ceiling, avoidAnchorParents, preferParents } = input;
  const objective = OBJECTIVES[key];
  let items: Item[] = [];
  const dropped: string[] = [];

  for (const slot of slots) {
    let pool = poolOf(pools, slot).filter((c) => c.eligible);
    if (slot.role === 'anchor' && avoidAnchorParents?.size) {
      const diverse = pool.filter((c) => !avoidAnchorParents.has(c.product.parentId));
      if (diverse.length) pool = diverse;
    }
    if (key === 'premium') {
      // Premium must buy a real upgrade, not just a higher price (§7).
      const upper = pool.filter(
        (c) => c.offer.sellingPrice >= slot.allocatedFils * PREMIUM_SLOT_FLOOR,
      );
      if (upper.length) pool = upper;
    }
    const related = (c: ScoredCandidate) =>
      preferParents?.get(c.product.type) === c.product.parentId ? CONSISTENCY_PICK_BONUS : 0;
    const best = maxBy(pool, (c) => objective.pick(c, slot) + related(c));
    if (!best) {
      dropped.push(slot.key);
      continue;
    }
    items.push({ ...best, slot, qty: slot.qty });
  }

  // Budget enforcement, AID-LOG-007 §4 protection order: preserve fit → preserve essentials →
  // adjust product tiers → reduce conditional/secondary → reduce decor. Anchors are never downgraded.
  for (const role of ['secondary', 'core'] as const) {
    if (totalOf(items) <= ceiling) break;
    const order = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => it.slot.role === role)
      .sort((a, b) => itemCost(b.it) - itemCost(a.it));
    for (const { it, idx } of order) {
      if (totalOf(items) <= ceiling) break;
      const cheaper = poolOf(pools, it.slot).filter(
        (c) =>
          c.eligible &&
          c.total >= MIN_PRODUCT_MATCH &&
          c.offer.sellingPrice < it.offer.sellingPrice,
      );
      const swap = maxBy(cheaper, (c) => c.total);
      if (swap) items[idx] = { ...swap, slot: it.slot, qty: it.qty };
    }
  }

  // Still over: remove non-essential secondary items, decor first, then the most expensive.
  while (totalOf(items) > ceiling) {
    const removable = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => !it.slot.essential && it.slot.role === 'secondary')
      .sort(
        (a, b) =>
          Number(DECOR_TYPES.has(b.it.product.type)) - Number(DECOR_TYPES.has(a.it.product.type)) ||
          itemCost(b.it) - itemCost(a.it),
      );
    const victim = removable[0];
    if (!victim) break;
    items = items.filter((_, idx) => idx !== victim.idx);
    dropped.push(victim.it.slot.key);
  }

  // Budget exceeds essential needs, AID-LOG-008 §6: improve quality, scale/fit and material match by
  // SWAPPING products only — never add products merely to consume budget. Not for Best Value,
  // whose objective is quality per dirham.
  if (key !== 'bestValue') {
    const floor = ceiling * UPGRADE_FLOOR_SHARE;
    for (let pass = 0; pass < UPGRADE_MAX_PASSES && totalOf(items) < floor; pass++) {
      const headroom = ceiling - totalOf(items);
      let best: { idx: number; c: ScoredCandidate; gain: number } | null = null;
      items.forEach((it, idx) => {
        for (const c of poolOf(pools, it.slot)) {
          if (!c.eligible || c.quality <= it.quality) continue;
          const delta = (c.offer.sellingPrice - it.offer.sellingPrice) * it.qty;
          if (delta <= 0 || delta > headroom) continue;
          const gain = (c.quality - it.quality) / Math.max(1, delta / it.qty);
          if (!best || gain > best.gain) best = { idx, c, gain };
        }
      });
      if (!best) break;
      const { idx, c } = best as { idx: number; c: ScoredCandidate };
      const target = items[idx] as Item;
      items[idx] = { ...c, slot: target.slot, qty: target.qty };
    }
  }

  return {
    key,
    label: objective.label,
    blurb: objective.blurb,
    items,
    droppedSlots: dropped,
    ceiling,
    slots,
    modified: false,
    ...scoreComposition(items, slots, range, ceiling),
  };
}
