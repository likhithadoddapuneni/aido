import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withActor } from '../src/context.ts';
import { createTestDatabase, fixtures, type TestDatabase } from '../src/testing/index.ts';
import { expectPgError } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

const tryReserve = (reservationId: string, offerId: string, qty: number) =>
  withActor(t.app, { kind: 'system' }, async (trx) => {
    const { rows } = await sql<{ ok: boolean }>`
      SELECT commerce.try_reserve(${reservationId}::uuid, ${offerId}, ${qty}) AS ok`.execute(trx);
    return rows[0]!.ok;
  });

async function buyers(n: number, offerId: string, priceFils: number) {
  return Promise.all(
    Array.from({ length: n }, async () => {
      const customerId = await fixtures.customer(t.admin);
      return fixtures.reservation(t.admin, { customerId, offerId, priceFils });
    }),
  );
}

describe('stock reservation', () => {
  it('never oversells: 20 simultaneous buyers, 5 units, exactly 5 succeed', async () => {
    const cat = await fixtures.catalogue(t.admin, { stock_qty: 5, availability: 'Low Stock' });
    const people = await buyers(20, cat.offer, 350_000);

    const results = await Promise.all(people.map((p) => tryReserve(p.reservationId, cat.offer, 1)));
    expect(results.filter(Boolean)).toHaveLength(5);

    const held = await t.admin
      .selectFrom('commerce.reserved_qty')
      .select('reserved')
      .where('offer_id', '=', cat.offer)
      .executeTakeFirstOrThrow();
    expect(held.reserved).toBe(5);

    // Paying converts holds into sold units; stock hits exactly zero and the offer closes.
    const winners = people.filter((_, i) => results[i]);
    for (const w of winners) {
      await withActor(t.app, { kind: 'system' }, (trx) =>
        sql`SELECT commerce.consume_reservation(${w.reservationId}::uuid)`.execute(trx),
      );
    }
    const offer = await t.admin
      .selectFrom('catalogue.seller_offer')
      .select(['stock_qty', 'availability'])
      .where('id', '=', cat.offer)
      .executeTakeFirstOrThrow();
    expect(offer).toEqual({ stock_qty: 0, availability: 'Out of Stock' });
    const converted = await t.admin
      .selectFrom('commerce.reservation')
      .select('state')
      .where(
        'id',
        'in',
        winners.map((w) => w.reservationId),
      )
      .execute();
    expect(converted.every((r) => r.state === 'Converted')).toBe(true);
  });

  it('respects quantities: two buyers wanting 3 of 5 units, only one wins', async () => {
    const cat = await fixtures.catalogue(t.admin, { stock_qty: 5 });
    const people = await buyers(2, cat.offer, 350_000);
    const results = await Promise.all(people.map((p) => tryReserve(p.reservationId, cat.offer, 3)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('lets a buyer change their own quantity without counting themselves twice', async () => {
    const cat = await fixtures.catalogue(t.admin, { stock_qty: 4 });
    const [p] = await buyers(1, cat.offer, 350_000);
    expect(await tryReserve(p!.reservationId, cat.offer, 3)).toBe(true);
    expect(await tryReserve(p!.reservationId, cat.offer, 4)).toBe(true);
    expect(await tryReserve(p!.reservationId, cat.offer, 5)).toBe(false);
  });

  it('frees stock when a reservation passes its expiry, before any job runs', async () => {
    const cat = await fixtures.catalogue(t.admin, { stock_qty: 1, availability: 'Low Stock' });
    const [first, second] = await buyers(2, cat.offer, 350_000);
    expect(await tryReserve(first!.reservationId, cat.offer, 1)).toBe(true);
    expect(await tryReserve(second!.reservationId, cat.offer, 1)).toBe(false);

    await t.admin
      .updateTable('commerce.reservation')
      .set({
        started_at: sql`now() - interval '2 hours'`,
        expires_at: sql`now() - interval '1 hour'`,
      })
      .where('id', '=', first!.reservationId)
      .execute();
    expect(await tryReserve(second!.reservationId, cat.offer, 1)).toBe(true);
    await expectPgError(tryReserve(first!.reservationId, cat.offer, 1), {
      message: /is not active/,
    });
  });

  it('declines inactive and sold-out offers', async () => {
    const inactive = await fixtures.catalogue(t.admin, { offer_status: 'Inactive' });
    const soldOut = await fixtures.catalogue(t.admin, {
      stock_qty: 0,
      availability: 'Out of Stock',
    });
    const [a] = await buyers(1, inactive.offer, 1000);
    const [b] = await buyers(1, soldOut.offer, 1000);
    expect(await tryReserve(a!.reservationId, inactive.offer, 1)).toBe(false);
    expect(await tryReserve(b!.reservationId, soldOut.offer, 1)).toBe(false);
  });

  it('refuses to consume a reservation if the seller reduced stock in the meantime', async () => {
    const cat = await fixtures.catalogue(t.admin, { stock_qty: 2 });
    const [p] = await buyers(1, cat.offer, 1000);
    await tryReserve(p!.reservationId, cat.offer, 2);
    // Sellers and ops can no longer do this (see seller-stock-guard.test.ts); only the platform can, so
    // consume_reservation keeps its own refusal as defence in depth.
    await withActor(t.app, { kind: 'system' }, (trx) =>
      trx
        .updateTable('catalogue.seller_offer')
        .set({ stock_qty: 1 })
        .where('id', '=', cat.offer)
        .execute(),
    );
    await expectPgError(
      withActor(t.app, { kind: 'system' }, (trx) =>
        sql`SELECT commerce.consume_reservation(${p!.reservationId}::uuid)`.execute(trx),
      ),
      { message: /no longer has 2 units/ },
    );
    const unchanged = await t.admin
      .selectFrom('commerce.reservation')
      .select('state')
      .where('id', '=', p!.reservationId)
      .executeTakeFirstOrThrow();
    expect(unchanged.state).toBe('Active');
  });

  it.each([['buyer'], ['seller'], ['ops']] as const)(
    'cannot be driven by a %s context',
    async (kind) => {
      const cat = await fixtures.catalogue(t.admin, { stock_qty: 3 });
      const [p] = await buyers(1, cat.offer, 1000);
      const actor =
        kind === 'seller' ? ({ kind, partnerId: cat.partner } as const) : ({ kind } as const);
      const call = (fn: string) =>
        withActor(t.app, actor, (trx) => sql.raw(`SELECT commerce.${fn}`).execute(trx));
      await expectPgError(call(`try_reserve('${p!.reservationId}', '${cat.offer}', 1)`), {
        code: '42501',
      });
      await expectPgError(call(`consume_reservation('${p!.reservationId}')`), { code: '42501' });
    },
  );
});
