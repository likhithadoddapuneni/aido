import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './support/harness.ts';
import { api, sellerOf, type TestSeller } from './support/seller.ts';

let h: Harness;
let owner: TestSeller;
let staff: TestSeller;
let other: TestSeller;

beforeAll(async () => {
  h = await startHarness();
  owner = await sellerOf(h, 'seller_owner');
  staff = await sellerOf(h, 'seller_staff');
  other = await sellerOf(h, 'seller_owner', 'PRT-002');
});
afterAll(() => h.close());

const lamp = {
  name: 'Kano Floor Lamp',
  type: 'Floor Lamp',
  widthCm: 35,
  depthCm: 35,
  heightCm: 155,
  primaryColour: 'natural',
  primaryStyle: 'japandi',
  material: 'Wood',
  attributes: {},
};
let n = 0;
const submit = (newProduct: object, who = owner) =>
  api(h, 'POST', '/v1/seller/offers', who.actor, {
    newProduct,
    sku: `NP-${++n}-${Math.random().toString(36).slice(2, 6)}`,
    sellingPrice: 25_000,
    stockQty: 3,
    deliveryDays: 5,
    locationId: who.locationId,
  });
const productRow = (id: string) =>
  h.admin
    .selectFrom('catalogue.product')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
const live = (offerId: string) =>
  h.admin
    .selectFrom('catalogue.eligible_offer')
    .select('offer_id')
    .where('offer_id', '=', offerId)
    .execute();
const countMine = async () =>
  Number(
    (
      await h.admin
        .selectFrom('catalogue.product')
        .select((e) => e.fn.countAll<string>().as('n'))
        .where('submitted_by_partner_id', '=', owner.partnerId)
        .executeTakeFirstOrThrow()
    ).n,
  );
/** What an ops reviewer does: mark Verified. Sellers have no way to. */
const verify = async (id: string) => {
  const ops = await h.admin
    .insertInto('identity.ops_user')
    .values({ email: `ops${++n}@t.test`, full_name: 'Reviewer', role: 'ops_catalogue' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.admin
    .updateTable('catalogue.product')
    .set({ data_status: 'Verified', verified_by: ops.id, verified_at: new Date() })
    .where('id', '=', id)
    .execute();
};

describe('submitting a new product', () => {
  it('lands as Ready for Review, never live, tied to the submitting partner, with a parent product', async () => {
    const r = await submit(lamp);
    expect(r.status, r.text).toBe(201);
    expect(r.json.product).toMatchObject({ dataStatus: 'Ready for Review', missing: [] });
    const row = await productRow(r.json.product.id);
    expect(row).toMatchObject({
      data_status: 'Ready for Review',
      submitted_by_partner_id: owner.partnerId,
      verified_by: null,
    });
    expect(await live(r.json.offer.id)).toHaveLength(0);
    expect(r.json.offer).toMatchObject({ live: false, productDataStatus: 'Ready for Review' });
    const audit = await h.admin
      .selectFrom('audit.event')
      .select('to_state')
      .where('entity_id', '=', row.id)
      .execute();
    expect(audit.map((a) => a.to_state)).toEqual(['Ready for Review']);
  });

  it('missing mandatory facts save it as Incomplete and say what is missing', async () => {
    const r = await submit({ name: 'Orla Sofa', type: 'Sofa' });
    expect(r.status).toBe(201);
    expect(r.json.product.dataStatus).toBe('Incomplete');
    expect(r.json.product.missing).toEqual(
      expect.arrayContaining(['widthCm', 'primaryColour', 'material', 'attributes.seats']),
    );
  });

  it.each([
    ['a colour in the name', { name: 'Grey Floor Lamp' }, 'name'],
    ['a price in the name', { name: 'Lamp 500 AED' }, 'name'],
    ['an unknown type', { type: 'Teleporter' }, 'type'],
    ['a fractional dimension', { widthCm: 35.5 }, 'widthCm'],
    ['an enormous dimension', { heightCm: 9000 }, 'heightCm'],
    ['a colour outside the families', { primaryColour: 'cognac' }, 'primaryColour'],
    ['a style outside the standard', { primaryStyle: 'baroque' }, 'primaryStyle'],
    ['a material outside the families', { material: 'Plastic' }, 'material'],
    ['a secondary equal to the primary', { secondaryColour: 'natural' }, 'secondaryColour'],
    ['an attribute that does not apply', { attributes: { seats: 3 } }, 'attributes.seats'],
    ['an unknown attribute', { attributes: { glow: true } }, 'attributes.glow'],
  ])('refuses %s, naming the field, and stores nothing', async (_l, change, path) => {
    const before = await countMine();
    const r = await submit({ ...lamp, ...change });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe('product_data_invalid');
    expect(r.json.errors.map((e: { path: string }) => e.path)).toContain(path);
    expect(await countMine()).toBe(before);
  });

  it('priced branches are checked: a sofa needs seats the price standard knows', async () => {
    const sofa = {
      name: 'Orla Sofa',
      type: 'Sofa',
      widthCm: 215,
      depthCm: 92,
      heightCm: 82,
      primaryColour: 'beige',
      primaryStyle: 'scandinavian',
      material: 'Fabric',
    };
    expect((await submit({ ...sofa, attributes: { seats: 3 } })).json.product.dataStatus).toBe(
      'Ready for Review',
    );
    expect((await submit({ ...sofa, attributes: { seats: 9 } })).status).toBe(422);
    expect((await submit({ ...sofa, attributes: { seats: 'three' } })).status).toBe(422);
  });

  it('a seller cannot smuggle in Verified, a verifier or another partner as the submitter', async () => {
    for (const extra of [
      { dataStatus: 'Verified' },
      { verifiedBy: 'x' },
      { submittedByPartnerId: other.partnerId },
      { lifecycle: 'Active' },
    ]) {
      const r = await submit({ ...lamp, ...extra });
      expect(r.status).toBe(400);
    }
  });
});

describe('editing a submitted product', () => {
  it('editing a Verified product returns it to review and takes its offers off the market', async () => {
    const created = await submit(lamp);
    const id = created.json.product.id as string;
    await verify(id);
    expect(await live(created.json.offer.id)).toHaveLength(1);

    const r = await api(h, 'PATCH', `/v1/seller/products/${id}`, owner.actor, { widthCm: 40 });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ dataStatus: 'Ready for Review', widthCm: 40 });
    expect(await productRow(id)).toMatchObject({
      data_status: 'Ready for Review',
      verified_by: null,
      verified_at: null,
      width_cm: 40,
    });
    expect(await live(created.json.offer.id)).toHaveLength(0);
    const trail = await h.admin
      .selectFrom('audit.event')
      .select(['from_state', 'to_state'])
      .where('entity_id', '=', id)
      .orderBy('at')
      .execute();
    expect(trail.map((t) => [t.from_state, t.to_state])).toEqual([
      [null, 'Ready for Review'],
      ['Verified', 'Ready for Review'],
    ]);
  });

  it('every identity field voids verification; the seller cannot re-verify', async () => {
    for (const change of [
      { name: 'Kano Arc Lamp' },
      { primaryColour: 'black' },
      { primaryStyle: 'modern' },
      { material: 'Metal' },
      { depthCm: 30 },
      { heightCm: 160 },
      { secondaryStyle: 'minimalist' },
    ]) {
      const id = (await submit({ ...lamp, name: `Lamp ${++n}` })).json.product.id as string;
      await verify(id);
      const r = await api(h, 'PATCH', `/v1/seller/products/${id}`, owner.actor, change);
      expect(r.status, JSON.stringify(change)).toBe(200);
      expect(r.json.dataStatus).toBe('Ready for Review');
    }
    const id = (await submit({ ...lamp, name: 'Lamp Z' })).json.product.id as string;
    expect(
      (await api(h, 'PATCH', `/v1/seller/products/${id}`, owner.actor, { dataStatus: 'Verified' }))
        .status,
    ).toBe(400);
  });

  it('completing an Incomplete product sends it for review; breaking a rule is refused', async () => {
    const id = (await submit({ name: 'Orla Sofa', type: 'Sofa' })).json.product.id as string;
    const ok = await api(h, 'PATCH', `/v1/seller/products/${id}`, owner.actor, {
      widthCm: 215,
      depthCm: 92,
      heightCm: 82,
      primaryColour: 'beige',
      primaryStyle: 'scandinavian',
      material: 'Fabric',
      attributes: { seats: 3 },
    });
    expect(ok.json).toMatchObject({ dataStatus: 'Ready for Review', missing: [] });
    const bad = await api(h, 'PATCH', `/v1/seller/products/${id}`, owner.actor, {
      material: 'Unobtainium',
    });
    expect(bad.status).toBe(422);
    expect((await productRow(id)).material_family).toBe('Fabric');
  });

  it("cannot edit another seller's product, or one loaded by ops; staff cannot edit at all", async () => {
    const id = (await submit(lamp)).json.product.id as string;
    expect(
      (await api(h, 'PATCH', `/v1/seller/products/${id}`, other.actor, { widthCm: 50 })).status,
    ).toBe(404);
    expect(
      (await api(h, 'PATCH', `/v1/seller/products/${id}`, staff.actor, { widthCm: 50 })).status,
    ).toBe(403);
    const seeded = (
      await h.admin
        .selectFrom('catalogue.product')
        .select('id')
        .where('submitted_by_partner_id', 'is', null)
        .limit(1)
        .executeTakeFirstOrThrow()
    ).id;
    expect(
      (await api(h, 'PATCH', `/v1/seller/products/${seeded}`, owner.actor, { widthCm: 50 })).status,
    ).toBe(404);
    expect((await productRow(id)).width_cm).toBe(35);
  });

  it('lists only the products my store submitted', async () => {
    const mine = (await submit({ ...lamp, name: 'Only Mine Lamp' })).json.product.id as string;
    const list = await api(h, 'GET', '/v1/seller/products', owner.actor);
    expect(list.json.products.map((p: { id: string }) => p.id)).toContain(mine);
    const theirs = await api(h, 'GET', '/v1/seller/products', other.actor);
    expect(theirs.json.products.map((p: { id: string }) => p.id)).not.toContain(mine);
  });
});

describe('photographs', () => {
  const upload = (id: string, who = owner) =>
    api(h, 'POST', `/v1/seller/products/${id}/media`, who.actor, {
      contentType: 'image/jpeg',
      sizeBytes: 250_000,
    });

  it('signs a short-lived upload bound to this product; the key is the server’s, not the client’s', async () => {
    const id = (await submit(lamp)).json.product.id as string;
    const r = await upload(id);
    expect(r.status, r.text).toBe(200);
    expect(r.json.storageKey).toMatch(new RegExp(`^products/${id}/[0-9a-f-]{36}\\.jpg$`));
    expect(r.json).toMatchObject({ method: 'PUT', headers: { 'content-type': 'image/jpeg' } });
    expect(new Date(r.json.expiresAt).getTime()).toBeLessThanOrEqual(
      h.clock.now() + 15 * 60_000 + 1000,
    );
    expect(h.media.signed.at(-1)).toMatchObject({ contentType: 'image/jpeg', maxBytes: 250_000 });
    expect(
      (
        await api(h, 'POST', `/v1/seller/products/${id}/media`, owner.actor, {
          contentType: 'application/pdf',
          sizeBytes: 10,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(h, 'POST', `/v1/seller/products/${id}/media`, owner.actor, {
          contentType: 'image/png',
          sizeBytes: 99_000_000,
        })
      ).status,
    ).toBe(400);
  });

  it('records the photograph only once it has really arrived, and only once', async () => {
    const id = (await submit(lamp)).json.product.id as string;
    const up = (await upload(id)).json;
    const body = {
      storageKey: up.storageKey,
      position: 0,
      altText: 'Front view',
      widthPx: 1600,
      heightPx: 1200,
    };
    const early = await api(
      h,
      'POST',
      `/v1/seller/products/${id}/media/confirm`,
      owner.actor,
      body,
    );
    expect(early.status).toBe(409);
    expect(early.json.code).toBe('upload_not_found');
    h.media.put(up.storageKey, 250_000, 'image/jpeg');
    const ok = await api(h, 'POST', `/v1/seller/products/${id}/media/confirm`, owner.actor, body);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json.media).toHaveLength(1);
    const again = await api(
      h,
      'POST',
      `/v1/seller/products/${id}/media/confirm`,
      owner.actor,
      body,
    );
    expect(again.json.media).toHaveLength(1);
  });

  it('a key issued for one product cannot be claimed by another, nor another partner’s product', async () => {
    const a = (await submit({ ...lamp, name: 'Lamp A' })).json.product.id as string;
    const b = (await submit({ ...lamp, name: 'Lamp B' })).json.product.id as string;
    const up = (await upload(a)).json;
    h.media.put(up.storageKey, 100, 'image/jpeg');
    const stolen = await api(h, 'POST', `/v1/seller/products/${b}/media/confirm`, owner.actor, {
      storageKey: up.storageKey,
      position: 0,
    });
    expect(stolen.status).toBe(422);
    expect((await upload(a, other)).status).toBe(404);
    expect(
      (
        await api(h, 'POST', `/v1/seller/products/${a}/media/confirm`, other.actor, {
          storageKey: up.storageKey,
          position: 0,
        })
      ).status,
    ).toBe(404);
  });

  it('a position can hold one photograph, and a product at most twelve', async () => {
    const id = (await submit(lamp)).json.product.id as string;
    const k1 = (await upload(id)).json.storageKey;
    const k2 = (await upload(id)).json.storageKey;
    h.media.put(k1, 1, 'image/jpeg');
    h.media.put(k2, 1, 'image/jpeg');
    expect(
      (
        await api(h, 'POST', `/v1/seller/products/${id}/media/confirm`, owner.actor, {
          storageKey: k1,
          position: 0,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(h, 'POST', `/v1/seller/products/${id}/media/confirm`, owner.actor, {
          storageKey: k2,
          position: 0,
        })
      ).json.code,
    ).toBe('photo_position_taken');
    for (let i = 1; i < 12; i++) {
      const k = (await upload(id)).json.storageKey;
      h.media.put(k, 1, 'image/jpeg');
      await api(h, 'POST', `/v1/seller/products/${id}/media/confirm`, owner.actor, {
        storageKey: k,
        position: i,
      });
    }
    expect((await upload(id)).json.code).toBe('too_many_photos');
  });
});
