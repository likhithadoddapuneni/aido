/**
 * Every numeric rule the standards publish, in one place, each with its source clause.
 * Interpretation calls where the standards are silent are marked `(gap #n / call X)` and
 * indexed in docs/05-gaps-and-decisions.md.
 */
import { aed, bps } from '../kernel/money.ts';

export const STANDARDS_VERSION = '2026.1';

/** Bump when scoring or composition *logic* changes (not data tables); stamped on every run. */
export const ENGINE_VERSION = '1';

/** AID-LOG-009 §3 — Match Score weights. Sum to 1. */
export const MATCH_WEIGHTS = {
  fit: 0.3,
  style: 0.25,
  colour: 0.15,
  budget: 0.15,
  practical: 0.1,
  availability: 0.05,
} as const;

/** AID-LOG-010 §9 — Composition Score weights. Sum to 1. */
export const COMPOSITION_WEIGHTS = {
  productMatchQuality: 0.4,
  harmony: 0.3,
  completeness: 0.2,
  budgetPerformance: 0.1,
} as const;

/** AID-LOG-010 §11 — harmony sub-weights. */
export const HARMONY_WEIGHTS = { style: 0.5, colour: 0.3, material: 0.2 } as const;

/** AID-LOG-010 §10 — role weights for Product Match Quality (renormalised over roles present). */
export const ROLE_WEIGHTS = { anchor: 0.5, core: 0.35, secondary: 0.15 } as const;

export const MIN_PRODUCT_MATCH = 60; // AID-LOG-009 §10
export const MIN_FIT = 50; // AID-LOG-009 §4
export const MIN_COMPOSITION = 70; // AID-LOG-010 §15
export const PREMIUM_STRETCH = 0.2; // AID-LOG-010 §7

/** Fit bands for width outside the preferred band (gap: LOG-009 §4 gives levels, not tolerances — call A). */
export const FIT_DEVIATION_BANDS = [
  { maxDeviation: 0.1, score: 85 },
  { maxDeviation: 0.25, score: 70 },
  { maxDeviation: 0.4, score: 50 },
] as const;

/** "Available Placement Space" approximation (gap #6): usable share of the longest wall run. */
export const USABLE_WALL_SHARE = { anchor: 0.8, other: 0.92 } as const;
/** When only an area is known, assume a wall of 1.2 × √area metres. */
export const WALL_FROM_AREA_FACTOR_CM = 120;

/** AID-LOG-009 §7 — price ÷ slot allocation above this makes the allocation unworkable (reject). */
export const BUDGET_REJECT_ABOVE = 1.35;

/** Delivery at or under this many days counts as "fast" (gap: LOG-009 §9, call E). */
export const FAST_DELIVERY_DAYS = 5;

/** Share of the ceiling allocated across slots; the rest is headroom for replacements (call B). */
export const ALLOCATION_SHARE = 0.92;
/** AID-LOG-008 §6 upgrade pass runs while the composition sits below this share of the ceiling. */
export const UPGRADE_FLOOR_SHARE = 0.82;
export const UPGRADE_MAX_PASSES = 40;
/**
 * Bedroom consistency (gap #12, docs/adrs.md): when the buyer wants the bedrooms to look related, a
 * candidate from the same product family (AIP) as the reference bedroom's choice for that slot gets this
 * bonus in the *selection* pick only — never in the Match Score, eligibility or budget.
 */
export const CONSISTENCY_PICK_BONUS = 5;
/** Premium keeps candidates at or above this share of the slot's own allocation (LOG-010 §7). */
export const PREMIUM_SLOT_FLOOR = 0.85;
/** "Meaningful improvement" thresholds for showing Premium (gap #8). */
export const PREMIUM_MIN_SCORE_GAIN = 1;
export const PREMIUM_MIN_TOTAL_GAIN = 0.05;

/** AID-LOG-010 §13 budget performance thresholds on total ÷ range ceiling (call C). */
export const BUDGET_PERFORMANCE = { full: 0.8, good: 0.65, fair: 0.45 } as const;

/* ---------------- Commerce (AID-LOG-012, 014, 015) ---------------- */

export const DEPOSIT_RATE = bps(500); // AID-LOG-012 §5 — 5%
export const DEPOSIT_CAP = aed(500); // per viewing request (decision D8)
export const PURCHASE_WINDOW_HOURS = 24; // AID-LOG-014 §3
/** A seller must answer an explicit purchase confirmation within this long (ADR-028). */
export const PURCHASE_CONFIRMATION_SLA_HOURS = 4;
export const RECEIPT_AUTOCONFIRM_HOURS = 72; // AID-LOG-015 §7
/** After a Completed viewing the deposit waits this long for a purchase before auto-refund (ADR-030). */
export const DEPOSIT_CREDIT_WINDOW_DAYS = 7;
/** A viewing confirmation older than this must be reconfirmed before reuse (AID-LOG-012 §4; ADR-033). */
export const VIEWING_RECONFIRM_HOURS = 72;
