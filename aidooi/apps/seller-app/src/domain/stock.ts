import type { Capabilities } from './roles.ts';

export interface OfferLike {
  readonly id: string;
  readonly version: number;
  readonly stockQty: number;
  readonly reservedQty: number;
  readonly sellingPrice: number;
  readonly viewingStatus: 'On Display' | 'Viewable on Request' | 'Not Viewable';
}

export interface StockDraft {
  readonly stockQty: number;
  readonly viewingStatus: OfferLike['viewingStatus'];
  /** Whole fils; only meaningful (and only sent) when the role may edit price. */
  readonly sellingPrice?: number;
}

export interface OfferPatch {
  readonly expectedVersion: number;
  readonly stockQty?: number;
  readonly viewingStatus?: OfferLike['viewingStatus'];
  readonly sellingPrice?: number;
  /** Setting On Display tells the platform the item is on the floor right now. */
  readonly displayConfirmed?: true;
}

/**
 * Send only what changed, with the version the user was looking at, and never a field their role cannot
 * touch. Returns null when nothing changed, so a no-op save never reaches the server.
 */
export function buildPatch(
  offer: OfferLike,
  draft: StockDraft,
  caps: Capabilities,
): OfferPatch | null {
  const patch: { -readonly [K in keyof OfferPatch]: OfferPatch[K] } = {
    expectedVersion: offer.version,
  };
  let changed = false;
  if (draft.stockQty !== offer.stockQty) {
    patch.stockQty = draft.stockQty;
    changed = true;
  }
  if (draft.viewingStatus !== offer.viewingStatus) {
    patch.viewingStatus = draft.viewingStatus;
    if (draft.viewingStatus === 'On Display') patch.displayConfirmed = true;
    changed = true;
  }
  if (
    caps.editPrice &&
    draft.sellingPrice !== undefined &&
    draft.sellingPrice !== offer.sellingPrice
  ) {
    patch.sellingPrice = draft.sellingPrice;
    changed = true;
  }
  return changed ? patch : null;
}

/** Stock can never go below what buyers are holding in live checkouts (the server refuses it as well). */
export const lowestAllowedStock = (offer: Pick<OfferLike, 'reservedQty'>): number =>
  offer.reservedQty;

export type EditFailure =
  | { readonly kind: 'held'; readonly held: number | null }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'other'; readonly code: string };

/** Turn the API's refusal into something the sheet can explain in the user's language. */
export function interpretEditFailure(
  code: string,
  detail: string | undefined,
  offer: OfferLike,
): EditFailure {
  if (code === 'stock_below_reserved') {
    const m = detail ? /(\d+) unit/.exec(detail) : null;
    return { kind: 'held', held: m ? Number(m[1]) : offer.reservedQty || null };
  }
  if (code === 'offer_version_conflict') return { kind: 'conflict' };
  return { kind: 'other', code };
}

/**
 * "1,234.50" or "1234.5" (also Arabic-Indic digits) → whole fils, or null if it is not a sensible price.
 * Money is never held as a float: the text is split at the decimal point and parsed as integers.
 */
export function aedToFils(text: string): number | null {
  const latin = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,\s]/g, '')
    .replace('٫', '.');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(latin);
  if (!m) return null;
  const fils = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return fils > 0 ? fils : null;
}

export const filsToAedText = (fils: number): string =>
  `${Math.trunc(fils / 100)}.${String(fils % 100).padStart(2, '0')}`;
