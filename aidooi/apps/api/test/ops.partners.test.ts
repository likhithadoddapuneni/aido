import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures } from '@aidooi/db/testing';
import { guest } from './support/harness.ts';
import { startHarness, type Harness } from './support/harness.ts';
import { createOrder } from './support/orders.ts';
import { NEW_PARTNER, as, opsActor } from './support/ops.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const reason = 'reviewed by the desk';

async function actors() {
  return {
    admin: as(h, await opsActor(h, 'ops_admin')),
    cat: as(h, await opsActor(h, 'ops_catalogue')),
    support: as(h, await opsActor(h, 'ops_support')),
  };
}

describe('partner lifecycle (AID-LOG-013)', () => {
  it('creates a partner in Requested with the next PRT-#### code, and audits it', async () => {
    const { cat } = await actors();
    const a = await cat.post('/v1/ops/partners', NEW_PARTNER);
    const b = await cat.post('/v1/ops/partners', { ...NEW_PARTNER, tradeName: 'Second Co' });
    expect(a.status).toBe(201);
    expect(a.json).toMatchObject({
      status: 'Requested',
      commissionBps: 1500,
      tradeName: 'Palm Interiors',
    });
    expect(a.json.code).toMatch(/^PRT-\d{4}$/);
    expect(Number(b.json.code.slice(4))).toBe(Number(a.json.code.slice(4)) + 1);
    const audit = await h.admin
      .selectFrom('audit.event')
      .select('to_state')
      .where('entity_type', '=', 'partner')
      .where('entity_id', '=', a.json.id)
      .execute();
    expect(audit.map((x) => x.to_state)).toEqual(['Requested']);
  });

  it('concurrent creates never share a code', async () => {
    const { cat } = await actors();
    const made = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        cat.post('/v1/ops/partners', { ...NEW_PARTNER, tradeName: `Concurrent ${i}` }),
      ),
    );
    expect(made.every((m) => m.status === 201)).toBe(true);
    expect(new Set(made.map((m) => m.json.code)).size).toBe(6);
  });

  it('validates input and lists with search, status filter and keyset pagination', async () => {
    const { cat } = await actors();
    expect(
      (await cat.post('/v1/ops/partners', { ...NEW_PARTNER, commissionBps: 20_000 })).status,
    ).toBe(400);
    await cat.post('/v1/ops/partners', { ...NEW_PARTNER, tradeName: 'Zebra Findable Co' });
    const hit = await cat.get('/v1/ops/partners?search=zebra%20findable');
    expect(hit.json.items.map((p: { tradeName: string }) => p.tradeName)).toEqual([
      'Zebra Findable Co',
    ]);
    const first = await cat.get('/v1/ops/partners?limit=3');
    expect(first.json.items).toHaveLength(3);
    const second = await cat.get(`/v1/ops/partners?limit=3&cursor=${first.json.nextCursor}`);
    const ids = [...first.json.items, ...second.json.items].map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      (await cat.get('/v1/ops/partners?status=Requested&limit=100')).json.items.every(
        (p: { status: string }) => p.status === 'Requested',
      ),
    ).toBe(true);
  });

  it('illegal transitions are refused (422), and the database refuses Active without an activation date', async () => {
    const { admin, cat } = await actors();
    const p = (await cat.post('/v1/ops/partners', NEW_PARTNER)).json;
    const skip = await admin.post(`/v1/ops/partners/${p.id}/transition`, { to: 'Active', reason });
    expect(skip.status).toBe(422);
    expect(skip.json.code).toBe('illegal_transition');
    expect(
      (
        await admin.post(`/v1/ops/partners/${p.id}/transition`, {
          to: 'Approved/Agreement Pending',
          reason,
        })
      ).status,
    ).toBe(422);
    // Skipping review is refused by the database's lifecycle trigger…
    await expect(
      h.admin
        .updateTable('catalogue.partner')
        .set({ status: 'Active' })
        .where('id', '=', p.id)
        .execute(),
    ).rejects.toThrow(/illegal partner_status transition: Requested -> Active/);
    // …and even a legal move into Active is refused without an activation date.
    await h.admin
      .updateTable('catalogue.partner')
      .set({ status: 'Under Review' })
      .where('id', '=', p.id)
      .execute();
    await h.admin
      .updateTable('catalogue.partner')
      .set({ status: 'Approved/Agreement Pending' })
      .where('id', '=', p.id)
      .execute();
    await expect(
      h.admin
        .updateTable('catalogue.partner')
        .set({ status: 'Active' })
        .where('id', '=', p.id)
        .execute(),
    ).rejects.toThrow(/partner_activated_ck/);
  });

  it('activation needs a location, an invited owner, a commission and after-sales terms — each named', async () => {
    const { admin, cat } = await actors();
    const p = (
      await cat.post('/v1/ops/partners', {
        ...NEW_PARTNER,
        commissionBps: 0,
        afterSalesTerms: null,
      })
    ).json;
    await cat.post(`/v1/ops/partners/${p.id}/transition`, { to: 'Under Review', reason });
    await cat.post(`/v1/ops/partners/${p.id}/transition`, {
      to: 'Approved/Agreement Pending',
      reason,
    });

    const first = await admin.post(`/v1/ops/partners/${p.id}/transition`, { to: 'Active', reason });
    expect(first.status).toBe(422);
    expect(first.json.code).toBe('activation_preconditions');
    for (const need of ['active location', 'invited owner', 'commission rate', 'after-sales terms'])
      expect(first.json.detail).toContain(need);

    await fixtures.location(h.admin, p.id);
    await admin.patch(`/v1/ops/partners/${p.id}`, {
      commissionBps: 1200,
      afterSalesTerms: 'Seven day returns.',
    });
    const noOwner = await admin.post(`/v1/ops/partners/${p.id}/transition`, {
      to: 'Active',
      reason,
    });
    expect(noOwner.json.detail).toContain('invited owner');
    expect(noOwner.json.detail).not.toContain('location');

    const inv = await admin.post(`/v1/ops/partners/${p.id}/owner-invitation`, {
      email: 'Owner@Palm.test',
      fullName: 'Palm Owner',
    });
    expect(inv.status).toBe(201);
    const done = await admin.post(`/v1/ops/partners/${p.id}/transition`, { to: 'Active', reason });
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    expect(done.json).toMatchObject({ status: 'Active' });
    expect(done.json.activatedAt).toBeTruthy();
  });

  it('the activation checklist reports each condition as it becomes true, and who may read it', async () => {
    const { admin, cat, support } = await actors();
    const p = (
      await cat.post('/v1/ops/partners', {
        ...NEW_PARTNER,
        commissionBps: 0,
        afterSalesTerms: null,
      })
    ).json;
    const url = `/v1/ops/partners/${p.id}/activation-checklist`;
    const state = async () => (await cat.get(url)).json;

    expect(await state()).toEqual({
      ready: false,
      items: [
        { key: 'location', met: false },
        { key: 'owner', met: false },
        { key: 'commission', met: false },
        { key: 'afterSales', met: false },
      ],
    });
    await fixtures.location(h.admin, p.id);
    await admin.patch(`/v1/ops/partners/${p.id}`, {
      commissionBps: 1200,
      afterSalesTerms: 'Seven day returns.',
    });
    expect(
      (await state()).items
        .filter((i: { met: boolean }) => i.met)
        .map((i: { key: string }) => i.key),
    ).toEqual(['location', 'commission', 'afterSales']);
    await admin.post(`/v1/ops/partners/${p.id}/owner-invitation`, {
      email: 'c@palm.test',
      fullName: 'Chk Owner',
    });
    expect(await state()).toMatchObject({ ready: true });

    expect((await support.get(url)).status).toBe(200); // the desk may read it
    expect((await as(h, null).get(url)).status).toBe(401);
    expect((await as(h, guest()).get(url)).status).toBe(403);
    expect(
      (await cat.get('/v1/ops/partners/00000000-0000-4000-8000-000000000000/activation-checklist'))
        .status,
    ).toBe(404);
  });

  it('the owner invitation reaches the owner only through the notifier, never the response', async () => {
    const { cat } = await actors();
    const p = (await cat.post('/v1/ops/partners', NEW_PARTNER)).json;
    const res = await cat.post(`/v1/ops/partners/${p.id}/owner-invitation`, {
      email: 'boss@palm.test',
      fullName: 'The Boss',
    });
    expect(Object.keys(res.json).sort()).toEqual(['expiresAt', 'userId']);
    expect(JSON.stringify(res.json)).not.toMatch(/token/i);
    const sent = h.notifier
      .ofTemplate('partner.owner_invited')
      .filter((n) => n.data['email'] === 'boss@palm.test');
    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.data['inviteToken']).length).toBeGreaterThan(20);
    const team = await cat.get(`/v1/ops/partners/${p.id}/team`);
    expect(team.json.members).toEqual([
      expect.objectContaining({
        email: 'boss@palm.test',
        role: 'seller_owner',
        status: 'Invited',
        mfaEnrolled: false,
      }),
    ]);
    // Re-inviting supersedes rather than duplicating.
    await cat.post(`/v1/ops/partners/${p.id}/owner-invitation`, {
      email: 'boss@palm.test',
      fullName: 'The Boss',
    });
    expect((await cat.get(`/v1/ops/partners/${p.id}/team`)).json.members).toHaveLength(1);
    // The email already belongs to a user of another partner → refused.
    const other = (await cat.post('/v1/ops/partners', NEW_PARTNER)).json;
    expect(
      (
        await cat.post(`/v1/ops/partners/${other.id}/owner-invitation`, {
          email: 'boss@palm.test',
          fullName: 'The Boss',
        })
      ).status,
    ).toBe(409);
  });

  it('deactivation is refused while order lines are undelivered, unless an administrator forces it with a reason', async () => {
    const { admin, cat } = await actors();
    const order = await createOrder(h, { lines: [{ partner: 'PRT-002' }] });
    const pid = order.partnerIds[0]!;
    const refused = await admin.post(`/v1/ops/partners/${pid}/transition`, {
      to: 'Inactive',
      reason,
    });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('undelivered_lines');
    expect(
      (
        await cat.post(`/v1/ops/partners/${pid}/transition`, {
          to: 'Inactive',
          reason,
          force: true,
        })
      ).status,
    ).toBe(403);
    const forced = await admin.post(`/v1/ops/partners/${pid}/transition`, {
      to: 'Inactive',
      reason,
      force: true,
    });
    expect(forced.status).toBe(200);
    expect(forced.json.status).toBe('Inactive');
    const ev = await h.admin
      .selectFrom('audit.event')
      .select(['reason', 'data'])
      .where('entity_id', '=', pid)
      .where('to_state', '=', 'Inactive')
      .executeTakeFirstOrThrow();
    expect(ev.reason).toBe(reason);
    expect(ev.data).toMatchObject({ forced: true });
    // Its offers leave the eligibility view immediately.
    const left = await h.admin
      .selectFrom('catalogue.eligible_offer')
      .select((e) => e.fn.countAll<string>().as('n'))
      .where('partner_id', '=', pid)
      .executeTakeFirstOrThrow();
    expect(Number(left.n)).toBe(0);
  });

  it('a commission change moves current offers to the new rate and never touches a placed order line', async () => {
    const { admin } = await actors();
    const order = await createOrder(h, { lines: [{ partner: 'PRT-003', commissionBps: 1300 }] });
    const pid = order.partnerIds[0]!;
    const lineBefore = await h.admin
      .selectFrom('fulfilment.order_line')
      .select(['commission_rate', 'commission_fils', 'snapshot'])
      .where('id', '=', order.lineIds[0]!)
      .executeTakeFirstOrThrow();
    const res = await admin.patch(`/v1/ops/partners/${pid}`, { commissionBps: 2000 });
    expect(res.json.commissionBps).toBe(2000);
    const rates = await h.admin
      .selectFrom('catalogue.seller_offer')
      .select('commission_rate')
      .where('partner_id', '=', pid)
      .groupBy('commission_rate')
      .execute();
    expect(rates.map((r) => Number(r.commission_rate))).toEqual([0.2]);
    const lineAfter = await h.admin
      .selectFrom('fulfilment.order_line')
      .select(['commission_rate', 'commission_fils', 'snapshot'])
      .where('id', '=', order.lineIds[0]!)
      .executeTakeFirstOrThrow();
    expect(lineAfter).toEqual(lineBefore);
    expect(Number(lineAfter.commission_rate)).toBe(0.13);
    // Even by hand, a placed line cannot be rewritten.
    await expect(
      h.admin
        .updateTable('fulfilment.order_line')
        .set({ commission_rate: 0.2 })
        .where('id', '=', order.lineIds[0]!)
        .execute(),
    ).rejects.toThrow(/write-once|immutable|cannot/i);
    const audited = await h.admin
      .selectFrom('audit.event')
      .select('data')
      .where('entity_id', '=', pid)
      .where('reason', '=', 'commission changed')
      .executeTakeFirstOrThrow();
    expect(audited.data).toMatchObject({
      fromBps: 1300,
      toBps: 2000,
    });
  });

  it('END TO END: a new partner is onboarded through the API and its offers then win a recommendation', async () => {
    const { admin, cat } = await actors();
    // Take every seeded partner off the market: with nothing eligible, a recommendation fails.
    const seededIds = [...h.seeded!.partners.values()];
    const living = {
      pathId: 'livingRoom',
      lengthM: 5,
      widthM: 4,
      style: 'modern',
      colour: 'grey',
      tier: 'Standard',
    };
    const session = '9c000000-0000-4000-8000-000000000001';
    await h.admin
      .insertInto('identity.guest_session')
      .values({
        id: session,
        token_hash: 'e2e-hash',
        expires_at: new Date(Date.now() + 86_400_000),
      })
      .execute();
    const buyerApi = as(h, guest(session));
    const project = (await buyerApi.post('/v1/projects', { input: living })).json;

    // Use a throwaway order-free state: the earlier tests created orders for PRT-002/003 lines, so force.
    for (const id of seededIds) {
      const cur = await h.admin
        .selectFrom('catalogue.partner')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      if (cur.status === 'Active')
        expect(
          (
            await admin.post(`/v1/ops/partners/${id}/transition`, {
              to: 'Inactive',
              reason,
              force: true,
            })
          ).status,
        ).toBe(200);
    }
    const none = await buyerApi.post(`/v1/projects/${project.id}/recommend`);
    expect(none.json.runs[0].status).toBe('Failed');

    // Onboard: create → review → approve → location → owner → activate.
    const p = (await cat.post('/v1/ops/partners', NEW_PARTNER)).json;
    await cat.post(`/v1/ops/partners/${p.id}/transition`, { to: 'Under Review', reason });
    await cat.post(`/v1/ops/partners/${p.id}/transition`, {
      to: 'Approved/Agreement Pending',
      reason,
    });
    const loc = await fixtures.location(h.admin, p.id);
    await cat.post(`/v1/ops/partners/${p.id}/owner-invitation`, {
      email: 'e2e-owner@palm.test',
      fullName: 'E2E Owner',
    });
    // The new seller lists its range: one offer per verified product, at the seeded prices.
    await sql`
      INSERT INTO catalogue.seller_offer (product_id, partner_id, partner_location_id, seller_sku, selling_price_fils,
                                          availability, stock_qty, viewing_status, delivery_days, commission_rate, offer_status)
      SELECT DISTINCT ON (o.product_id) o.product_id, ${p.id}::uuid, ${loc}::uuid, 'N-' || o.id, o.selling_price_fils,
             'In Stock', 10, 'On Display', 2, 0.15, 'Active'
        FROM catalogue.seller_offer o ORDER BY o.product_id, o.id`.execute(h.admin);
    // Before activation the partner's offers are invisible (the view requires an Active partner).
    expect((await buyerApi.post(`/v1/projects/${project.id}/recommend`)).json.runs[0].status).toBe(
      'Failed',
    );

    expect(
      (await admin.post(`/v1/ops/partners/${p.id}/transition`, { to: 'Active', reason })).status,
    ).toBe(200);
    const run = (await buyerApi.post(`/v1/projects/${project.id}/recommend`)).json.runs[0];
    expect(run.status).toBe('Completed');
    const partnerIds = new Set(
      run.compositions.flatMap((c: { items: { offer: { partner: { id: string } } }[] }) =>
        c.items.map((i) => i.offer.partner.id),
      ),
    );
    expect([...partnerIds]).toEqual([p.id]);
  });
});
