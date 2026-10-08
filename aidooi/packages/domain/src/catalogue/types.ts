import type { Bps, Fils } from '../kernel/money.ts';
import type { OfferId, ParentProductId, PartnerId, ProductId } from '../kernel/ids.ts';
import type { Instant } from '../kernel/time.ts';
import type { DataStatus } from '../machines/index.ts';
import type {
  Availability,
  ColourId,
  Lifecycle,
  MaterialFamily,
  OfferStatus,
  StyleId,
  ViewingStatus,
} from '../standards/vocab.ts';

/** AID-CAT-001…008 practical attributes. Mandatory ones decide eligibility; optional ones only rank. */
export interface ProductAttrs {
  readonly seats?: number;
  readonly bedSize?: string;
  readonly capacity?: number;
  readonly doorGroup?: string;
  readonly rugSize?: string;
  readonly adjustable?: boolean;
  readonly cableManagement?: boolean;
}

/** AID — the canonical physical variant (AID-DATA-002). */
export interface Product {
  readonly id: ProductId;
  readonly parentId: ParentProductId;
  readonly name: string;
  readonly type: string;
  /** Capacity / size branch used by the price matrix (e.g. Sofa "3", Bed "Queen"). */
  readonly branch: string | null;
  readonly primaryStyle: StyleId;
  readonly secondaryStyle: StyleId | null;
  readonly primaryColour: ColourId;
  readonly secondaryColour: ColourId | null;
  readonly material: MaterialFamily;
  readonly widthCm: number;
  readonly depthCm: number;
  readonly heightCm: number;
  readonly attrs: ProductAttrs;
  readonly dataStatus: DataStatus;
  readonly lifecycle: Lifecycle;
}

/** AIO — one seller's offer of one canonical product (AID-DATA-005, 010, 011). */
export interface Offer {
  readonly id: OfferId;
  readonly productId: ProductId;
  readonly partnerId: PartnerId;
  /** Current Selling Price: the basis for every calculation (AID-DATA-010). */
  readonly sellingPrice: Fils;
  /** Display only. Never drives tier or scoring. */
  readonly originalPrice: Fils | null;
  readonly availability: Availability;
  readonly stockQty: number;
  readonly viewingStatus: ViewingStatus;
  readonly viewingConfirmedAt: Instant | null;
  readonly deliveryDays: number;
  readonly commissionRate: Bps;
  readonly offerStatus: OfferStatus;
}

/**
 * Read model the engine runs against. In production it is backed by `catalogue.eligible_offer`;
 * the engine re-checks eligibility anyway so a wrong adapter cannot leak an ineligible product.
 */
export interface Catalogue {
  /** Identifies the exact catalogue state a run used, for reproducibility. */
  readonly version: string;
  productsOfType(type: string, branch: string | null): readonly Product[];
  offersOf(productId: ProductId): readonly Offer[];
}
