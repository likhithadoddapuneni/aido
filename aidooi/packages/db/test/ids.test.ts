import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, fixtures, type TestDatabase } from '../src/testing/index.ts';
import { expectPgError } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

describe('business identifiers (AID-DATA-005)', () => {
  it('assigns zero-padded, increasing AIP / AID / AIO ids', async () => {
    const a = await fixtures.catalogue(t.admin);
    const b = await fixtures.catalogue(t.admin);
    expect(a.product).toMatch(/^AID-\d{8}$/);
    expect(a.offer).toMatch(/^AIO-\d{8}$/);
    expect(Number(b.product.slice(4))).toBeGreaterThan(Number(a.product.slice(4)));
    const parent = await t.admin
      .selectFrom('catalogue.product')
      .select('parent_id')
      .where('id', '=', a.product)
      .executeTakeFirstOrThrow();
    expect(parent.parent_id).toMatch(/^AIP-\d{8}$/);
  });

  it('rejects a malformed explicit id', async () => {
    const parent = await t.admin
      .insertInto('catalogue.parent_product')
      .values({ model_name: 'm' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expectPgError(
      t.admin
        .insertInto('catalogue.product')
        .values({
          id: 'AID-1',
          parent_id: parent.id,
          name: 'x',
          main_category: 'a',
          category: 'b',
          product_type: 'Sofa',
        })
        .execute(),
      { constraint: 'product_id_ck' },
    );
  });

  it('never lets an id change', async () => {
    const c = await fixtures.catalogue(t.admin);
    await expectPgError(
      t.admin
        .updateTable('catalogue.product')
        .set({ id: 'AID-99999999' })
        .where('id', '=', c.product)
        .execute(),
      { message: /column "id" is write-once/ },
    );
    await expectPgError(
      t.admin
        .updateTable('catalogue.seller_offer')
        .set({ product_id: c.product, partner_id: await fixtures.partner(t.admin) })
        .where('id', '=', c.offer)
        .execute(),
      { message: /write-once/ },
    );
  });

  it('never deletes catalogue records, so ids cannot be reused', async () => {
    const c = await fixtures.catalogue(t.admin);
    await expectPgError(
      t.admin.deleteFrom('catalogue.seller_offer').where('id', '=', c.offer).execute(),
      {
        message: /never deleted/,
      },
    );
    await expectPgError(
      t.admin.deleteFrom('catalogue.product').where('id', '=', c.product).execute(),
      {
        message: /never deleted/,
      },
    );
  });

  it('does not reuse an id after a rolled-back insert', async () => {
    const c = await fixtures.catalogue(t.admin);
    await t.admin
      .transaction()
      .execute(async (trx) => {
        await fixtures.offer(trx, {
          productId: c.product,
          partnerId: c.partner,
          locationId: c.location,
        });
        throw new Error('abort');
      })
      .catch(() => undefined);
    const next = await fixtures.catalogue(t.admin);
    const used = Number(c.offer.slice(4));
    expect(Number(next.offer.slice(4))).toBeGreaterThan(used + 1);
  });
});
