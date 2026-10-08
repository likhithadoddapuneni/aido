import type { Kysely, Transaction } from 'kysely';
import type { DB } from '@aidooi/db';
import {
  SnapshotCatalogue,
  bpsFromRate,
  branchOf,
  fils,
  instant,
  offerId,
  parentProductId,
  partnerId,
  productId,
  type Offer,
  type Product,
  type ProductAttrs,
} from '@aidooi/domain';

type Q = Kysely<DB> | Transaction<DB>;

/** Columns of a SQL view are typed nullable even when the view guarantees them. */
function nn<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(`eligible_offer.${what} was unexpectedly null`);
  return v;
}

const ATTR_KEYS = [
  'seats',
  'bedSize',
  'capacity',
  'doorGroup',
  'rugSize',
  'adjustable',
  'cableManagement',
] as const;

/** Only known practical attributes cross into the engine; anything else in the JSON is ignored. */
function attrsOf(json: unknown): ProductAttrs {
  const src = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ATTR_KEYS) if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
  return out as ProductAttrs;
}

/**
 * Load the eligible slice of the catalogue for the given product types as an immutable snapshot the
 * (synchronous, pure) engine can run against.
 *
 * Eligibility is decided by `catalogue.eligible_offer` and nowhere else (ADR-024): this query starts
 * from the view, so a product or offer that is not Verified, Active, in stock and from an Active
 * partner cannot appear here no matter what the caller asks for.
 */
export async function loadSnapshot(db: Q, types: readonly string[]): Promise<SnapshotCatalogue> {
  if (types.length === 0) return new SnapshotCatalogue('empty', [], []);

  const rows = await db
    .selectFrom('catalogue.eligible_offer as eo')
    .innerJoin('catalogue.seller_offer as so', 'so.id', 'eo.offer_id')
    .innerJoin('catalogue.product as p', 'p.id', 'eo.product_id')
    .select([
      'eo.offer_id',
      'eo.product_id',
      'eo.partner_id',
      'eo.selling_price_fils',
      'eo.availability',
      'eo.stock_qty',
      'eo.viewing_status',
      'eo.delivery_days',
      'eo.commission_rate',
      'so.original_price_fils',
      'so.viewing_confirmed_at',
      'so.offer_status',
      'so.updated_at as offer_updated_at',
      'p.parent_id',
      'p.name',
      'p.product_type',
      'p.width_cm',
      'p.depth_cm',
      'p.height_cm',
      'p.primary_colour',
      'p.secondary_colour',
      'p.material_family',
      'p.primary_style',
      'p.secondary_style',
      'p.attributes',
      'p.data_status',
      'p.lifecycle',
      'p.updated_at as product_updated_at',
    ])
    .where('eo.product_type', 'in', [...types])
    // Stable order: the engine's tie-break is total, but a stable load keeps snapshots byte-identical.
    .orderBy('eo.product_id')
    .orderBy('eo.offer_id')
    .execute();

  const products = new Map<string, Product>();
  const offers: Offer[] = [];
  let latest = 0;

  for (const r of rows) {
    const pid = nn(r.product_id, 'product_id');
    // Verified products always carry these (a CHECK guarantees it); a null here means the schema was bypassed.
    if (
      !r.width_cm ||
      !r.depth_cm ||
      !r.height_cm ||
      !r.primary_colour ||
      !r.material_family ||
      !r.primary_style
    ) {
      throw new Error(`Verified product ${pid} is missing mandatory fields`);
    }
    if (!products.has(pid)) {
      const attrs = attrsOf(r.attributes);
      products.set(pid, {
        id: productId(pid),
        parentId: parentProductId(r.parent_id),
        name: r.name,
        type: r.product_type,
        branch: branchOf(r.product_type, attrs),
        primaryStyle: r.primary_style as Product['primaryStyle'],
        secondaryStyle: (r.secondary_style as Product['secondaryStyle']) ?? null,
        primaryColour: r.primary_colour as Product['primaryColour'],
        secondaryColour: (r.secondary_colour as Product['secondaryColour']) ?? null,
        material: r.material_family as Product['material'],
        widthCm: r.width_cm,
        depthCm: r.depth_cm,
        heightCm: r.height_cm,
        attrs,
        dataStatus: r.data_status as Product['dataStatus'],
        lifecycle: r.lifecycle as Product['lifecycle'],
      });
    }
    offers.push({
      id: offerId(nn(r.offer_id, 'offer_id')),
      productId: productId(pid),
      partnerId: partnerId(nn(r.partner_id, 'partner_id')),
      sellingPrice: fils(Number(nn(r.selling_price_fils, 'selling_price_fils'))),
      originalPrice: r.original_price_fils === null ? null : fils(Number(r.original_price_fils)),
      availability: nn(r.availability, 'availability') as Offer['availability'],
      stockQty: nn(r.stock_qty, 'stock_qty'),
      viewingStatus: nn(r.viewing_status, 'viewing_status') as Offer['viewingStatus'],
      viewingConfirmedAt: r.viewing_confirmed_at
        ? instant(new Date(r.viewing_confirmed_at).getTime())
        : null,
      deliveryDays: nn(r.delivery_days, 'delivery_days'),
      commissionRate: bpsFromRate(Number(nn(r.commission_rate, 'commission_rate'))),
      offerStatus: r.offer_status as Offer['offerStatus'],
    });
    latest = Math.max(
      latest,
      new Date(r.offer_updated_at).getTime(),
      new Date(r.product_updated_at).getTime(),
    );
  }

  // The version names the exact slice a run used: newest change plus the size of the slice.
  const version = `${new Date(latest).toISOString()}#${offers.length}`;
  return new SnapshotCatalogue(version, [...products.values()], offers);
}
