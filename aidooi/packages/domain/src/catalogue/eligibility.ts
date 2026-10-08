import type { Offer, Product } from './types.ts';

/** AID-DATA-014: only Verified, Active products may enter recommendation. */
export const isEligibleProduct = (p: Product): boolean =>
  p.dataStatus === 'Verified' && p.lifecycle === 'Active';

/** AID-DATA-011 + MVP acceptance gate "Product Data". Partner activity is checked by the adapter. */
export const isEligibleOffer = (o: Offer): boolean =>
  o.offerStatus === 'Active' && o.availability !== 'Out of Stock' && o.stockQty > 0;

export const isOnDisplay = (o: Offer): boolean => o.viewingStatus === 'On Display';
export const isViewable = (o: Offer): boolean => o.viewingStatus !== 'Not Viewable';
