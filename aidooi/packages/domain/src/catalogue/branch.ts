import type { ProductAttrs } from './types.ts';

/**
 * The price-matrix branch of a product is *derived* from its practical attributes, never stored
 * separately — one source of truth (AID-CAT-001…008 attributes), no way for the two to disagree.
 */
export function branchOf(type: string, attrs: ProductAttrs): string | null {
  switch (type) {
    case 'Sofa':
      return attrs.seats === undefined ? null : String(attrs.seats);
    case 'Bed':
      return attrs.bedSize ?? null;
    case 'Dining Table':
      return attrs.capacity === undefined ? null : String(attrs.capacity);
    case 'Wardrobe':
      return attrs.doorGroup ?? null;
    case 'Rug':
      return attrs.rugSize ?? null;
    default:
      return null;
  }
}

/** Types whose price depends on a branch; a verified product of these types must carry one. */
export const BRANCHED_TYPES = ['Sofa', 'Bed', 'Dining Table', 'Wardrobe', 'Rug'] as const;
