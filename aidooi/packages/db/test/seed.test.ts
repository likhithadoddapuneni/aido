import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seedDatabase, type TestDatabase } from '../src/testing/index.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

describe('seed', () => {
  it('loads the whole seed catalogue, and later inserts do not collide with its ids', async () => {
    const seeded = await seedDatabase(t.admin);
    const { n } = await t.admin
      .selectFrom('catalogue.eligible_offer')
      .select((e) => e.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(n)).toBeGreaterThan(500);
    expect(seeded.partners.size).toBe(6);
    const next = await t.admin
      .insertInto('catalogue.parent_product')
      .values({ model_name: 'After seed' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const existing = await t.admin
      .selectFrom('catalogue.parent_product')
      .select('id')
      .where('id', '=', next.id)
      .execute();
    expect(existing).toHaveLength(1);
  });
});
