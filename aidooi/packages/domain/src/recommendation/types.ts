import type { Fils } from '../kernel/money.ts';
import type { Offer, Product } from '../catalogue/types.ts';
import type { ResolvedSlot, RoomPath, RoomSpec, SizeClass } from '../standards/rooms.ts';
import type { ColourPreference, StylePreference, Tier } from '../standards/vocab.ts';

export interface RoomProject {
  readonly path: RoomPath;
  readonly tier: Tier;
  readonly style: StylePreference;
  readonly colour: ColourPreference;
  readonly spec: RoomSpec & {
    readonly lengthM?: number;
    readonly widthM?: number;
    readonly areaM2?: number;
  };
  /** A module of a larger project is budgeted from its allocated share, not the room tier table. */
  readonly budgetOverride?: readonly [Fils, Fils];
  /**
   * Bedroom consistency: for each product type, the parent product (AIP) another bedroom chose. Matching
   * candidates get a small selection bonus. It never changes a Match Score or what is eligible.
   */
  readonly preferParents?: ReadonlyMap<string, string>;
}

export interface RoomGeometry {
  readonly areaM2: number;
  readonly sizeClass: SizeClass;
  readonly longestWallCm: number;
}

/** A composition slot with its budget allocation (AID-LOG-007 §4). Allocation is a target, not money. */
export interface Slot extends ResolvedSlot {
  readonly key: string;
  readonly allocatedTotalFils: number;
  readonly allocatedFils: number;
}

export interface ScoredCandidate {
  readonly product: Product;
  readonly offer: Offer;
  readonly fit: number;
  readonly style: number;
  readonly colour: number;
  readonly budget: number;
  readonly practical: number;
  readonly avail: number;
  /** AIDOOi Match Score, 0–100 (AID-LOG-009 §3). */
  readonly total: number;
  /** Budget-independent quality for the AID-LOG-008 §6 upgrade pass. */
  readonly quality: number;
  readonly eligible: boolean;
  readonly rejectedFor: string | null;
}

export interface Item extends ScoredCandidate {
  readonly slot: Slot;
  readonly qty: number;
}

export interface HarmonyBreakdown {
  readonly style: number;
  readonly colour: number;
  readonly material: number;
  readonly total: number;
}

export type CompositionScore =
  | {
      readonly valid: true;
      readonly score: number;
      readonly total: Fils;
      readonly classification: string;
      readonly breakdown: {
        readonly productMatchQuality: number;
        readonly harmony: HarmonyBreakdown;
        readonly completeness: number;
        readonly budgetPerformance: number;
      };
    }
  | {
      readonly valid: false;
      readonly total: Fils;
      readonly reason: string;
      /** Present when the composition scored but fell below the minimum. */
      readonly score?: number;
    };

export type ObjectiveKey = 'bestOverall' | 'bestValue' | 'bestStyle' | 'premium';

export type Option = {
  readonly key: ObjectiveKey;
  readonly label: string;
  readonly blurb: string;
  readonly items: readonly Item[];
  readonly droppedSlots: readonly string[];
  readonly ceiling: Fils;
  readonly slots: readonly Slot[];
  /** True once the customer replaced or removed something (the option is no longer system-generated). */
  readonly modified: boolean;
  readonly suppressed?: string;
} & CompositionScore;

/** One scored (slot, offer) pair, rejected or not: what makes a run explainable (AID-LOG-009). */
export interface EvaluatedCandidate {
  readonly slotKey: string;
  readonly productId: string;
  readonly offerId: string;
  readonly fit: number;
  readonly style: number;
  readonly colour: number;
  readonly budget: number;
  readonly practical: number;
  readonly avail: number;
  readonly total: number;
  readonly quality: number;
  readonly eligible: boolean;
  readonly rejectedFor: string | null;
}

export type RunStatus = 'Completed' | 'Limited Inventory' | 'Failed';

export interface RunResult {
  readonly status: RunStatus;
  readonly engineVersion: string;
  readonly standardsVersion: string;
  readonly compatMapVersion: string;
  readonly catalogueVersion: string;
  readonly geometry: RoomGeometry;
  readonly range: readonly [Fils, Fils];
  readonly ceiling: Fils;
  readonly slots: readonly Slot[];
  /** Every candidate scored in the base pass (the Premium pass differs only in budget allocation). */
  readonly evaluated: readonly EvaluatedCandidate[];
  readonly options: readonly Option[];
  readonly suppressed: readonly Option[];
  readonly reason?: string;
}
