import { sum, times, type Fils } from '../kernel/money.ts';
import { materialPairScore, styleScore, colourScore } from '../standards/compatibility.ts';
import {
  BUDGET_PERFORMANCE,
  COMPOSITION_WEIGHTS,
  HARMONY_WEIGHTS,
  MIN_COMPOSITION,
  MIN_PRODUCT_MATCH,
  ROLE_WEIGHTS,
} from '../standards/constants.ts';
import { classifyComposition } from './scoring.ts';
import type { CompositionScore, HarmonyBreakdown, Item, Slot } from './types.ts';

export const compositionTotal = (items: readonly Item[]): Fils =>
  sum(items.map((i) => times(i.offer.sellingPrice, i.qty)));

/**
 * AID-LOG-010 §11 — Composition Harmony: the mean pairwise compatibility of every product
 * against every other, not only against the customer. A single product is trivially harmonious.
 */
export function harmony(items: readonly Item[]): HarmonyBreakdown {
  if (items.length < 2) return { style: 100, colour: 100, material: 100, total: 100 };
  let s = 0;
  let c = 0;
  let m = 0;
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = (items[i] as Item).product;
      const b = (items[j] as Item).product;
      s += styleScore(a.primaryStyle, b.primaryStyle, b.secondaryStyle);
      c += colourScore(a.primaryColour, b.primaryColour, b.secondaryColour);
      m += materialPairScore(a.material, b.material);
      n++;
    }
  }
  const style = s / n;
  const colour = c / n;
  const material = m / n;
  const w = HARMONY_WEIGHTS;
  return {
    style,
    colour,
    material,
    total: style * w.style + colour * w.colour + material * w.material,
  };
}

/** AID-LOG-010 §10 — role-weighted mean match score, renormalised over the roles present. */
export function productMatchQuality(items: readonly Item[]): number {
  const groups: Record<keyof typeof ROLE_WEIGHTS, number[]> = {
    anchor: [],
    core: [],
    secondary: [],
  };
  for (const it of items) groups[it.slot.role].push(it.total);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const present = (Object.keys(ROLE_WEIGHTS) as (keyof typeof ROLE_WEIGHTS)[]).filter(
    (k) => groups[k].length > 0,
  );
  const weightSum = present.reduce((t, k) => t + ROLE_WEIGHTS[k], 0);
  if (weightSum === 0) return 0;
  return present.reduce((t, k) => t + mean(groups[k]) * (ROLE_WEIGHTS[k] / weightSum), 0);
}

/** AID-LOG-010 §12 — Functional Completeness. -1 = an essential function is missing. */
export function completeness(items: readonly Item[], slots: readonly Slot[]): number {
  const filled = new Set(items.map((i) => i.slot.key));
  if (slots.some((s) => s.essential && !filled.has(s.key))) return -1;
  const coverage = (role: Slot['role']) => {
    const of = slots.filter((s) => s.role === role);
    return of.length ? of.filter((s) => filled.has(s.key)).length / of.length : 1;
  };
  const core = coverage('core');
  const secondary = coverage('secondary');
  if (core === 1 && secondary >= 0.8) return 100;
  if (core === 1 && secondary >= 0.4) return 85;
  if (core >= 0.75) return 70;
  return 60;
}

/**
 * AID-LOG-010 §13 — Budget Performance on total ÷ range ceiling. -1 = over the ceiling.
 * The ceiling never exceeds the range top by more than the Premium stretch (+20%), so
 * utilisation above 100% can only be a deliberate Premium choice and scores as full use.
 */
export function budgetPerformance(
  total: Fils,
  range: readonly [Fils, Fils],
  ceiling: Fils,
): number {
  if (total > ceiling) return -1;
  const u = total / range[1];
  if (u >= BUDGET_PERFORMANCE.full) return 100;
  if (u >= BUDGET_PERFORMANCE.good) return 85;
  if (u >= BUDGET_PERFORMANCE.fair) return 70;
  return 50; // weak or unbalanced use of the budget
}

/** AID-LOG-010 §9 — the Composition Score. */
export function scoreComposition(
  items: readonly Item[],
  slots: readonly Slot[],
  range: readonly [Fils, Fils],
  ceiling: Fils,
): CompositionScore {
  const total = compositionTotal(items);
  const comp = completeness(items, slots);
  const bp = budgetPerformance(total, range, ceiling);

  if (comp < 0) return { valid: false, total, reason: 'Essential function incomplete' };
  if (bp < 0) return { valid: false, total, reason: 'Over budget ceiling' };
  if (items.some((i) => i.total < MIN_PRODUCT_MATCH)) {
    return { valid: false, total, reason: 'Product below minimum match' };
  }

  const pmq = productMatchQuality(items);
  const h = harmony(items);
  const w = COMPOSITION_WEIGHTS;
  const score = Math.round(
    pmq * w.productMatchQuality +
      h.total * w.harmony +
      comp * w.completeness +
      bp * w.budgetPerformance,
  );
  if (score < MIN_COMPOSITION) {
    return {
      valid: false,
      total,
      score,
      reason: `Composition Score ${score} < ${MIN_COMPOSITION}`,
    };
  }
  return {
    valid: true,
    score,
    total,
    classification: classifyComposition(score),
    breakdown: { productMatchQuality: pmq, harmony: h, completeness: comp, budgetPerformance: bp },
  };
}
