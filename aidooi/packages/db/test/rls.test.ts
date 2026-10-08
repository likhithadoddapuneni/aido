import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createPool } from '../src/client.ts';
import { withActor } from '../src/context.ts';
import { createTestDatabase, fixtures, type TestDatabase } from '../src/testing/index.ts';
import { expectPgError } from './helpers.ts';

let t: TestDatabase;

interface Side {
  graph: Awaited<ReturnType<typeof fixtures.orderGraph>>;
}
let a: Side;
let b: Side;
let inactiveOfferOfA: string;

beforeAll(async () => {
  t = await createTestDatabase();
  a = { graph: await fixtures.orderGraph(t.admin) };
  b = { graph: await fixtures.orderGraph(t.admin) };
  inactiveOfferOfA = await fixtures.offer(
    t.admin,
    {
      productId: await fixtures.product(t.admin, a.graph.ops),
      partnerId: a.graph.partner,
      locationId: a.graph.location,
    },
    { offer_status: 'Inactive' },
  );
});
afterAll(() => t.drop());

const seller = (g: Side) => ({ kind: 'seller', partnerId: g.graph.partner }) as const;
const buyer = (g: Side) => ({ kind: 'buyer', customerId: g.graph.customer }) as const;

describe('row-level security, as aidooi_app', () => {
  it('shows nothing when no actor is set', async () => {
    for (const table of [
      'catalogue.seller_offer',
      'fulfilment.order_line',
      'commerce.seller_order',
      'commerce.payment',
    ] as const) {
      expect(await t.app.selectFrom(table).selectAll().execute(), table).toEqual([]);
    }
  });

  it('isolates one seller from another', async () => {
    const ids = await withActor(t.app, seller(a), async (trx) => ({
      offers: (await trx.selectFrom('catalogue.seller_offer').select('partner_id').execute()).map(
        (r) => r.partner_id,
      ),
      lines: (await trx.selectFrom('fulfilment.order_line').select('id').execute()).map(
        (r) => r.id,
      ),
      orders: (await trx.selectFrom('commerce.seller_order').select('partner_id').execute()).map(
        (r) => r.partner_id,
      ),
    }));
    expect(new Set(ids.offers)).toEqual(new Set([a.graph.partner]));
    expect(ids.lines).toEqual([a.graph.orderLine]);
    expect(new Set(ids.orders)).toEqual(new Set([a.graph.partner]));
  });

  it('lets a seller edit only their own offers', async () => {
    const own = await withActor(t.app, seller(a), (trx) =>
      trx
        .updateTable('catalogue.seller_offer')
        .set({ stock_qty: 7 })
        .where('id', '=', a.graph.offer)
        .executeTakeFirst(),
    );
    expect(own.numUpdatedRows).toBe(1n);
    const other = await withActor(t.app, seller(a), (trx) =>
      trx
        .updateTable('catalogue.seller_offer')
        .set({ stock_qty: 7 })
        .where('id', '=', b.graph.offer)
        .executeTakeFirst(),
    );
    expect(other.numUpdatedRows).toBe(0n);
  });

  it('stops a seller creating offers for someone else', async () => {
    await expectPgError(
      withActor(t.app, seller(a), (trx) =>
        fixtures.offer(trx, {
          productId: b.graph.product,
          partnerId: b.graph.partner,
          locationId: b.graph.location,
        }),
      ),
      { code: '42501' },
    );
  });

  it('lets buyers browse active offers only', async () => {
    const offers = await withActor(t.app, { kind: 'buyer' }, (trx) =>
      trx.selectFrom('catalogue.seller_offer').select(['id', 'offer_status']).execute(),
    );
    expect(offers.length).toBeGreaterThanOrEqual(2);
    expect(offers.every((o) => o.offer_status === 'Active')).toBe(true);
    expect(offers.map((o) => o.id)).not.toContain(inactiveOfferOfA);
  });

  it('gives a buyer their own orders and nothing of anyone else’s', async () => {
    const mine = await withActor(t.app, buyer(a), async (trx) => ({
      lines: (await trx.selectFrom('fulfilment.order_line').select('id').execute()).map(
        (r) => r.id,
      ),
      payments: (await trx.selectFrom('commerce.payment').select('id').execute()).map((r) => r.id),
      master: (await trx.selectFrom('commerce.master_order').select('id').execute()).map(
        (r) => r.id,
      ),
    }));
    expect(mine).toEqual({
      lines: [a.graph.orderLine],
      payments: [a.graph.payment],
      master: [a.graph.masterOrder],
    });
  });

  it('shows a guest no personal or order data', async () => {
    const seen = await withActor(t.app, { kind: 'buyer' }, async (trx) => ({
      lines: await trx.selectFrom('fulfilment.order_line').select('id').execute(),
      payments: await trx.selectFrom('commerce.payment').select('id').execute(),
    }));
    expect(seen).toEqual({ lines: [], payments: [] });
  });

  it('keeps buyer tables closed to sellers', async () => {
    const seen = await withActor(t.app, seller(a), async (trx) => ({
      master: await trx.selectFrom('commerce.master_order').select('id').execute(),
      payments: await trx.selectFrom('commerce.payment').select('id').execute(),
      addresses: await trx.selectFrom('identity.customer_address').select('id').execute(),
    }));
    expect(seen).toEqual({ master: [], payments: [], addresses: [] });
  });

  it('exposes the delivery copy to the fulfilling seller only', async () => {
    await t.admin
      .insertInto('commerce.order_delivery')
      .values({
        master_order_id: a.graph.masterOrder,
        customer_id: a.graph.customer,
        recipient_name: 'Layla',
        phone_e164: '+971501234567',
        line1: 'Marina Walk',
        emirate: 'Dubai',
      })
      .execute();
    const forA = await withActor(t.app, seller(a), (trx) =>
      trx.selectFrom('commerce.order_delivery').select('recipient_name').execute(),
    );
    const forB = await withActor(t.app, seller(b), (trx) =>
      trx.selectFrom('commerce.order_delivery').select('recipient_name').execute(),
    );
    const forBuyerB = await withActor(t.app, buyer(b), (trx) =>
      trx.selectFrom('commerce.order_delivery').select('recipient_name').execute(),
    );
    expect(forA).toEqual([{ recipient_name: 'Layla' }]);
    expect(forB).toEqual([]);
    expect(forBuyerB).toEqual([]);
  });

  it('lets a seller advance their line but not create one', async () => {
    const updated = await withActor(t.app, seller(a), (trx) =>
      trx
        .updateTable('fulfilment.order_line')
        .set({ state: 'Preparing' })
        .where('id', '=', a.graph.orderLine)
        .executeTakeFirst(),
    );
    expect(updated.numUpdatedRows).toBe(1n);
    const foreign = await withActor(t.app, seller(a), (trx) =>
      trx
        .updateTable('fulfilment.order_line')
        .set({ state: 'Preparing' })
        .where('id', '=', b.graph.orderLine)
        .executeTakeFirst(),
    );
    expect(foreign.numUpdatedRows).toBe(0n);
    await expectPgError(
      withActor(t.app, seller(a), (trx) => fixtures.orderGraph(trx)),
      { code: '42501' },
    );
  });

  it('scopes the confirmation queue and statements to the seller', async () => {
    await t.admin
      .insertInto('commerce.confirmation_task')
      .values([
        {
          task_type: 'fulfilment',
          partner_id: a.graph.partner,
          order_line_id: a.graph.orderLine,
          due_at: new Date(Date.now() + 3600_000),
        },
        {
          task_type: 'fulfilment',
          partner_id: b.graph.partner,
          order_line_id: b.graph.orderLine,
          due_at: new Date(Date.now() + 3600_000),
        },
      ])
      .execute();
    const queue = await withActor(t.app, seller(a), (trx) =>
      trx.selectFrom('commerce.confirmation_task').select('partner_id').execute(),
    );
    expect(queue).toEqual([{ partner_id: a.graph.partner }]);
  });

  it('lets ops and the system see everything', async () => {
    for (const kind of ['ops', 'system'] as const) {
      const lines = await withActor(t.app, { kind }, (trx) =>
        trx.selectFrom('fulfilment.order_line').select('id').execute(),
      );
      expect(lines.length, kind).toBeGreaterThanOrEqual(2);
    }
  });

  it('does not leak the actor onto the next user of a pooled connection', async () => {
    const pool = createPool(t.url, { max: 1, role: 'aidooi_app' });
    const db = createDb(pool);
    try {
      const during = await withActor(db, seller(a), (trx) =>
        trx.selectFrom('fulfilment.order_line').select('id').execute(),
      );
      expect(during.length).toBe(1);
      const after = await db.selectFrom('fulfilment.order_line').select('id').execute();
      expect(after).toEqual([]);
      const setting = await sql<{
        v: string | null;
      }>`SELECT current_setting('app.actor_kind', true) AS v`.execute(db);
      expect(setting.rows[0]!.v ?? '').toBe('');
    } finally {
      await db.destroy();
    }
  });

  it('rejects malformed ids before they reach the database', async () => {
    await expect(
      withActor(t.app, { kind: 'seller', partnerId: "x'; DROP TABLE y;--" }, async () => 1),
    ).rejects.toThrow(/UUID/);
  });
});

describe('seller-managed reference data', () => {
  it('scopes locations, team members and imports to the seller', async () => {
    const sellerUserA = await fixtures.sellerUser(t.admin, a.graph.partner);
    await fixtures.sellerUser(t.admin, b.graph.partner);
    const job = (partnerId: string, sellerUserId: string) => ({
      partner_id: partnerId,
      seller_user_id: sellerUserId,
      file_key: 'imports/x.xlsx',
    });
    const jobA = await t.admin
      .insertInto('catalogue.import_job')
      .values(job(a.graph.partner, sellerUserA))
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.admin
      .insertInto('catalogue.import_job')
      .values(job(b.graph.partner, await fixtures.sellerUser(t.admin, b.graph.partner)))
      .execute();
    await t.admin
      .insertInto('catalogue.import_row')
      .values({ import_job_id: jobA.id, row_number: 1, raw: { sku: 'x' }, status: 'Valid' })
      .execute();

    const seen = await withActor(t.app, seller(a), async (trx) => ({
      users: (await trx.selectFrom('identity.seller_user').select('partner_id').execute()).map(
        (r) => r.partner_id,
      ),
      locations: (
        await trx.selectFrom('catalogue.partner_location').select('partner_id').execute()
      ).map((r) => r.partner_id),
      jobs: (await trx.selectFrom('catalogue.import_job').select('partner_id').execute()).map(
        (r) => r.partner_id,
      ),
      rows: await trx.selectFrom('catalogue.import_row').select('row_number').execute(),
    }));
    expect(new Set(seen.users)).toEqual(new Set([a.graph.partner]));
    expect(new Set(seen.locations)).toEqual(new Set([a.graph.partner]));
    expect(new Set(seen.jobs)).toEqual(new Set([a.graph.partner]));
    expect(seen.rows).toEqual([{ row_number: 1 }]);

    const rowsForB = await withActor(t.app, seller(b), (trx) =>
      trx.selectFrom('catalogue.import_row').select('row_number').execute(),
    );
    expect(rowsForB).toEqual([]);
  });

  it('lets buyers see active showroom locations but not the seller’s team', async () => {
    const seen = await withActor(t.app, { kind: 'buyer' }, async (trx) => ({
      locations: await trx.selectFrom('catalogue.partner_location').select('id').execute(),
      users: await trx.selectFrom('identity.seller_user').select('id').execute(),
    }));
    expect(seen.locations.length).toBeGreaterThanOrEqual(2);
    expect(seen.users).toEqual([]);
  });

  it('stops a seller adding staff to another partner', async () => {
    await expectPgError(
      withActor(t.app, seller(a), (trx) => fixtures.sellerUser(trx, b.graph.partner)),
      { code: '42501' },
    );
  });
});

describe('the read-only analytics role', () => {
  it('reads operational data but no identity data or delivery addresses', async () => {
    const pool = createPool(t.url, { max: 1, role: 'aidooi_readonly' });
    const db = createDb(pool);
    try {
      expect(
        (await db.selectFrom('fulfilment.order_line').select('id').execute()).length,
      ).toBeGreaterThanOrEqual(2);
      await expectPgError(db.selectFrom('identity.customer').select('id').execute(), {
        code: '42501',
      });
      await expectPgError(db.selectFrom('commerce.order_delivery').select('id').execute(), {
        code: '42501',
      });
      await expectPgError(
        db.updateTable('fulfilment.order_line').set({ state: 'Cancelled' }).execute(),
        { code: '42501' },
      );
    } finally {
      await db.destroy();
    }
  });
});
