import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { withActor } from '../src/context.ts';
import { createTestDatabase, fixtures, type TestDatabase } from '../src/testing/index.ts';
import { expectPgError } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

async function reserved(stock: number, qty: number) {
  const cat = await fixtures.catalogue(t.admin, { stock_qty: stock });
  const customerId = await fixtures.customer(t.admin);
  const { reservationId } = await fixtures.reservation(t.admin, {
    customerId,
    offerId: cat.offer,
    priceFils: 100_000,
  });
  await withActor(t.app, { kind: 'system' }, (trx) =>
    sql`SELECT commerce.try_reserve(${reservationId}::uuid, ${cat.offer}, ${qty})`.execute(trx),
  );
  return cat;
}

const setStock = (actor: Parameters<typeof withActor>[1], offer: string, stock: number) =>
  withActor(t.app, actor, (trx) =>
    trx
      .updateTable('catalogue.seller_offer')
      .set({ stock_qty: stock })
      .where('id', '=', offer)
      .execute(),
  );

describe('stock cannot be lowered beneath live reservations', () => {
  it('refuses a seller, and ops, but allows exactly the reserved quantity', async () => {
    const cat = await reserved(5, 3);
    const seller = { kind: 'seller', partnerId: cat.partner } as const;
    await expectPgError(setStock(seller, cat.offer, 2), { code: '23514', message: /3 units held/ });
    await expectPgError(setStock({ kind: 'ops' }, cat.offer, 1), { code: '23514' });
    await setStock(seller, cat.offer, 3);
    const row = await t.admin
      .selectFrom('catalogue.seller_offer')
      .select('stock_qty')
      .where('id', '=', cat.offer)
      .executeTakeFirstOrThrow();
    expect(row.stock_qty).toBe(3);
  });

  it('does not constrain raising stock, or an offer with nothing reserved', async () => {
    const cat = await fixtures.catalogue(t.admin, { stock_qty: 5 });
    const seller = { kind: 'seller', partnerId: cat.partner } as const;
    await setStock(seller, cat.offer, 9);
    await setStock(seller, cat.offer, 1);
  });

  it('ignores reservations that have expired', async () => {
    const cat = await reserved(5, 3);
    await t.admin
      .updateTable('commerce.reservation')
      .set({ state: 'Expired' })
      .where('state', '=', 'Active')
      .execute();
    await setStock({ kind: 'seller', partnerId: cat.partner }, cat.offer, 1);
    const row = await t.admin
      .selectFrom('catalogue.seller_offer')
      .select('stock_qty')
      .where('id', '=', cat.offer)
      .executeTakeFirstOrThrow();
    expect(row.stock_qty).toBe(1);
  });
});

describe('offer version', () => {
  it('increments on every update, so concurrent edits are detectable', async () => {
    const cat = await fixtures.catalogue(t.admin);
    const v = async () =>
      (
        await t.admin
          .selectFrom('catalogue.seller_offer')
          .select('version')
          .where('id', '=', cat.offer)
          .executeTakeFirstOrThrow()
      ).version;
    const before = await v();
    await t.admin
      .updateTable('catalogue.seller_offer')
      .set({ delivery_days: 9 })
      .where('id', '=', cat.offer)
      .execute();
    expect(await v()).toBe(before + 1);
  });
});
