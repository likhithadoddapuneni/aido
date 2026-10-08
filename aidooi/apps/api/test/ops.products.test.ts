import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures } from '@aidooi/db/testing';
import { startHarness, type Harness } from './support/harness.ts';
import { as, opsActor } from './support/ops.ts';

let h: Harness;
let cat: ReturnType<typeof as>;
let catUser: string;
let partnerId: string;
let locationId: string;

beforeAll(async () => {
  h = await startHarness({ seed: false });
  const a = await opsActor(h, 'ops_catalogue');
  catUser = a.opsUserId;
  cat = as(h, a);
  partnerId = await fixtures.partner(h.admin, { status: 'Active' });
  locationId = await fixtures.location(h.admin, partnerId);
});
afterAll(() => h.close());

async function submitted(over: Parameters<typeof fixtures.product>[2] = {}) {
  const id = await fixtures.product(h.admin, catUser, { data_status: 'Ready for Review', ...over });
  await fixtures.offer(h.admin, { productId: id, partnerId, locationId });
  return id;
}

describe('verification queue (AID-DATA-014)', () => {
  it('lists by status with a completeness report, filters, and keyset pagination', async () => {
    const complete = await submitted();
    const lacking = await submitted({ width_cm: null });
    await fixtures.product(h.admin, catUser, { data_status: 'Incomplete', product_type: 'Rug' });

    const queue = await cat.get(
      `/v1/ops/products?status=Ready for Review&partnerId=${partnerId}&limit=100`,
    );
    expect(queue.status).toBe(200);
    const byId = new Map(queue.json.items.map((i: { id: string }) => [i.id, i]));
    expect(byId.get(complete)).toMatchObject({
      completeness: { complete: true, missing: [] },
      partners: [{ id: partnerId }],
    });
    expect(byId.get(lacking)).toMatchObject({
      completeness: { complete: false, missing: ['widthCm'] },
    });

    expect(
      (await cat.get('/v1/ops/products?status=Incomplete&type=Rug&limit=100')).json.items.every(
        (i: { type: string }) => i.type === 'Rug',
      ),
    ).toBe(true);
    expect(
      (await cat.get(`/v1/ops/products?status=Ready for Review&search=${complete}`)).json.items.map(
        (i: { id: string }) => i.id,
      ),
    ).toEqual([complete]);

    const p1 = await cat.get('/v1/ops/products?status=Ready for Review&limit=1');
    const p2 = await cat.get(
      `/v1/ops/products?status=Ready for Review&limit=1&cursor=${p1.json.nextCursor}`,
    );
    expect(p1.json.items[0].id).not.toBe(p2.json.items[0].id);
    expect((await cat.get('/v1/ops/products?cursor=garbage')).status).toBe(400);
  });

  it('a product with missing mandatory data cannot be verified — by the API, and by the database', async () => {
    const id = await submitted({ width_cm: null });
    const res = await cat.post(`/v1/ops/products/${id}/verify`);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('product_incomplete');
    expect(res.json.errors.map((e: { path: string }) => e.path)).toContain('widthCm');
    expect((await cat.get(`/v1/ops/products/${id}`)).json.dataStatus).toBe('Ready for Review');
    // Backstop: even a hand-written UPDATE cannot make it Verified.
    await expect(
      h.admin
        .updateTable('catalogue.product')
        .set({ data_status: 'Verified', verified_by: catUser, verified_at: new Date() })
        .where('id', '=', id)
        .execute(),
    ).rejects.toThrow(/product_verified_complete_ck/);
  });

  it('verifying a complete product records who and when, and makes it eligible for recommendation', async () => {
    const id = await submitted();
    expect(
      Number(
        (
          await h.admin
            .selectFrom('catalogue.eligible_offer')
            .select((e) => e.fn.countAll<string>().as('n'))
            .where('product_id', '=', id)
            .executeTakeFirstOrThrow()
        ).n,
      ),
    ).toBe(0);
    const res = await cat.post(`/v1/ops/products/${id}/verify`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.dataStatus).toBe('Verified');
    expect(res.json.verifiedAt).toBeTruthy();
    const row = await h.admin
      .selectFrom('catalogue.product')
      .select('verified_by')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.verified_by).toBe(catUser);
    expect(
      Number(
        (
          await h.admin
            .selectFrom('catalogue.eligible_offer')
            .select((e) => e.fn.countAll<string>().as('n'))
            .where('product_id', '=', id)
            .executeTakeFirstOrThrow()
        ).n,
      ),
    ).toBe(1);
    // Verifying again is a no-op, not an error and not a new audit row.
    expect((await cat.post(`/v1/ops/products/${id}/verify`)).status).toBe(200);
    const audit = await h.admin
      .selectFrom('audit.event')
      .select('to_state')
      .where('entity_type', '=', 'product')
      .where('entity_id', '=', id)
      .execute();
    expect(audit.filter((a) => a.to_state === 'Verified')).toHaveLength(1);
  });

  it('an incomplete (never-submitted) product cannot jump to Verified', async () => {
    const id = await fixtures.product(h.admin, catUser, { data_status: 'Incomplete' });
    const res = await cat.post(`/v1/ops/products/${id}/verify`);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('illegal_transition');
  });

  it('editing a Verified product returns it to Ready for Review, so the correction is itself reviewed', async () => {
    const id = await submitted();
    await cat.post(`/v1/ops/products/${id}/verify`);
    const res = await cat.patch(`/v1/ops/products/${id}`, {
      widthCm: 230,
      secondaryColour: 'beige',
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      dataStatus: 'Ready for Review',
      widthCm: 230,
      secondaryColour: 'beige',
    });
    expect(
      Number(
        (
          await h.admin
            .selectFrom('catalogue.eligible_offer')
            .select((e) => e.fn.countAll<string>().as('n'))
            .where('product_id', '=', id)
            .executeTakeFirstOrThrow()
        ).n,
      ),
    ).toBe(0);
    const history = (await cat.get(`/v1/ops/products/${id}`)).json.history;
    expect(history[0]).toMatchObject({
      from: 'Verified',
      to: 'Ready for Review',
      reason: 'corrected by ops',
    });
  });

  it('refuses values outside the controlled vocabularies', async () => {
    const id = await submitted();
    const res = await cat.patch(`/v1/ops/products/${id}`, { primaryColour: 'teal' });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('invalid_product_value');
    expect((await cat.patch(`/v1/ops/products/${id}`, {})).status).toBe(400);
  });

  it('rejecting sends it back with reasons and notifies every seller that offers it', async () => {
    const id = await submitted();
    const res = await cat.post(`/v1/ops/products/${id}/reject`, {
      reasons: ['Photos are blurry', 'Width looks wrong'],
    });
    expect(res.status).toBe(200);
    expect(res.json.dataStatus).toBe('Incomplete');
    const sent = h.notifier
      .ofTemplate('product.rejected')
      .filter((n) => n.data['productId'] === id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: { kind: 'partner', id: partnerId },
      data: { reasons: 'Photos are blurry; Width looks wrong' },
    });
    const ev = await h.admin
      .selectFrom('audit.event')
      .select('data')
      .where('entity_id', '=', id)
      .where('reason', '=', 'rejected')
      .executeTakeFirstOrThrow();
    expect(ev.data).toMatchObject({ reasons: ['Photos are blurry', 'Width looks wrong'] });
    // Only something awaiting review can be rejected.
    const again = await cat.post(`/v1/ops/products/${id}/reject`, { reasons: ['Not again'] });
    expect(again.status).toBe(422);
    expect((await cat.post(`/v1/ops/products/${id}/reject`, { reasons: [] })).status).toBe(400);
  });

  it('deactivating takes a verified product out of recommendation until reactivated', async () => {
    const id = await submitted();
    await cat.post(`/v1/ops/products/${id}/verify`);
    const eligible = () =>
      h.admin
        .selectFrom('catalogue.eligible_offer')
        .select((e) => e.fn.countAll<string>().as('n'))
        .where('product_id', '=', id)
        .executeTakeFirstOrThrow()
        .then((r) => Number(r.n));
    expect(await eligible()).toBe(1);
    expect((await cat.post(`/v1/ops/products/${id}/deactivate`)).json.lifecycle).toBe('Inactive');
    expect(await eligible()).toBe(0);
    expect((await cat.post(`/v1/ops/products/${id}/activate`)).json.lifecycle).toBe('Active');
    expect(await eligible()).toBe(1);
  });

  it('detail shows offers, partner and history; unknown ids are 404', async () => {
    const id = await submitted();
    const d = (await cat.get(`/v1/ops/products/${id}`)).json;
    expect(d.offers).toHaveLength(1);
    expect(d.offers[0]).toMatchObject({ partnerId, sellingPrice: 350_000 });
    expect(d.partners[0].tradeName).toBeTruthy();
    expect((await cat.get('/v1/ops/products/AID-77777777')).status).toBe(404);
    expect((await cat.get('/v1/ops/products/nonsense')).status).toBe(400);
  });

  it('throughput stats: queue size, median age and per-partner rejection rate', async () => {
    const p2 = await fixtures.partner(h.admin, { status: 'Active' });
    const l2 = await fixtures.location(h.admin, p2);
    const make = async () => {
      const id = await fixtures.product(h.admin, catUser, { data_status: 'Ready for Review' });
      await fixtures.offer(h.admin, { productId: id, partnerId: p2, locationId: l2 });
      return id;
    };
    const [a, b] = [await make(), await make()];
    await cat.post(`/v1/ops/products/${a}/verify`);
    const rej = await cat.post(`/v1/ops/products/${b}/reject`, { reasons: ['Not suitable'] });
    expect(rej.status, JSON.stringify(rej.json)).toBe(200);
    const stats = (await cat.get('/v1/ops/products/stats')).json;
    expect(stats.queue.readyForReview).toBeGreaterThanOrEqual(1);
    expect(stats.queue.medianAgeHours).toBeGreaterThanOrEqual(0);
    const row = stats.rejectionByPartner.find((r: { partnerId: string }) => r.partnerId === p2);
    expect(row).toMatchObject({ rejected: 1, verified: 1, rejectionRate: 0.5 });
  });
});
