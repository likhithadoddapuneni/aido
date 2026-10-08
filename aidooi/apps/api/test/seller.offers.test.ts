import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { withActor } from '@aidooi/db';
import { fixtures } from '@aidooi/db/testing';
import { startHarness, type Harness } from './support/harness.ts';
import { createOrder } from './support/orders.ts';
import { anOffer, api, sellerOf, type TestSeller } from './support/seller.ts';

let h: Harness;
let owner: TestSeller;
let manager: TestSeller;
let staff: TestSeller;
let other: TestSeller;

beforeAll(async () => {
  h = await startHarness();
  owner = await sellerOf(h, 'seller_owner');
  manager = await sellerOf(h, 'seller_manager');
  staff = await sellerOf(h, 'seller_staff');
  other = await sellerOf(h, 'seller_owner', 'PRT-002');
});
afterAll(() => h.close());

const offerRow = (id: string) =>
  h.admin
    .selectFrom('catalogue.seller_offer')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
const get = async (id: string, who = owner) =>
  (await api(h, 'GET', `/v1/seller/offers/${id}`, who.actor)).json;
const patch = (id: string, body: object, who = owner) =>
  api(h, 'PATCH', `/v1/seller/offers/${id}`, who.actor, body);

/** A Verified product the owner does not list yet (each call consumes one), so tests never collide. */
const unlisted = (type?: string) => {
  let q = h.admin
    .selectFrom('catalogue.product as p')
    .select('p.id')
    .where('p.data_status', '=', 'Verified')
    .where((e) =>
      e.not(
        e.exists(
          e
            .selectFrom('catalogue.seller_offer as o')
            .select('o.id')
            .whereRef('o.product_id', '=', 'p.id')
            .where('o.partner_id', '=', owner.partnerId),
        ),
      ),
    );
  if (type) q = q.where('p.product_type', '=', type);
  return q.orderBy('p.id').executeTakeFirstOrThrow();
};

/** A fresh offer of the owner's with known stock, so tests do not interfere with each other. */
async function freshOffer(stock = 10, extra: object = {}) {
  const verified = await unlisted();
  const r = await api(h, 'POST', '/v1/seller/offers', owner.actor, {
    productId: verified.id,
    sku: `FRESH-${Math.random().toString(36).slice(2, 10)}`,
    sellingPrice: 12_000,
    originalPrice: null,
    stockQty: stock,
    deliveryDays: 4,
    viewingStatus: 'Not Viewable',
    locationId: owner.locationId,
    ...extra,
  });
  if (r.status !== 201) throw new Error(r.text);
  return r.json.offer as { id: string; version: number; productId: string };
}

describe('listing', () => {
  it('shows only my offers, filters, searches and pages with a keyset cursor', async () => {
    const page1 = await api(h, 'GET', '/v1/seller/offers?limit=5', owner.actor);
    expect(page1.status).toBe(200);
    expect(page1.json.items).toHaveLength(5);
    expect(page1.json.nextCursor).toBeTruthy();
    const page2 = await api(
      h,
      'GET',
      `/v1/seller/offers?limit=5&cursor=${page1.json.nextCursor}`,
      owner.actor,
    );
    const ids = [...page1.json.items, ...page2.json.items].map((o: { id: string }) => o.id);
    expect(new Set(ids).size).toBe(10);
    expect([...ids].sort()).toEqual(ids);
    const mine = await h.admin
      .selectFrom('catalogue.seller_offer')
      .select('id')
      .where('partner_id', '=', owner.partnerId)
      .execute();
    const all = await api(h, 'GET', '/v1/seller/offers?limit=100', owner.actor);
    expect(all.json.items.every((o: { id: string }) => mine.some((m) => m.id === o.id))).toBe(true);

    const sofas = await api(h, 'GET', '/v1/seller/offers?q=sofa&limit=100', owner.actor);
    expect(sofas.json.items.length).toBeGreaterThan(0);
    expect(sofas.json.items.every((o: { productType: string }) => o.productType === 'Sofa')).toBe(
      true,
    );
    const oos = await api(
      h,
      'GET',
      '/v1/seller/offers?availability=Out%20of%20Stock&limit=100',
      owner.actor,
    );
    expect(
      oos.json.items.every((o: { availability: string }) => o.availability === 'Out of Stock'),
    ).toBe(true);
  });

  it('treats search text literally (no LIKE wildcards)', async () => {
    const r = await api(h, 'GET', '/v1/seller/offers?q=%25', owner.actor);
    expect(r.status).toBe(200);
    expect(r.json.items).toHaveLength(0);
    expect((await api(h, 'GET', '/v1/seller/offers?cursor=garbage', owner.actor)).status).toBe(400);
  });
});

describe('creating an offer', () => {
  it('lists an existing Verified product; the commission comes from the partner record, never the request', async () => {
    const o = await freshOffer(7);
    const row = await offerRow(o.id);
    expect(row).toMatchObject({
      stock_qty: 7,
      availability: 'In Stock',
      selling_price_fils: 12_000,
      partner_id: owner.partnerId,
    });
    expect(Number(row.commission_rate)).toBe(0.14);
    const bad = await api(h, 'POST', '/v1/seller/offers', owner.actor, {
      productId: o.productId,
      sku: 'X2',
      sellingPrice: 100,
      stockQty: 1,
      deliveryDays: 1,
      locationId: owner.locationId + '',
      commissionRate: 0,
    });
    expect(bad.status).toBe(400);
  });

  it('refuses unverified products, duplicates, bad prices and stock/availability contradictions', async () => {
    const unverified = await h.admin
      .insertInto('catalogue.parent_product')
      .values({ model_name: 'U' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const p = await h.admin
      .insertInto('catalogue.product')
      .values({
        parent_id: unverified.id,
        name: 'Unverified Thing',
        main_category: 'F',
        category: 'Vase',
        product_type: 'Vase',
        data_status: 'Ready for Review',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const base = {
      sellingPrice: 5_000,
      stockQty: 2,
      deliveryDays: 2,
      locationId: owner.locationId,
    };
    expect(
      (
        await api(h, 'POST', '/v1/seller/offers', owner.actor, {
          ...base,
          productId: p.id,
          sku: 'U-1',
        })
      ).json.code,
    ).toBe('product_not_verified');

    const v = await freshOffer(2);
    const dupSku = await api(h, 'POST', '/v1/seller/offers', owner.actor, {
      ...base,
      productId: (await unlisted()).id,
      sku: (await offerRow(v.id)).seller_sku,
    });
    expect(dupSku.status).toBe(409);
    expect(dupSku.json.code).toBe('duplicate_sku');
    const dupListing = await api(h, 'POST', '/v1/seller/offers', owner.actor, {
      ...base,
      productId: v.productId,
      sku: 'ANOTHER-SKU',
    });
    expect(dupListing.status).toBe(409);
    expect(dupListing.json.code).toBe('duplicate_listing');

    const verified = (await unlisted('Planter')).id;
    const z = (extra: object) =>
      api(h, 'POST', '/v1/seller/offers', owner.actor, {
        ...base,
        productId: verified,
        sku: `Z-${Math.random()}`.slice(0, 12),
        ...extra,
      });
    expect((await z({ originalPrice: 1_000 })).json.code).toBe('original_price_below_selling');
    expect((await z({ stockQty: 0, availability: 'In Stock' })).json.code).toBe(
      'availability_conflicts_with_stock',
    );
    expect((await z({ stockQty: 4, availability: 'Out of Stock' })).json.code).toBe(
      'availability_conflicts_with_stock',
    );
    expect((await z({ sellingPrice: 0 })).status).toBe(400);
    expect((await z({ sellingPrice: 10.5 })).status).toBe(400);
    expect(
      (await api(h, 'POST', '/v1/seller/offers', owner.actor, { ...base, sku: 'NOTHING' })).status,
    ).toBe(400);
  });

  it("cannot use another partner's showroom, and staff cannot create offers", async () => {
    const verified = (await unlisted('Throw')).id;
    const body = {
      productId: verified,
      sku: 'LOC-1',
      sellingPrice: 5_000,
      stockQty: 1,
      deliveryDays: 1,
    };
    expect(
      (
        await api(h, 'POST', '/v1/seller/offers', owner.actor, {
          ...body,
          locationId: other.locationId,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(h, 'POST', '/v1/seller/offers', staff.actor, {
          ...body,
          locationId: owner.locationId,
        })
      ).status,
    ).toBe(403);
  });

  it('a stock of 0 is Out of Stock, and an On Display offer is stamped as confirmed now', async () => {
    const o = await freshOffer(0, { viewingStatus: 'On Display' });
    const v = await get(o.id);
    expect(v).toMatchObject({ availability: 'Out of Stock', stockQty: 0, live: false });
    expect(new Date(v.viewingConfirmedAt).getTime()).toBeGreaterThan(h.clock.now() - 5_000);
  });
});

describe('editing an offer', () => {
  it.each([
    ['commission', { commissionRate: 0.01 }],
    ['commission (snake)', { commission_rate: 0.01 }],
    ['partner', { partnerId: '00000000-0000-4000-8000-000000000000' }],
    ['product', { productId: 'AID-00000001' }],
    ['id', { id: 'AIO-00000001' }],
    ['status string typo', { offerStatus: 'Active' }],
    ['version field', { version: 99 }],
  ])('rejects a PATCH naming %s, and changes nothing', async (_l, extra) => {
    const o = await freshOffer();
    const before = await offerRow(o.id);
    const r = await patch(o.id, { expectedVersion: o.version, sellingPrice: 11_000, ...extra });
    expect(r.status).toBe(400);
    expect(await offerRow(o.id)).toEqual(before);
  });

  it('staff may change stock and display only; managers and owners may change everything allowed', async () => {
    const o = await freshOffer();
    const price = await patch(o.id, { expectedVersion: o.version, sellingPrice: 13_000 }, staff);
    expect(price.status).toBe(403);
    expect(price.json.detail).toMatch(/sellingPrice/);
    const stock = await patch(
      o.id,
      {
        expectedVersion: o.version,
        stockQty: 6,
        viewingStatus: 'On Display',
        displayConfirmed: true,
      },
      staff,
    );
    expect(stock.status, stock.text).toBe(200);
    expect(stock.json).toMatchObject({
      stockQty: 6,
      viewingStatus: 'On Display',
      version: o.version + 1,
    });
    const mgr = await patch(
      o.id,
      {
        expectedVersion: stock.json.version,
        sellingPrice: 13_000,
        originalPrice: 15_000,
        deliveryDays: 9,
        sku: `R-${o.id}`,
      },
      manager,
    );
    expect(mgr.json).toMatchObject({
      sellingPrice: 13_000,
      originalPrice: 15_000,
      deliveryDays: 9,
    });
  });

  it('keeps stock and availability in one story, and original price at or above selling price', async () => {
    const o = await freshOffer(5);
    let v = o.version;
    const zero = await patch(o.id, { expectedVersion: v, stockQty: 0 });
    expect(zero.json).toMatchObject({ stockQty: 0, availability: 'Out of Stock', live: false });
    v = zero.json.version;
    expect((await patch(o.id, { expectedVersion: v, availability: 'In Stock' })).json.code).toBe(
      'availability_conflicts_with_stock',
    );
    const back = await patch(o.id, { expectedVersion: v, stockQty: 3 });
    expect(back.json).toMatchObject({ stockQty: 3, availability: 'In Stock', live: true });
    const low = await patch(o.id, {
      expectedVersion: back.json.version,
      availability: 'Low Stock',
    });
    expect(low.json.availability).toBe('Low Stock');
    expect(
      (await patch(o.id, { expectedVersion: low.json.version, stockQty: 2 })).json.availability,
    ).toBe('Low Stock');
    expect(
      (await patch(o.id, { expectedVersion: low.json.version + 1, originalPrice: 100 })).json.code,
    ).toBe('original_price_below_selling');
    expect(
      (await patch(o.id, { expectedVersion: low.json.version + 1, displayConfirmed: true })).json
        .code,
    ).toBe('not_on_display');
  });

  it('refreshes the display confirmation only when On Display is (re)confirmed', async () => {
    const o = await freshOffer(5, { viewingStatus: 'On Display' });
    const t0 = (await offerRow(o.id)).viewing_confirmed_at!;
    h.clock.advanceHours(30);
    const noop = await patch(o.id, { expectedVersion: o.version, deliveryDays: 8 });
    expect(new Date((await offerRow(o.id)).viewing_confirmed_at!).getTime()).toBe(
      new Date(t0).getTime(),
    );
    const again = await patch(o.id, { expectedVersion: noop.json.version, displayConfirmed: true });
    expect(new Date(again.json.viewingConfirmedAt).getTime()).toBeGreaterThan(
      new Date(t0).getTime() + 29 * 3_600_000,
    );
    const off = await patch(o.id, {
      expectedVersion: again.json.version,
      viewingStatus: 'Not Viewable',
    });
    expect(off.json.viewingConfirmedAt).toBeNull();
  });

  it('a stale version is refused; of two simultaneous edits exactly one wins and nothing is lost', async () => {
    const o = await freshOffer(10);
    const [a, b] = await Promise.all([
      patch(o.id, { expectedVersion: o.version, sellingPrice: 20_000 }),
      patch(o.id, { expectedVersion: o.version, stockQty: 4 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.code).toBe('offer_version_conflict');
    const row = await offerRow(o.id);
    expect(row.version).toBe(o.version + 1);
    const winnerSetPrice = a.status === 200;
    expect(winnerSetPrice ? row.selling_price_fils : row.stock_qty).toBe(
      winnerSetPrice ? 20_000 : 4,
    );
    expect(winnerSetPrice ? row.stock_qty : row.selling_price_fils).toBe(
      winnerSetPrice ? 10 : 12_000,
    );
  });

  it('does not let a seller touch another partner’s offer', async () => {
    const o = await freshOffer();
    expect((await patch(o.id, { expectedVersion: o.version, sellingPrice: 1 }, other)).status).toBe(
      404,
    );
  });

  it('can deactivate and reactivate; an inactive offer leaves the eligible set', async () => {
    const o = await freshOffer();
    const eligible = () =>
      h.admin
        .selectFrom('catalogue.eligible_offer')
        .select('offer_id')
        .where('offer_id', '=', o.id)
        .execute();
    expect(await eligible()).toHaveLength(1);
    const off = await patch(o.id, { expectedVersion: o.version, status: 'Inactive' });
    expect(off.json.status).toBe('Inactive');
    expect(await eligible()).toHaveLength(0);
    await patch(o.id, { expectedVersion: off.json.version, status: 'Active' });
    expect(await eligible()).toHaveLength(1);
  });

  it('writes an audit row with before and after for every change', async () => {
    const o = await freshOffer(8);
    await patch(o.id, { expectedVersion: o.version, sellingPrice: 14_500, stockQty: 5 });
    const rows = await h.admin
      .selectFrom('audit.event')
      .select(['data', 'actor_type', 'actor_id'])
      .where('entity_type', '=', 'seller_offer')
      .where('entity_id', '=', o.id)
      .orderBy('at')
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[1]!.data).toMatchObject({
      before: { sellingPrice: 12_000, stockQty: 8 },
      after: { sellingPrice: 14_500, stockQty: 5 },
    });
    expect(rows[1]).toMatchObject({ actor_type: 'seller_user', actor_id: owner.userId });
  });
});

describe('stock held by buyers who are checking out', () => {
  /** A live reservation for `qty` units of the offer. */
  async function reserve(offerId: string, qty: number) {
    const customerId = await fixtures.customer(h.admin);
    const { reservationId } = await fixtures.reservation(h.admin, {
      customerId,
      offerId,
      priceFils: 12_000 * qty,
    });
    await withActor(h.database.app, { kind: 'system' }, (trx) =>
      sql`SELECT commerce.try_reserve(${reservationId}::uuid, ${offerId}, ${qty})`.execute(trx),
    );
    return reservationId;
  }

  it('the API refuses stock below the reserved quantity and says how many are held', async () => {
    const o = await freshOffer(10);
    await reserve(o.id, 4);
    const r = await patch(o.id, { expectedVersion: o.version, stockQty: 3 });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('stock_below_reserved');
    expect(r.json.detail).toMatch(/4 unit/);
    expect((await get(o.id)).reservedQty).toBe(4);
    const ok = await patch(o.id, { expectedVersion: o.version, stockQty: 4 });
    expect(ok.json.stockQty).toBe(4);
  });

  it('and the database refuses it too, even if the API were bypassed', async () => {
    const o = await freshOffer(10);
    await reserve(o.id, 5);
    await expect(
      withActor(h.database.app, { kind: 'seller', partnerId: owner.partnerId }, (trx) =>
        trx
          .updateTable('catalogue.seller_offer')
          .set({ stock_qty: 2 })
          .where('id', '=', o.id)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '23514', message: expect.stringMatching(/5 units held/) });
    expect((await offerRow(o.id)).stock_qty).toBe(10);
  });

  it('a price change never touches an open reservation, nor a locked order snapshot', async () => {
    const o = await freshOffer(10);
    const reservationId = await reserve(o.id, 2);
    const resBefore = await h.admin
      .selectFrom('commerce.reservation')
      .selectAll()
      .where('id', '=', reservationId)
      .executeTakeFirstOrThrow();
    const lineBefore = await h.admin
      .selectFrom('commerce.reservation_line')
      .selectAll()
      .where('reservation_id', '=', reservationId)
      .executeTakeFirstOrThrow();
    const order = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const snapOffer = await h.admin
      .selectFrom('fulfilment.order_line')
      .select(['offer_id', 'snapshot', 'unit_price_fils', 'gross_line_fils'])
      .where('id', '=', order.lineIds[0]!)
      .executeTakeFirstOrThrow();
    const live = await get(snapOffer.offer_id);
    const priced = await patch(snapOffer.offer_id, {
      expectedVersion: live.version,
      sellingPrice: live.sellingPrice + 7_777,
    });
    expect(priced.status, priced.text).toBe(200);
    await patch(o.id, { expectedVersion: o.version, sellingPrice: 99_000 });

    expect(
      await h.admin
        .selectFrom('commerce.reservation')
        .selectAll()
        .where('id', '=', reservationId)
        .executeTakeFirstOrThrow(),
    ).toEqual(resBefore);
    expect(
      await h.admin
        .selectFrom('commerce.reservation_line')
        .selectAll()
        .where('reservation_id', '=', reservationId)
        .executeTakeFirstOrThrow(),
    ).toEqual(lineBefore);
    const after = await h.admin
      .selectFrom('fulfilment.order_line')
      .select(['snapshot', 'unit_price_fils', 'gross_line_fils'])
      .where('id', '=', order.lineIds[0]!)
      .executeTakeFirstOrThrow();
    expect(after).toEqual({
      snapshot: snapOffer.snapshot,
      unit_price_fils: snapOffer.unit_price_fils,
      gross_line_fils: snapOffer.gross_line_fils,
    });
  });

  it('expired reservations no longer hold stock back', async () => {
    const o = await freshOffer(10);
    const reservationId = await reserve(o.id, 6);
    await h.admin
      .updateTable('commerce.reservation')
      .set({ state: 'Expired' })
      .where('id', '=', reservationId)
      .execute();
    expect((await patch(o.id, { expectedVersion: o.version, stockQty: 1 })).status).toBe(200);
  });
});

describe('read model', () => {
  it('reports whether an offer is live for buyers', async () => {
    const seeded = await anOffer(h, owner.partnerId);
    expect((await get(seeded.id)).live).toBe(true);
  });
});
