import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/db.ts';

let counter = 0;
const next = () => ++counter;

export async function opsUser(db: Kysely<DB>): Promise<string> {
  const { id } = await db
    .insertInto('identity.ops_user')
    .values({ email: `ops${next()}@aidooi.test`, full_name: 'Ops Tester', role: 'ops_catalogue' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export interface PartnerOverrides {
  status?: string;
  commission_rate?: number;
}

export async function partner(db: Kysely<DB>, over: PartnerOverrides = {}): Promise<string> {
  const n = next();
  const status = over.status ?? 'Active';
  const { id } = await db
    .insertInto('catalogue.partner')
    .values({
      code: `PRT-${String(n).padStart(4, '0')}`,
      legal_name: `Partner ${n} LLC`,
      trade_name: `Partner ${n}`,
      status,
      commission_rate: over.commission_rate ?? 0.14,
      activated_at: status === 'Active' ? new Date() : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export async function location(db: Kysely<DB>, partnerId: string): Promise<string> {
  const { id } = await db
    .insertInto('catalogue.partner_location')
    .values({
      partner_id: partnerId,
      name: `Showroom ${next()}`,
      address: 'Al Quoz 1',
      emirate: 'Dubai',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export interface ProductOverrides {
  product_type?: string;
  data_status?: string;
  lifecycle?: string;
  width_cm?: number | null;
}

export async function product(
  db: Kysely<DB>,
  opsUserId: string,
  over: ProductOverrides = {},
): Promise<string> {
  const parent = await db
    .insertInto('catalogue.parent_product')
    .values({ model_name: `Model ${next()}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  const status = over.data_status ?? 'Verified';
  const verified = status === 'Verified';
  const { id } = await db
    .insertInto('catalogue.product')
    .values({
      parent_id: parent.id,
      name: `Product ${next()}`,
      main_category: 'Seating',
      category: 'Sofa',
      product_type: over.product_type ?? 'Sofa',
      width_cm: over.width_cm === undefined ? 215 : over.width_cm,
      depth_cm: 92,
      height_cm: 82,
      primary_colour: 'grey',
      material_family: 'Fabric',
      primary_style: 'modern',
      attributes: { seats: 3 },
      data_status: status,
      lifecycle: over.lifecycle ?? 'Active',
      verified_by: verified ? opsUserId : null,
      verified_at: verified ? new Date() : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export interface OfferOverrides {
  selling_price_fils?: number;
  availability?: string;
  stock_qty?: number;
  offer_status?: string;
  commission_rate?: number;
  viewing_status?: string;
}

export async function offer(
  db: Kysely<DB>,
  args: { productId: string; partnerId: string; locationId: string },
  over: OfferOverrides = {},
): Promise<string> {
  const { id } = await db
    .insertInto('catalogue.seller_offer')
    .values({
      product_id: args.productId,
      partner_id: args.partnerId,
      partner_location_id: args.locationId,
      seller_sku: `SKU-${next()}`,
      selling_price_fils: over.selling_price_fils ?? 350_000,
      availability: over.availability ?? 'In Stock',
      stock_qty: over.stock_qty ?? 10,
      delivery_days: 3,
      commission_rate: over.commission_rate ?? 0.14,
      offer_status: over.offer_status ?? 'Active',
      viewing_status: over.viewing_status ?? 'On Display',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export async function customer(db: Kysely<DB>): Promise<string> {
  const { id } = await db
    .insertInto('identity.customer')
    .values({ phone_e164: `+9715${String(10_000_000 + next())}`, full_name: 'Test Buyer' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export async function sellerUser(db: Kysely<DB>, partnerId: string): Promise<string> {
  const { id } = await db
    .insertInto('identity.seller_user')
    .values({
      partner_id: partnerId,
      email: `seller${next()}@partner.test`,
      full_name: 'Seller Staff',
      role: 'seller_staff',
      status: 'Active',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export interface Catalogue {
  ops: string;
  partner: string;
  location: string;
  product: string;
  offer: string;
}

/** One verified product with one active offer from one active partner. */
export async function catalogue(db: Kysely<DB>, over: OfferOverrides = {}): Promise<Catalogue> {
  const ops = await opsUser(db);
  const p = await partner(db);
  const loc = await location(db, p);
  const prod = await product(db, ops);
  const off = await offer(db, { productId: prod, partnerId: p, locationId: loc }, over);
  return { ops, partner: p, location: loc, product: prod, offer: off };
}

export async function project(db: Kysely<DB>, customerId: string): Promise<string> {
  const { id } = await db
    .insertInto('recommendation.project')
    .values({ customer_id: customerId, path_id: 'livingRoom' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** A purchase request for one unit of an offer, with an Active reservation window. */
export async function reservation(
  db: Kysely<DB>,
  args: { customerId: string; offerId: string; priceFils: number; validated?: boolean },
): Promise<{ purchaseRequestId: string; reservationId: string }> {
  const pr = await db
    .insertInto('commerce.purchase_request')
    .values({
      customer_id: args.customerId,
      total_fils: args.priceFils,
      validation_state: args.validated === false ? 'Validation Pending' : 'Validated',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const res = await db
    .insertInto('commerce.reservation')
    .values({
      purchase_request_id: pr.id,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { purchaseRequestId: pr.id, reservationId: res.id };
}

export interface OrderGraph extends Catalogue {
  customer: string;
  purchaseRequest: string;
  payment: string;
  masterOrder: string;
  sellerOrder: string;
  orderLine: string;
}

/** A paid order with one line, built through the legal payment transitions. */
export async function orderGraph(
  db: Kysely<DB>,
  args: {
    quantity?: number;
    priceFils?: number;
    commissionRate?: number;
    /** Seed the line mid-lifecycle; the state trigger only guards UPDATEs. */
    line?: { state?: string; delivered_at?: Date; receipt_confirmed_at?: Date };
  } = {},
): Promise<OrderGraph> {
  const quantity = args.quantity ?? 1;
  const unit = args.priceFils ?? 350_000;
  const rate = args.commissionRate ?? 0.14;
  const cat = await catalogue(db, { selling_price_fils: unit, commission_rate: rate });
  const cust = await customer(db);
  const gross = unit * quantity;

  const pr = await db
    .insertInto('commerce.purchase_request')
    .values({ customer_id: cust, total_fils: gross, validation_state: 'Validated' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const pay = await db
    .insertInto('commerce.payment')
    .values({
      purpose: 'Order',
      customer_id: cust,
      purchase_request_id: pr.id,
      amount_fils: gross,
      idempotency_key: randomUUID(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('commerce.payment')
    .set({ state: 'Authorized', authorized_at: new Date() })
    .where('id', '=', pay.id)
    .execute();
  await db
    .updateTable('commerce.payment')
    .set({ state: 'Successful', captured_at: new Date() })
    .where('id', '=', pay.id)
    .execute();

  const mo = await db
    .insertInto('commerce.master_order')
    .values({
      customer_id: cust,
      payment_id: pay.id,
      purchase_request_id: pr.id,
      gross_fils: gross,
      paid_fils: gross,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const so = await db
    .insertInto('commerce.seller_order')
    .values({
      master_order_id: mo.id,
      partner_id: cat.partner,
      customer_id: cust,
      subtotal_fils: gross,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const commission = Math.floor((gross * Math.round(rate * 10_000) + 5_000) / 10_000);
  const line = await db
    .insertInto('fulfilment.order_line')
    .values({
      master_order_id: mo.id,
      seller_order_id: so.id,
      partner_id: cat.partner,
      customer_id: cust,
      product_id: cat.product,
      offer_id: cat.offer,
      quantity,
      unit_price_fils: unit,
      gross_line_fils: gross,
      commission_rate: rate,
      commission_fils: commission,
      ...args.line,
      snapshot: {
        productId: cat.product,
        offerId: cat.offer,
        sellerId: cat.partner,
        quantity,
        unitPriceFils: unit,
        grossLineFils: gross,
        commissionRate: rate,
        commissionFils: commission,
      },
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return {
    ...cat,
    customer: cust,
    purchaseRequest: pr.id,
    payment: pay.id,
    masterOrder: mo.id,
    sellerOrder: so.id,
    orderLine: line.id,
  };
}
