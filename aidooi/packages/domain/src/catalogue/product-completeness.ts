import { hasPriceRow } from '../standards/price-matrix.ts';
import { COLOUR_IDS, MATERIAL_FAMILIES, STYLE_IDS } from '../standards/vocab.ts';
import { BRANCHED_TYPES, branchOf } from './branch.ts';
import type { ProductAttrs } from './types.ts';

/** The fields of a product record that verification looks at, as stored (everything may be absent). */
export interface ProductDraft {
  readonly name: string | null;
  readonly type: string | null;
  readonly widthCm: number | null;
  readonly depthCm: number | null;
  readonly heightCm: number | null;
  readonly primaryColour: string | null;
  readonly material: string | null;
  readonly primaryStyle: string | null;
  readonly secondaryColour?: string | null;
  readonly secondaryStyle?: string | null;
  readonly attrs: ProductAttrs;
}

export interface Completeness {
  /** Mandatory fields that are absent (AID-DATA-006…009, AID-CAT practical attributes). */
  readonly missing: readonly string[];
  /** Fields present but outside their controlled vocabulary or priced range. */
  readonly invalid: readonly string[];
  readonly complete: boolean;
}

const inList = (v: string | null | undefined, list: readonly string[]) =>
  v === null || v === undefined || list.includes(v);

/**
 * AID-DATA-014: a product is verifiable only when everything recommendation needs is present and
 * valid. Mandatory fields decide eligibility; this is the single definition both the verification
 * queue and the verify action use.
 */
export function checkProductCompleteness(p: ProductDraft): Completeness {
  const missing: string[] = [];
  const invalid: string[] = [];
  if (!p.name?.trim()) missing.push('name');
  if (!p.type) missing.push('type');
  for (const [k, v] of [
    ['widthCm', p.widthCm],
    ['depthCm', p.depthCm],
    ['heightCm', p.heightCm],
  ] as const) {
    if (v === null) missing.push(k);
    else if (!(v > 0)) invalid.push(k);
  }
  if (!p.primaryColour) missing.push('primaryColour');
  if (!p.material) missing.push('material');
  if (!p.primaryStyle) missing.push('primaryStyle');

  if (!inList(p.primaryColour, COLOUR_IDS)) invalid.push('primaryColour');
  if (!inList(p.secondaryColour, COLOUR_IDS)) invalid.push('secondaryColour');
  if (!inList(p.material, MATERIAL_FAMILIES)) invalid.push('material');
  if (!inList(p.primaryStyle, STYLE_IDS)) invalid.push('primaryStyle');
  if (!inList(p.secondaryStyle, STYLE_IDS)) invalid.push('secondaryStyle');

  if (p.type) {
    if (!hasPriceRow(p.type)) invalid.push('type');
    else if (
      (BRANCHED_TYPES as readonly string[]).includes(p.type) &&
      branchOf(p.type, p.attrs) === null
    ) {
      missing.push('attributes.branch');
    }
  }
  return { missing, invalid, complete: missing.length === 0 && invalid.length === 0 };
}
