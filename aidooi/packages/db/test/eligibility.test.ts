import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, fixtures, type TestDatabase } from '../src/testing/index.ts';
import { expectPgError } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

const isEligible = async (offerId: string) =>
  (
    await t.admin
      .selectFrom('catalogue.eligible_offer')
      .select('offer_id')
      .where('offer_id', '=', offerId)
      .execute()
  ).length === 1;

describe('catalogue.eligible_offer (the recommendation gate)', () => {
  it('admits a verified, active product with an active, in-stock offer from an active partner', async () => {
    const c = await fixtures.catalogue(t.admin);
    expect(await isEligible(c.offer)).toBe(true);
  });

  const exclusions: {
    name: string;
    build: () => Promise<string>;
  }[] = [
    {
      name: 'product not yet verified',
      build: async () => {
        const ops = await fixtures.opsUser(t.admin);
        const p = await fixtures.partner(t.admin);
        const l = await fixtures.location(t.admin, p);
        const prod = await fixtures.product(t.admin, ops, { data_status: 'Ready for Review' });
        return fixtures.offer(t.admin, { productId: prod, partnerId: p, locationId: l });
      },
    },
    {
      name: 'product inactive',
      build: async () => {
        const ops = await fixtures.opsUser(t.admin);
        const p = await fixtures.partner(t.admin);
        const l = await fixtures.location(t.admin, p);
        const prod = await fixtures.product(t.admin, ops, { lifecycle: 'Inactive' });
        return fixtures.offer(t.admin, { productId: prod, partnerId: p, locationId: l });
      },
    },
    {
      name: 'offer inactive',
      build: async () => (await fixtures.catalogue(t.admin, { offer_status: 'Inactive' })).offer,
    },
    {
      name: 'offer out of stock',
      build: async () =>
        (await fixtures.catalogue(t.admin, { availability: 'Out of Stock', stock_qty: 0 })).offer,
    },
    {
      name: 'out of stock flag set manually while units remain',
      build: async () =>
        (await fixtures.catalogue(t.admin, { availability: 'Out of Stock', stock_qty: 4 })).offer,
    },
    {
      name: 'partner not active',
      build: async () => {
        const ops = await fixtures.opsUser(t.admin);
        const p = await fixtures.partner(t.admin, { status: 'Under Review' });
        const l = await fixtures.location(t.admin, p);
        const prod = await fixtures.product(t.admin, ops);
        return fixtures.offer(t.admin, { productId: prod, partnerId: p, locationId: l });
      },
    },
  ];

  it.each(exclusions)('excludes: $name', async ({ build }) => {
    expect(await isEligible(await build())).toBe(false);
  });

  it('turns an offer ineligible the moment its partner is deactivated', async () => {
    const c = await fixtures.catalogue(t.admin);
    expect(await isEligible(c.offer)).toBe(true);
    await t.admin
      .updateTable('catalogue.partner')
      .set({ status: 'Inactive' })
      .where('id', '=', c.partner)
      .execute();
    expect(await isEligible(c.offer)).toBe(false);
  });

  it('will not store stock that contradicts availability', async () => {
    const ops = await fixtures.opsUser(t.admin);
    const p = await fixtures.partner(t.admin);
    const l = await fixtures.location(t.admin, p);
    const prod = await fixtures.product(t.admin, ops);
    await expectPgError(
      fixtures.offer(
        t.admin,
        { productId: prod, partnerId: p, locationId: l },
        { stock_qty: 0, availability: 'In Stock' },
      ),
      { constraint: 'seller_offer_stock_ck' },
    );
  });

  it('will not mark a product Verified without the data scoring needs (AID-DATA-014)', async () => {
    const ops = await fixtures.opsUser(t.admin);
    await expectPgError(fixtures.product(t.admin, ops, { width_cm: null }), {
      constraint: 'product_verified_complete_ck',
    });
  });

  it('keeps an offer in the location of its own partner', async () => {
    const ops = await fixtures.opsUser(t.admin);
    const a = await fixtures.partner(t.admin);
    const b = await fixtures.partner(t.admin);
    const locOfB = await fixtures.location(t.admin, b);
    const prod = await fixtures.product(t.admin, ops);
    await expectPgError(
      fixtures.offer(t.admin, { productId: prod, partnerId: a, locationId: locOfB }),
      {
        constraint: 'seller_offer_location_fk',
      },
    );
  });
});
