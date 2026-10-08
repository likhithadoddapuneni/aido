import type { Selectable } from 'kysely';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type {
  CreateOfferBodySchema,
  CreatedOfferSchema,
  OfferSchema,
  OffersPageSchema,
  OffersQuerySchema,
  UpdateOfferBodySchema,
} from '@aidooi/contracts';
import type { DB } from '@aidooi/db';
import { recordAudit } from '../../audit.ts';
import { runAs, type AppContext, type Tx } from '../../context.ts';
import { HttpError, conflict, forbidden, notFound } from '../../http/problem.ts';
import {
  decodeIdCursor,
  encodeIdCursor,
  iso,
  likeEscape,
  requireManager,
  type SellerActor,
} from './common.ts';
import { createProductRow, toSellerProduct } from './products.ts';
import { requireSeller } from '../../http/actor.ts';

type Offer = z.infer<typeof OfferSchema>;
type OfferRow = Selectable<DB['catalogue.seller_offer']>;
type Availability = Offer['availability'];

/** What shop-floor staff may change: the stock and display facts only. Everything commercial is manager/owner. */
const STAFF_FIELDS: ReadonlySet<string> = new Set([
  'expectedVersion',
  'stockQty',
  'availability',
  'viewingStatus',
  'displayConfirmed',
]);

const unprocessable = (code: string, message: string, path?: string) =>
  new HttpError(422, code, message, path ? [{ path, message }] : undefined);

/** Stock and availability must tell one story (the table's CHECK is one-directional; we keep both). */
export function reconcile(stockQty: number, requested: Availability | undefined): Availability {
  if (stockQty === 0) {
    if (requested !== undefined && requested !== 'Out of Stock')
      throw unprocessable(
        'availability_conflicts_with_stock',
        'With no stock the offer is Out of Stock.',
        'availability',
      );
    return 'Out of Stock';
  }
  if (requested === 'Out of Stock')
    throw unprocessable(
      'availability_conflicts_with_stock',
      'Set stock to 0 to mark an offer Out of Stock.',
      'availability',
    );
  return requested ?? 'In Stock';
}

function assertPrices(selling: number, original: number | null): void {
  if (original !== null && original < selling)
    throw unprocessable(
      'original_price_below_selling',
      'Original price cannot be lower than the selling price.',
      'originalPrice',
    );
}

const baseQuery = (trx: Tx) =>
  trx
    .selectFrom('catalogue.seller_offer as o')
    .innerJoin('catalogue.product as p', 'p.id', 'o.product_id')
    .leftJoin('commerce.reserved_qty as rq', 'rq.offer_id', 'o.id')
    .select([
      'o.id',
      'o.product_id',
      'o.seller_sku',
      'o.selling_price_fils',
      'o.original_price_fils',
      'o.stock_qty',
      'o.availability',
      'o.delivery_days',
      'o.viewing_status',
      'o.viewing_confirmed_at',
      'o.partner_location_id',
      'o.offer_status',
      'o.version',
      'o.updated_at',
      'p.name',
      'p.product_type',
      'p.data_status',
      'p.lifecycle',
      'rq.reserved',
    ]);

type OfferJoin = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number];

const toOffer = (r: OfferJoin): Offer => ({
  id: r.id,
  productId: r.product_id,
  productName: r.name,
  productType: r.product_type,
  productDataStatus: r.data_status as Offer['productDataStatus'],
  sku: r.seller_sku,
  sellingPrice: Number(r.selling_price_fils),
  originalPrice: r.original_price_fils === null ? null : Number(r.original_price_fils),
  stockQty: r.stock_qty,
  reservedQty: r.reserved ?? 0,
  availability: r.availability as Availability,
  deliveryDays: r.delivery_days,
  viewingStatus: r.viewing_status as Offer['viewingStatus'],
  viewingConfirmedAt: r.viewing_confirmed_at ? iso(r.viewing_confirmed_at) : null,
  locationId: r.partner_location_id,
  status: r.offer_status as Offer['status'],
  version: r.version,
  live:
    r.data_status === 'Verified' &&
    r.lifecycle === 'Active' &&
    r.offer_status === 'Active' &&
    r.availability !== 'Out of Stock' &&
    r.stock_qty > 0,
  updatedAt: iso(r.updated_at),
});

async function loadOffer(trx: Tx, partnerId: string, id: string): Promise<Offer> {
  const r = await baseQuery(trx)
    .where('o.id', '=', id)
    .where('o.partner_id', '=', partnerId)
    .executeTakeFirst();
  if (!r) throw notFound('Offer');
  return toOffer(r);
}

/** The seller's own showroom, still open. A staff member tied to one showroom may not use another. */
async function assertLocation(trx: Tx, seller: SellerActor, locationId: string): Promise<void> {
  const loc = await trx
    .selectFrom('catalogue.partner_location')
    .select('status')
    .where('id', '=', locationId)
    .where('partner_id', '=', seller.partnerId)
    .executeTakeFirst();
  if (!loc) throw notFound('Location');
  if (loc.status !== 'Active') throw conflict('location_inactive', 'That showroom is closed.');
  if (seller.locationId && seller.locationId !== locationId)
    throw forbidden('You work at a different showroom.');
}

/** Uniqueness violations become the 409 they mean, whichever of the two unique keys tripped. */
function mapUnique<T>(work: Promise<T>): Promise<T> {
  return work.catch((e: { code?: string; constraint?: string }) => {
    if (e?.code === '23505' && e.constraint === 'seller_offer_sku_uq')
      throw conflict('duplicate_sku', 'You already use that SKU.');
    if (e?.code === '23505' && e.constraint === 'seller_offer_unique_listing_uq')
      throw conflict('duplicate_listing', 'You already list this product at that showroom.');
    throw e;
  });
}

export async function listOffers(
  ctx: AppContext,
  req: FastifyRequest,
  q: z.infer<typeof OffersQuerySchema>,
): Promise<z.infer<typeof OffersPageSchema>> {
  const seller = requireSeller(req);
  const after = decodeIdCursor(q.cursor);
  return runAs(ctx, req, async (trx) => {
    let query = baseQuery(trx).where('o.partner_id', '=', seller.partnerId);
    if (seller.locationId) query = query.where('o.partner_location_id', '=', seller.locationId);
    if (q.status) query = query.where('o.offer_status', '=', q.status);
    if (q.availability) query = query.where('o.availability', '=', q.availability);
    if (q.q) {
      const like = `%${likeEscape(q.q)}%`;
      query = query.where((e) =>
        e.or([e('p.name', 'ilike', like), e('o.seller_sku', 'ilike', like)]),
      );
    }
    if (after) query = query.where('o.id', '>', after);
    const rows = await query
      .orderBy('o.id')
      .limit(q.limit + 1)
      .execute();
    const items = rows.slice(0, q.limit).map(toOffer);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > q.limit && last ? encodeIdCursor(last.id) : null };
  });
}

export async function getOffer(ctx: AppContext, req: FastifyRequest, id: string): Promise<Offer> {
  const seller = requireSeller(req);
  return runAs(ctx, req, (trx) => loadOffer(trx, seller.partnerId, id));
}

export async function createOffer(
  ctx: AppContext,
  req: FastifyRequest,
  body: z.infer<typeof CreateOfferBodySchema>,
): Promise<z.infer<typeof CreatedOfferSchema>> {
  const seller = requireManager(req);
  const availability = reconcile(body.stockQty, body.availability);
  assertPrices(body.sellingPrice, body.originalPrice);
  return mapUnique(
    runAs(ctx, req, async (trx) => {
      await assertLocation(trx, seller, body.locationId);
      const partner = await trx
        .selectFrom('catalogue.partner')
        .select(['commission_rate', 'status'])
        .where('id', '=', seller.partnerId)
        .executeTakeFirstOrThrow();

      let productId: string;
      if (body.productId) {
        const p = await trx
          .selectFrom('catalogue.product')
          .select(['id', 'data_status', 'lifecycle'])
          .where('id', '=', body.productId)
          .executeTakeFirst();
        if (!p) throw notFound('Product');
        if (p.data_status !== 'Verified' || p.lifecycle !== 'Active')
          throw unprocessable(
            'product_not_verified',
            'Only Verified products can be listed. Submit a new product for review instead.',
            'productId',
          );
        productId = p.id;
      } else {
        productId = (await createProductRow(trx, seller.partnerId, body.newProduct!, req.actor!))
          .id;
      }

      const now = new Date(ctx.clock.now());
      const row = await trx
        .insertInto('catalogue.seller_offer')
        .values({
          product_id: productId,
          partner_id: seller.partnerId,
          partner_location_id: body.locationId,
          seller_sku: body.sku,
          selling_price_fils: body.sellingPrice,
          original_price_fils: body.originalPrice,
          availability,
          stock_qty: body.stockQty,
          viewing_status: body.viewingStatus,
          viewing_confirmed_at: body.viewingStatus === 'On Display' ? now : null,
          delivery_days: body.deliveryDays,
          // The agreed rate is snapshotted from the partner record; a seller never supplies it.
          commission_rate: partner.commission_rate,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await recordAudit(trx, {
        entityType: 'seller_offer',
        entityId: row.id,
        from: null,
        to: 'Active',
        actor: req.actor!,
        data: {
          productId,
          sku: body.sku,
          sellingPrice: body.sellingPrice,
          stockQty: body.stockQty,
        },
      });
      const productRow = await trx
        .selectFrom('catalogue.product')
        .selectAll()
        .where('id', '=', productId)
        .executeTakeFirstOrThrow();
      return {
        offer: await loadOffer(trx, seller.partnerId, row.id),
        product: await toSellerProduct(trx, productRow),
      };
    }),
  );
}

export async function updateOffer(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  body: z.infer<typeof UpdateOfferBodySchema>,
): Promise<Offer> {
  const seller = requireSeller(req);
  if (seller.role === 'seller_staff') {
    const extra = Object.keys(body).filter((k) => !STAFF_FIELDS.has(k));
    if (extra.length)
      throw forbidden(`Staff can change stock and display status only, not: ${extra.join(', ')}.`);
  }
  return mapUnique(
    runAs(ctx, req, async (trx) => {
      const row: OfferRow | undefined = await trx
        .selectFrom('catalogue.seller_offer')
        .selectAll()
        .where('id', '=', id)
        .where('partner_id', '=', seller.partnerId)
        .forUpdate()
        .executeTakeFirst();
      if (!row) throw notFound('Offer');
      if (seller.locationId && row.partner_location_id !== seller.locationId)
        throw notFound('Offer');
      if (row.version !== body.expectedVersion) {
        throw new HttpError(
          409,
          'offer_version_conflict',
          `This offer changed since you loaded it (now version ${row.version}). Reload and try again.`,
        );
      }

      const stock = body.stockQty ?? row.stock_qty;
      if (body.stockQty !== undefined && body.stockQty < row.stock_qty) {
        const held = await trx
          .selectFrom('commerce.reserved_qty')
          .select('reserved')
          .where('offer_id', '=', id)
          .executeTakeFirst();
        const reserved = held?.reserved ?? 0;
        if (body.stockQty < reserved) {
          throw new HttpError(
            409,
            'stock_below_reserved',
            `${reserved} unit(s) are held by buyers who are checking out. Stock cannot go below ${reserved}.`,
          );
        }
      }
      // Availability follows stock unless the seller names it; reopening an Out of Stock offer re-derives it.
      const requested =
        body.availability ??
        (stock > 0 && row.availability !== 'Out of Stock'
          ? (row.availability as Availability)
          : undefined);
      const availability = reconcile(stock, requested);

      const selling = body.sellingPrice ?? Number(row.selling_price_fils);
      const original =
        body.originalPrice !== undefined
          ? body.originalPrice
          : row.original_price_fils === null
            ? null
            : Number(row.original_price_fils);
      assertPrices(selling, original);

      const viewingStatus = body.viewingStatus ?? row.viewing_status;
      if (body.displayConfirmed && viewingStatus !== 'On Display')
        throw unprocessable(
          'not_on_display',
          'Display can only be confirmed for an On Display offer.',
          'displayConfirmed',
        );
      const stampDisplay =
        viewingStatus === 'On Display' &&
        (body.displayConfirmed === true || row.viewing_status !== 'On Display');

      if (body.locationId && body.locationId !== row.partner_location_id)
        await assertLocation(trx, seller, body.locationId);

      const updated = await trx
        .updateTable('catalogue.seller_offer')
        .set({
          ...(body.sku !== undefined ? { seller_sku: body.sku } : {}),
          ...(body.sellingPrice !== undefined ? { selling_price_fils: body.sellingPrice } : {}),
          ...(body.originalPrice !== undefined ? { original_price_fils: body.originalPrice } : {}),
          ...(body.deliveryDays !== undefined ? { delivery_days: body.deliveryDays } : {}),
          ...(body.locationId !== undefined ? { partner_location_id: body.locationId } : {}),
          ...(body.status !== undefined ? { offer_status: body.status } : {}),
          stock_qty: stock,
          availability,
          viewing_status: viewingStatus,
          ...(stampDisplay ? { viewing_confirmed_at: new Date(ctx.clock.now()) } : {}),
          ...(viewingStatus !== 'On Display' ? { viewing_confirmed_at: null } : {}),
        })
        .where('id', '=', id)
        .where('version', '=', body.expectedVersion)
        .returning('id')
        .executeTakeFirst();
      if (!updated)
        throw new HttpError(
          409,
          'offer_version_conflict',
          'This offer changed while you were saving. Reload and try again.',
        );

      const after = await loadOffer(trx, seller.partnerId, id);
      await recordAudit(trx, {
        entityType: 'seller_offer',
        entityId: id,
        from: row.offer_status,
        to: after.status,
        actor: req.actor!,
        data: {
          before: {
            sellingPrice: Number(row.selling_price_fils),
            originalPrice:
              row.original_price_fils === null ? null : Number(row.original_price_fils),
            stockQty: row.stock_qty,
            availability: row.availability,
            deliveryDays: row.delivery_days,
            viewingStatus: row.viewing_status,
            locationId: row.partner_location_id,
            sku: row.seller_sku,
          },
          after: {
            sellingPrice: after.sellingPrice,
            originalPrice: after.originalPrice,
            stockQty: after.stockQty,
            availability: after.availability,
            deliveryDays: after.deliveryDays,
            viewingStatus: after.viewingStatus,
            locationId: after.locationId,
            sku: after.sku,
          },
        },
      });
      return after;
    }),
  );
}
