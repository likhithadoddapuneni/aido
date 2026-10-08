import type { Kysely, Transaction } from 'kysely';
import type { DB } from '@aidooi/db';
import type { z } from 'zod';
import type { OfferSummarySchema, ProductSummarySchema } from '@aidooi/contracts';

type OfferSummary = z.infer<typeof OfferSummarySchema>;
type ProductSummary = z.infer<typeof ProductSummarySchema>;

type Q = Kysely<DB> | Transaction<DB>;

const scalarAttrs = (json: unknown): ProductSummary['attributes'] => {
  const out: ProductSummary['attributes'] = {};
  if (json && typeof json === 'object') {
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
};

/** Public product data for Product Cards. Dimensions are mandatory for anything Verified. */
export async function loadProductSummaries(
  db: Q,
  ids: readonly string[],
  mediaBaseUrl: string,
): Promise<Map<string, ProductSummary>> {
  const out = new Map<string, ProductSummary>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  const [products, media] = await Promise.all([
    db.selectFrom('catalogue.product').selectAll().where('id', 'in', unique).execute(),
    db
      .selectFrom('catalogue.product_media')
      .select(['product_id', 'storage_key', 'position'])
      .where('product_id', 'in', unique)
      .orderBy('position')
      .execute(),
  ]);
  const imagesOf = new Map<string, string[]>();
  for (const m of media) {
    const list = imagesOf.get(m.product_id) ?? [];
    list.push(`${mediaBaseUrl.replace(/\/$/, '')}/${m.storage_key}`);
    imagesOf.set(m.product_id, list);
  }
  for (const p of products) {
    out.set(p.id, {
      id: p.id,
      name: p.name,
      type: p.product_type,
      widthCm: p.width_cm ?? 0,
      depthCm: p.depth_cm ?? 0,
      heightCm: p.height_cm ?? 0,
      primaryColour: (p.primary_colour ?? 'multicolour') as ProductSummary['primaryColour'],
      secondaryColour: p.secondary_colour as ProductSummary['secondaryColour'],
      primaryStyle: (p.primary_style ?? 'modern') as ProductSummary['primaryStyle'],
      secondaryStyle: p.secondary_style as ProductSummary['secondaryStyle'],
      material: p.material_family ?? '',
      attributes: scalarAttrs(p.attributes),
      imageUrls: imagesOf.get(p.id) ?? [],
    });
  }
  return out;
}

/** Offer data a buyer may see: price, availability, where to view it, and the seller's after-sales terms. */
export async function loadOfferSummaries(
  db: Q,
  ids: readonly string[],
): Promise<Map<string, OfferSummary>> {
  const out = new Map<string, OfferSummary>();
  if (ids.length === 0) return out;
  const rows = await db
    .selectFrom('catalogue.seller_offer as o')
    .innerJoin('catalogue.partner as p', 'p.id', 'o.partner_id')
    .innerJoin('catalogue.partner_location as l', 'l.id', 'o.partner_location_id')
    .select([
      'o.id',
      'o.selling_price_fils',
      'o.original_price_fils',
      'o.availability',
      'o.viewing_status',
      'o.delivery_days',
      'p.id as partner_id',
      'p.trade_name',
      'p.after_sales_terms',
      'l.id as location_id',
      'l.name as location_name',
      'l.address',
      'l.emirate',
    ])
    .where('o.id', 'in', [...new Set(ids)])
    .execute();
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      sellingPrice: Number(r.selling_price_fils),
      originalPrice: r.original_price_fils === null ? null : Number(r.original_price_fils),
      availability: r.availability as OfferSummary['availability'],
      viewingStatus: r.viewing_status as OfferSummary['viewingStatus'],
      deliveryDays: r.delivery_days,
      partner: { id: r.partner_id, tradeName: r.trade_name, afterSalesTerms: r.after_sales_terms },
      location: { id: r.location_id, name: r.location_name, area: r.address, emirate: r.emirate },
    });
  }
  return out;
}
