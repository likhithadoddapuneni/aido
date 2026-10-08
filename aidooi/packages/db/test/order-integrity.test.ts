import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, fixtures, type TestDatabase } from '../src/testing/index.ts';
import { expectPgError } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

describe('transaction snapshot (AID-LOG-014 §7)', () => {
  it.each([
    ['unit_price_fils', { unit_price_fils: 1 }],
    ['quantity', { quantity: 3 }],
    ['gross_line_fils', { gross_line_fils: 1 }],
    ['commission_rate', { commission_rate: 0.01 }],
    ['commission_fils', { commission_fils: 1 }],
    ['partner_id', { partner_id: randomUUID() }],
    ['offer_id', { offer_id: 'AIO-00000001' }],
    ['snapshot', { snapshot: { productId: 'x' } }],
  ] as const)('refuses to rewrite %s', async (column, patch) => {
    const g = await fixtures.orderGraph(t.admin);
    await expectPgError(
      t.admin
        .updateTable('fulfilment.order_line')
        .set(patch)
        .where('id', '=', g.orderLine)
        .execute(),
      { message: new RegExp(`column "${column}" is write-once`) },
    );
  });

  it('still lets fulfilment progress', async () => {
    const g = await fixtures.orderGraph(t.admin);
    await t.admin
      .updateTable('fulfilment.order_line')
      .set({ state: 'Preparing' })
      .where('id', '=', g.orderLine)
      .execute();
  });

  it('is unaffected by later catalogue price changes', async () => {
    const g = await fixtures.orderGraph(t.admin, { priceFils: 100_000 });
    await t.admin
      .updateTable('catalogue.seller_offer')
      .set({ selling_price_fils: 999_999 })
      .where('id', '=', g.offer)
      .execute();
    const line = await t.admin
      .selectFrom('fulfilment.order_line')
      .select(['unit_price_fils', 'snapshot'])
      .where('id', '=', g.orderLine)
      .executeTakeFirstOrThrow();
    expect(line.unit_price_fils).toBe(100_000);
    expect(line.snapshot).toMatchObject({ unitPriceFils: 100_000 });
  });

  it('cannot be deleted', async () => {
    const g = await fixtures.orderGraph(t.admin);
    await expectPgError(
      t.admin.deleteFrom('fulfilment.order_line').where('id', '=', g.orderLine).execute(),
      {
        message: /never deleted/,
      },
    );
  });

  it('must agree with its own columns', async () => {
    const g = await fixtures.orderGraph(t.admin);
    const base = {
      master_order_id: g.masterOrder,
      seller_order_id: g.sellerOrder,
      partner_id: g.partner,
      customer_id: g.customer,
      product_id: g.product,
      offer_id: g.offer,
      quantity: 1,
      unit_price_fils: 1000,
      gross_line_fils: 1000,
      commission_rate: 0.1,
      commission_fils: 100,
      snapshot: { productId: g.product, offerId: g.offer, quantity: 1, unitPriceFils: 1000 },
    };
    const insert = (over: Partial<typeof base>) =>
      t.admin
        .insertInto('fulfilment.order_line')
        .values({ ...base, ...over })
        .execute();

    await expectPgError(insert({ gross_line_fils: 999 }), { constraint: 'order_line_gross_ck' });
    await expectPgError(insert({ commission_fils: 101 }), {
      constraint: 'order_line_commission_ck',
    });
    await expectPgError(insert({ snapshot: { ...base.snapshot, unitPriceFils: 5 } }), {
      constraint: 'order_line_snapshot_ck',
    });
    await expectPgError(insert({ snapshot: { ...base.snapshot, offerId: 'AIO-00000000' } }), {
      constraint: 'order_line_snapshot_ck',
    });
  });

  it('rounds commission half-up to the fils, in integers', async () => {
    const g = await fixtures.orderGraph(t.admin);
    const row = (gross: number, rate: number, commission: number) => ({
      master_order_id: g.masterOrder,
      seller_order_id: g.sellerOrder,
      partner_id: g.partner,
      customer_id: g.customer,
      product_id: g.product,
      offer_id: g.offer,
      quantity: 1,
      unit_price_fils: gross,
      gross_line_fils: gross,
      commission_rate: rate,
      commission_fils: commission,
      snapshot: { productId: g.product, offerId: g.offer, quantity: 1, unitPriceFils: gross },
    });
    // 10 fils × 12.5% = 1.25 → 1;  30 fils × 12.5% = 3.75 → 4;  4 fils × 12.5% = 0.5 → 1 (half-up)
    await t.admin
      .insertInto('fulfilment.order_line')
      .values(row(10, 0.125, 1))
      .execute();
    await t.admin
      .insertInto('fulfilment.order_line')
      .values(row(30, 0.125, 4))
      .execute();
    await t.admin
      .insertInto('fulfilment.order_line')
      .values(row(4, 0.125, 1))
      .execute();
    await expectPgError(
      t.admin
        .insertInto('fulfilment.order_line')
        .values(row(30, 0.125, 3))
        .execute(),
      {
        constraint: 'order_line_commission_ck',
      },
    );
  });

  it('keeps a line inside its seller order and its own offer (no cross-seller lines)', async () => {
    const g = await fixtures.orderGraph(t.admin);
    const other = await fixtures.catalogue(t.admin);
    await expectPgError(
      t.admin
        .insertInto('fulfilment.order_line')
        .values({
          master_order_id: g.masterOrder,
          seller_order_id: g.sellerOrder,
          partner_id: g.partner,
          customer_id: g.customer,
          product_id: other.product,
          offer_id: other.offer,
          quantity: 1,
          unit_price_fils: 1000,
          gross_line_fils: 1000,
          commission_rate: 0,
          commission_fils: 0,
          snapshot: {
            productId: other.product,
            offerId: other.offer,
            quantity: 1,
            unitPriceFils: 1000,
          },
        })
        .execute(),
      { constraint: 'order_line_offer_fk' },
    );
  });

  it('allows settlement eligibility only for confirmed receipts', async () => {
    const g = await fixtures.orderGraph(t.admin);
    await expectPgError(
      t.admin
        .updateTable('fulfilment.order_line')
        .set({ settlement_state: 'Eligible' })
        .where('id', '=', g.orderLine)
        .execute(),
      { constraint: 'order_line_settlement_eligibility_ck' },
    );
  });
});

describe('payment gates (AID-LOG-014 §3)', () => {
  it('will not record success before every seller validation', async () => {
    const cat = await fixtures.catalogue(t.admin);
    const cust = await fixtures.customer(t.admin);
    const { purchaseRequestId } = await fixtures.reservation(t.admin, {
      customerId: cust,
      offerId: cat.offer,
      priceFils: 350_000,
      validated: false,
    });
    const pay = await t.admin
      .insertInto('commerce.payment')
      .values({
        purpose: 'Order',
        customer_id: cust,
        purchase_request_id: purchaseRequestId,
        amount_fils: 350_000,
        idempotency_key: randomUUID(),
        state: 'Authorized',
        authorized_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expectPgError(
      t.admin
        .updateTable('commerce.payment')
        .set({ state: 'Successful', captured_at: new Date() })
        .where('id', '=', pay.id)
        .execute(),
      { message: /not fully validated/ },
    );
    await t.admin
      .updateTable('commerce.purchase_request')
      .set({ validation_state: 'Validated' })
      .where('id', '=', purchaseRequestId)
      .execute();
    await t.admin
      .updateTable('commerce.payment')
      .set({ state: 'Successful', captured_at: new Date() })
      .where('id', '=', pay.id)
      .execute();
  });

  it('will not create an order against a payment that is not successful', async () => {
    const cat = await fixtures.catalogue(t.admin);
    const cust = await fixtures.customer(t.admin);
    const { purchaseRequestId } = await fixtures.reservation(t.admin, {
      customerId: cust,
      offerId: cat.offer,
      priceFils: 350_000,
    });
    const pay = await t.admin
      .insertInto('commerce.payment')
      .values({
        purpose: 'Order',
        customer_id: cust,
        purchase_request_id: purchaseRequestId,
        amount_fils: 350_000,
        idempotency_key: randomUUID(),
        state: 'Authorized',
        authorized_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const order = {
      customer_id: cust,
      payment_id: pay.id,
      purchase_request_id: purchaseRequestId,
      gross_fils: 350_000,
      paid_fils: 350_000,
    };
    await expectPgError(t.admin.insertInto('commerce.master_order').values(order).execute(), {
      message: /requires a successful payment/,
    });
  });

  it('will not create an order whose payment is for a different amount', async () => {
    const cust = await fixtures.customer(t.admin);
    const pr = await t.admin
      .insertInto('commerce.purchase_request')
      .values({ customer_id: cust, total_fils: 1000, validation_state: 'Validated' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const pay = await t.admin
      .insertInto('commerce.payment')
      .values({
        purpose: 'Order',
        customer_id: cust,
        purchase_request_id: pr.id,
        amount_fils: 1000,
        idempotency_key: randomUUID(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.admin
      .updateTable('commerce.payment')
      .set({ state: 'Authorized', authorized_at: new Date() })
      .where('id', '=', pay.id)
      .execute();
    await t.admin
      .updateTable('commerce.payment')
      .set({ state: 'Successful', captured_at: new Date() })
      .where('id', '=', pay.id)
      .execute();
    await expectPgError(
      t.admin
        .insertInto('commerce.master_order')
        .values({
          customer_id: cust,
          payment_id: pay.id,
          purchase_request_id: pr.id,
          gross_fils: 2000,
          paid_fils: 2000,
        })
        .execute(),
      { message: /requires a successful payment/ },
    );
  });

  it('lets a viewing-deposit credit cover the whole order with no payment, and only then', async () => {
    const cust = await fixtures.customer(t.admin);
    const pr = await t.admin
      .insertInto('commerce.purchase_request')
      .values({ customer_id: cust, total_fils: 5000, validation_state: 'Validated' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expectPgError(
      t.admin
        .insertInto('commerce.master_order')
        .values({
          customer_id: cust,
          purchase_request_id: pr.id,
          gross_fils: 5000,
          paid_fils: 5000,
        })
        .execute(),
      { constraint: 'master_order_payment_ck' },
    );
  });

  it('keeps orders immutable', async () => {
    const g = await fixtures.orderGraph(t.admin);
    await expectPgError(
      t.admin
        .updateTable('commerce.master_order')
        .set({ gross_fils: 1 })
        .where('id', '=', g.masterOrder)
        .execute(),
      { message: /append-only/ },
    );
  });

  it('refuses refunds beyond the amount paid', async () => {
    const g = await fixtures.orderGraph(t.admin, { priceFils: 10_000 });
    await t.admin
      .insertInto('commerce.refund')
      .values({ payment_id: g.payment, amount_fils: 6_000, reason: 'damaged' })
      .execute();
    await expectPgError(
      t.admin
        .insertInto('commerce.refund')
        .values({ payment_id: g.payment, amount_fils: 4_001, reason: 'damaged' })
        .execute(),
      { message: /exceed payment amount/ },
    );
    await t.admin
      .insertInto('commerce.refund')
      .values({ payment_id: g.payment, amount_fils: 4_000, reason: 'damaged' })
      .execute();
  });

  it('records a provider webhook once', async () => {
    const g = await fixtures.orderGraph(t.admin);
    const event = {
      payment_id: g.payment,
      kind: 'capture',
      outcome: 'Succeeded',
      provider_event_id: 'evt_1',
    };
    await t.admin.insertInto('commerce.payment_attempt').values(event).execute();
    await expectPgError(t.admin.insertInto('commerce.payment_attempt').values(event).execute(), {
      constraint: 'payment_attempt_event_uq',
    });
  });

  it('refuses a duplicate idempotency key', async () => {
    const g = await fixtures.orderGraph(t.admin);
    const row = await t.admin
      .selectFrom('commerce.payment')
      .select(['idempotency_key', 'customer_id'])
      .where('id', '=', g.payment)
      .executeTakeFirstOrThrow();
    const pr = await t.admin
      .insertInto('commerce.purchase_request')
      .values({ customer_id: row.customer_id, total_fils: 1000 })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expectPgError(
      t.admin
        .insertInto('commerce.payment')
        .values({
          purpose: 'Order',
          customer_id: row.customer_id,
          purchase_request_id: pr.id,
          amount_fils: 1000,
          idempotency_key: row.idempotency_key,
        })
        .execute(),
      { constraint: 'payment_idempotency_uq' },
    );
  });
});
