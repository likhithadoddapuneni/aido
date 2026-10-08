import { sql, type Kysely } from 'kysely';
import { COMPAT_MAPS, COMPAT_MAP_VERSION } from '@aidooi/domain';
import { seedCatalogue } from '@aidooi/domain/testing';
import type { DB } from '../generated/db.ts';

export interface SeededDatabase {
  readonly opsUserId: string;
  /** Seed partner code ('PRT-001') → partner uuid. */
  readonly partners: ReadonlyMap<string, string>;
  /** Partner uuid → its single showroom uuid. */
  readonly locations: ReadonlyMap<string, string>;
  readonly catalogueVersion: string;
}

/**
 * Loads the deterministic seed catalogue (the same data the prototype and the domain tests use)
 * into a real database, and approves the compatibility maps the code ships. Test and demo use only.
 */
export async function seedDatabase(db: Kysely<DB>, seed = 20260101): Promise<SeededDatabase> {
  const { catalogue, partners: seedPartners } = seedCatalogue(seed);

  const ops = await db
    .insertInto('identity.ops_user')
    .values({
      email: 'merchandising@aidooi.test',
      full_name: 'Merchandising Lead',
      role: 'ops_admin',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  for (const kind of ['style', 'colour', 'material'] as const) {
    await db
      .insertInto('catalogue.compat_map_version')
      .values({
        kind,
        version: COMPAT_MAP_VERSION,
        content: JSON.stringify(COMPAT_MAPS[kind]),
        approved_by: ops.id,
        activated_at: new Date(),
      })
      .execute();
  }

  const partners = new Map<string, string>();
  const locations = new Map<string, string>();
  for (const [i, p] of seedPartners.entries()) {
    const row = await db
      .insertInto('catalogue.partner')
      .values({
        code: `PRT-${String(i + 1).padStart(4, '0')}`,
        legal_name: `${p.name} LLC`,
        trade_name: p.name,
        status: 'Active',
        commission_rate: p.commission,
        activated_at: new Date(),
        after_sales_terms: 'Returns accepted within 7 days if unused.',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    partners.set(p.id, row.id);
    const loc = await db
      .insertInto('catalogue.partner_location')
      .values({
        partner_id: row.id,
        name: `${p.name} Showroom`,
        address: p.location,
        emirate: emirateOf(p.location),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    locations.set(row.id, loc.id);
  }

  const parents = new Map<string, string>();
  for (const p of catalogue.products) {
    if (!parents.has(p.parentId)) {
      await db
        .insertInto('catalogue.parent_product')
        .values({ id: p.parentId, model_name: p.name })
        .execute();
      parents.set(p.parentId, p.parentId);
    }
  }
  const verifiedAt = new Date();
  for (const batch of chunk(catalogue.products, 200)) {
    await db
      .insertInto('catalogue.product')
      .values(
        batch.map((p) => ({
          id: p.id,
          parent_id: p.parentId,
          name: p.name,
          main_category: 'Furniture',
          category: p.type,
          product_type: p.type,
          width_cm: p.widthCm,
          depth_cm: p.depthCm,
          height_cm: p.heightCm,
          primary_colour: p.primaryColour,
          secondary_colour: p.secondaryColour,
          material_family: p.material,
          primary_style: p.primaryStyle,
          secondary_style: p.secondaryStyle,
          attributes: JSON.stringify(p.attrs),
          data_status: 'Verified',
          lifecycle: 'Active',
          verified_by: ops.id,
          verified_at: verifiedAt,
        })),
      )
      .execute();
  }
  let n = 0;
  for (const batch of chunk(catalogue.offers, 200)) {
    await db
      .insertInto('catalogue.seller_offer')
      .values(
        batch.map((o) => {
          const partnerId = partners.get(o.partnerId) as string;
          return {
            id: o.id,
            product_id: o.productId,
            partner_id: partnerId,
            partner_location_id: locations.get(partnerId) as string,
            seller_sku: `SKU-${++n}`,
            selling_price_fils: o.sellingPrice,
            original_price_fils: o.originalPrice,
            availability: o.availability,
            stock_qty: o.stockQty,
            viewing_status: o.viewingStatus,
            viewing_confirmed_at: o.viewingStatus === 'On Display' ? new Date() : null,
            delivery_days: o.deliveryDays,
            commission_rate: o.commissionRate / 10_000,
            offer_status: 'Active',
          };
        }),
      )
      .execute();
  }

  // Business ids were inserted explicitly; move the sequences past them so later inserts do not collide.
  await sql`SELECT setval('catalogue.aip_seq', ${parents.size}), setval('catalogue.aid_seq', ${catalogue.products.length}), setval('catalogue.aio_seq', ${catalogue.offers.length})`.execute(
    db,
  );

  return { opsUserId: ops.id, partners, locations, catalogueVersion: catalogue.version };
}

const chunk = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n) as T[]);
  return out;
};

const emirateOf = (location: string): string =>
  location.includes('Abu Dhabi') ? 'Abu Dhabi' : location.includes('Sharjah') ? 'Sharjah' : 'Dubai';
