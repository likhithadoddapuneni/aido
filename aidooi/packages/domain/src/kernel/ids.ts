/**
 * AID-DATA-005 identifiers. They identify; they never describe — nothing in the domain
 * may parse an id to learn a product's characteristics.
 */
declare const brand: unique symbol;
type Branded<T extends string> = string & { readonly [brand]: T };

export type ParentProductId = Branded<'AIP'>;
export type ProductId = Branded<'AID'>;
export type OfferId = Branded<'AIO'>;
export type PartnerId = Branded<'Partner'>;
export type PartnerLocationId = Branded<'PartnerLocation'>;
export type CustomerId = Branded<'Customer'>;
export type OrderLineId = Branded<'OrderLine'>;

const PATTERNS = {
  AIP: /^AIP-\d{8}$/,
  AID: /^AID-\d{8}$/,
  AIO: /^AIO-\d{8}$/,
} as const;

function parse<T extends keyof typeof PATTERNS>(kind: T, value: string): string {
  if (!PATTERNS[kind].test(value)) throw new TypeError(`Invalid ${kind} identifier: ${value}`);
  return value;
}

export const parentProductId = (v: string) => parse('AIP', v) as ParentProductId;
export const productId = (v: string) => parse('AID', v) as ProductId;
export const offerId = (v: string) => parse('AIO', v) as OfferId;

/** Ids owned by other bounded contexts are opaque to the domain. */
export const partnerId = (v: string) => v as PartnerId;
export const partnerLocationId = (v: string) => v as PartnerLocationId;
export const customerId = (v: string) => v as CustomerId;
export const orderLineId = (v: string) => v as OrderLineId;

export const formatCatalogueId = (kind: keyof typeof PATTERNS, n: number): string => {
  if (!Number.isInteger(n) || n < 1 || n > 99_999_999)
    throw new RangeError('Sequence out of range');
  return `${kind}-${String(n).padStart(8, '0')}`;
};
