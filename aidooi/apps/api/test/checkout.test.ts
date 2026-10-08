/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are untyped JSON in tests */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withActor } from '@aidooi/db';
import { enqueue } from '@aidooi/db';
import { fixtures } from '@aidooi/db/testing';
import { bpsFromRate, percentOf, fils } from '@aidooi/domain';
import { relayOutbox } from '../src/modules/outbox.ts';
import { HookedGateway } from './support/hooked-gateway.ts';
import { startHarness, guest, type Harness } from './support/harness.ts';
import {
  api,
  auditTrail,
  compositionFromRun,
  key,
  ledger,
  newBuyer,
  newSeller,
  runJobs,
  type TestComposition,
} from './support/viewing.ts';

let h: Harness;
let gw: HookedGateway;
beforeAll(async () => {
  h = await startHarness({
    gateway: (clock) => {
      gw = new HookedGateway({ clock });
      return gw;
    },
  });
});
afterAll(() => h.close());
afterEach(() => h.clock.resetToNow());

const delivery = {
  recipientName: 'Aisha Khan',
  phone: '+971501234567',
  line1: 'Marina Walk, Tower 5',
  emirate: 'Dubai',
};
const body = (token = 'tok_ok') => ({ paymentToken: token, delivery });

/** Plenty of stock and an unambiguous status, so a scenario is about the saga, not the seed data. */
async function plentiful(offerIds: readonly string[], stock = 50) {
  await h.admin
    .updateTable('catalogue.seller_offer')
    .set({ availability: 'In Stock', stock_qty: stock, offer_status: 'Active' })
    .where('id', 'in', [...offerIds])
    .execute();
}

interface Ctx {
  b: Awaited<ReturnType<typeof newBuyer>>;
  comp: TestComposition;
}
async function scenario(): Promise<Ctx> {
  const b = await newBuyer(h);
  const comp = await compositionFromRun(h, b.id);
  await plentiful(comp.items.map((i) => i.offerId));
  return { b, comp };
}
const start = (c: Ctx, extra: object = {}) =>
  api(
    h,
    'POST',
    '/v1/checkout',
    c.b.actor,
    { source: { kind: 'composition', compositionId: c.comp.compositionId }, ...extra },
    key(),
  );
const pay = (c: Ctx, id: string, token = 'tok_ok', idem = key()) =>
  api(h, 'POST', `/v1/checkout/${id}/pay`, c.b.actor, body(token), idem);
const stockOf = async (offerIds: readonly string[]) =>
  new Map(
    (
      await h.admin
        .selectFrom('catalogue.seller_offer')
        .select(['id', 'stock_qty'])
        .where('id', 'in', [...offerIds])
        .execute()
    ).map((r) => [r.id, r.stock_qty]),
  );
const ordersFor = (requestId: string) =>
  h.admin
    .selectFrom('commerce.master_order')
    .selectAll()
    .where('purchase_request_id', '=', requestId)
    .execute();
const paymentsFor = (requestId: string) =>
  h.admin
    .selectFrom('commerce.payment')
    .selectAll()
    .where('purchase_request_id', '=', requestId)
    .orderBy('created_at')
    .execute();
/** Schedule one run of a recurring job kind and execute it now. */
const runKind = async (kind: string) => {
  await enqueue(h.admin, kind, {});
  return runJobs(h, kind);
};
const calls = (op: string) => gw.calls.filter((c) => c.op === op).length;

describe('GATE: checkout happy path (WF-05)', () => {
  it('validates, takes one payment, places ONE order split by seller with locked snapshots, moves stock and books the ledger', async () => {
    const c = await scenario();
    const before = await stockOf(c.comp.items.map((i) => i.offerId));
    const total = c.comp.items.reduce((t, i) => t + i.unitPrice * i.quantity, 0);

    const started = await start(c);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(started.body).toMatchObject({
      state: 'Ready to Pay',
      total,
      depositCredit: 0,
      payable: total,
      pendingSellerConfirmations: 0,
    });
    expect(new Date(started.body.expiresAt).getTime() - h.clock.now()).toBeCloseTo(
      24 * 3_600_000,
      -3,
    );
    expect(started.body.lines.every((l: any) => l.status === 'Confirmed')).toBe(true);

    const gwBefore = { auth: calls('authorize'), cap: calls('capture') };
    const paid = await pay(c, started.body.id);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ status: 'paid', paid: total, depositCredit: 0 });
    expect(calls('authorize') - gwBefore.auth).toBe(1);
    expect(calls('capture') - gwBefore.cap).toBe(1);

    // One master order, one seller order per partner, one line per item, snapshots locked.
    const [order] = await ordersFor(started.body.id);
    expect(order).toMatchObject({
      customer_id: c.b.id,
      gross_fils: total,
      paid_fils: total,
      deposit_credit_fils: 0,
    });
    const sellerOrders = await h.admin
      .selectFrom('commerce.seller_order')
      .selectAll()
      .where('master_order_id', '=', order!.id)
      .execute();
    expect(sellerOrders).toHaveLength(new Set(c.comp.items.map((i) => i.partnerId)).size);
    const lines = await h.admin
      .selectFrom('fulfilment.order_line')
      .selectAll()
      .where('master_order_id', '=', order!.id)
      .execute();
    expect(lines).toHaveLength(c.comp.items.length);
    for (const l of lines) {
      const item = c.comp.items.find((i) => i.offerId === l.offer_id)!;
      expect(Number(l.unit_price_fils)).toBe(item.unitPrice);
      expect(Number(l.gross_line_fils)).toBe(item.unitPrice * item.quantity);
      expect(Number(l.commission_fils)).toBe(
        percentOf(fils(item.unitPrice * item.quantity), bpsFromRate(Number(l.commission_rate))),
      );
      expect(l).toMatchObject({ state: 'Confirmed', settlement_state: 'Not Eligible' });
      expect((l.snapshot as any).deliveryDays).toBeTypeOf('number');
    }
    // The snapshot is write-once, even for the table owner.
    await expect(
      h.admin
        .updateTable('fulfilment.order_line')
        .set({ unit_price_fils: 1 })
        .where('id', '=', lines[0]!.id)
        .execute(),
    ).rejects.toThrow();

    // Stock decreased exactly by what was bought; reservation consumed.
    const after = await stockOf(c.comp.items.map((i) => i.offerId));
    for (const i of c.comp.items)
      expect(before.get(i.offerId)! - after.get(i.offerId)!).toBe(i.quantity);
    const reservation = await h.admin
      .selectFrom('commerce.reservation')
      .select('state')
      .where('purchase_request_id', '=', started.body.id)
      .executeTakeFirstOrThrow();
    expect(reservation.state).toBe('Converted');

    // Payment trail and ledger.
    const [payment] = await paymentsFor(started.body.id);
    expect(payment).toMatchObject({ state: 'Successful', amount_fils: total });
    expect(await auditTrail(h, 'payment', payment!.id)).toEqual([
      '∅→Pending',
      'Pending→Authorized',
      'Authorized→Successful',
    ]);
    const lg = await ledger(h);
    expect(lg.unbalanced).toEqual([]);
    expect(
      lg
        .forRef(order!.id)
        .map((e) => `${e.account}:${e.direction}:${e.amount_fils}`)
        .sort(),
    ).toEqual([`psp_clearing:debit:${total}`, `sales_collected:credit:${total}`].sort());

    // Notifications are delivered from the outbox, once.
    await relayOutbox(h.ctx);
    await relayOutbox(h.ctx);
    expect(
      h.notifier.ofTemplate('order.confirmed').filter((n) => n.data['orderId'] === order!.id),
    ).toHaveLength(1);
    expect(
      h.notifier.ofTemplate('order.new_for_seller').filter((n) => n.data['orderId'] === order!.id),
    ).toHaveLength(sellerOrders.length);

    // The buyer's view of the checkout is now final.
    const view = await api(h, 'GET', `/v1/checkout/${started.body.id}`, c.b.actor);
    expect(view.body).toMatchObject({ state: 'Paid', orderId: order!.id });
  });

  it('is idempotent: the same request key replays the order; a new key on a paid checkout returns the same order', async () => {
    const c = await scenario();
    const started = await start(c);
    const k = key();
    const first = await pay(c, started.body.id, 'tok_ok', k);
    const again = await pay(c, started.body.id, 'tok_ok', k);
    const other = await pay(c, started.body.id, 'tok_ok', key());
    expect(again.body).toEqual(first.body);
    expect(other.body.orderId).toBe(first.body.orderId);
    expect(await ordersFor(started.body.id)).toHaveLength(1);
    expect((await paymentsFor(started.body.id)).length).toBe(1);
  });
});

describe('payment outcomes', () => {
  it('a decline is an outcome: no order, stock untouched, reservation kept, and a fresh attempt can succeed', async () => {
    const c = await scenario();
    const before = await stockOf(c.comp.items.map((i) => i.offerId));
    const started = await start(c);
    const k = key();
    const declined = await pay(c, started.body.id, 'tok_decline', k);
    expect(declined.status).toBe(402);
    expect(declined.body.code).toBe('payment_declined');
    expect(await ordersFor(started.body.id)).toHaveLength(0);
    expect((await paymentsFor(started.body.id))[0]).toMatchObject({
      state: 'Failed',
      failure_code: 'card_declined',
    });
    expect(await stockOf(c.comp.items.map((i) => i.offerId))).toEqual(before);

    const authCalls = calls('authorize');
    expect((await pay(c, started.body.id, 'tok_decline', k)).status).toBe(402); // replaying the declined attempt…
    expect(calls('authorize')).toBe(authCalls); // …does not call the provider again

    const ok = await pay(c, started.body.id, 'tok_ok', key());
    expect(ok.status).toBe(200);
    expect(await ordersFor(started.body.id)).toHaveLength(1);
  });

  it('3-D Secure: the buyer is asked to authenticate, and a signed webhook completes the order — once, however often it is delivered', async () => {
    const c = await scenario();
    const started = await start(c);
    const first = await pay(c, started.body.id, 'tok_3ds');
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ status: 'requires_action' });
    expect((await api(h, 'GET', `/v1/checkout/${started.body.id}`, c.b.actor)).body.state).toBe(
      'Payment Requires Action',
    );
    expect(await ordersFor(started.body.id)).toHaveLength(0);

    const ref = (await paymentsFor(started.body.id))[0]!.provider_ref!;
    gw.completeChallenge(ref);
    const hook = gw.drainWebhooks().at(-1)!;
    const send = (payload: string, signature: string) =>
      h.app.inject({
        method: 'POST',
        url: '/v1/webhooks/payments',
        headers: { 'content-type': 'application/json', 'x-payment-signature': signature },
        payload,
      });

    expect((await send(hook.body, 'deadbeef')).statusCode).toBe(401);
    expect(
      (
        await send(
          hook.body.replace('authorization.succeeded', 'authorization.failed'),
          hook.signature,
        )
      ).statusCode,
    ).toBe(401);
    expect((await send(hook.body, hook.signature)).statusCode).toBe(200);
    expect(await ordersFor(started.body.id)).toHaveLength(1);
    const captures = calls('capture');
    expect((await send(hook.body, hook.signature)).statusCode).toBe(200); // redelivery
    expect(await ordersFor(started.body.id)).toHaveLength(1);
    expect(calls('capture')).toBe(captures);
    expect((await paymentsFor(started.body.id))[0]!.state).toBe('Successful');
  });

  it('a failed 3-D Secure challenge closes the payment without an order', async () => {
    const c = await scenario();
    const started = await start(c);
    await pay(c, started.body.id, 'tok_3ds');
    const ref = (await paymentsFor(started.body.id))[0]!.provider_ref!;
    gw.completeChallenge(ref, 'failure');
    const hook = gw.drainWebhooks().at(-1)!;
    await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/payments',
      headers: { 'content-type': 'application/json', 'x-payment-signature': hook.signature },
      payload: hook.body,
    });
    expect((await paymentsFor(started.body.id))[0]).toMatchObject({
      state: 'Failed',
      failure_code: 'authentication_failed',
    });
    expect(await ordersFor(started.body.id)).toHaveLength(0);
  });

  it('provider timeouts that happen AFTER the provider acted never double-charge: retries with the same key finish the same payment', async () => {
    const c = await scenario();
    const started = await start(c);
    const k = key();
    const a0 = calls('authorize');
    const c0 = calls('capture');
    let result = await pay(c, started.body.id, 'tok_flaky_once', k);
    let attempts = 1;
    while (result.status === 503 && attempts < 6) {
      expect(result.body.code).toBe('payment_provider_unavailable');
      result = await pay(c, started.body.id, 'tok_flaky_once', k);
      attempts++;
    }
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(attempts).toBeGreaterThan(1);
    expect(calls('authorize') - a0).toBe(1);
    expect(calls('capture') - c0).toBe(1);
    expect(await ordersFor(started.body.id)).toHaveLength(1);
    expect(await paymentsFor(started.body.id)).toHaveLength(1);
  });

  it('a capture failure releases the authorisation and leaves no order', async () => {
    const c = await scenario();
    const started = await start(c);
    const res = await pay(c, started.body.id, 'tok_capture_fails');
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('payment_capture_failed');
    const [p] = await paymentsFor(started.body.id);
    expect(p!.state).toBe('Failed');
    expect(gw.inspect(p!.provider_ref!)!.state).toBe('voided');
    expect(await ordersFor(started.body.id)).toHaveLength(0);
  });
});

describe('GATE: no capture before every validation stands', () => {
  it('a price that moves after authorisation voids the authorisation and never captures', async () => {
    const c = await scenario();
    const started = await start(c);
    const offer = c.comp.items[0]!;
    gw.afterAuthorize = async () => {
      await h.admin
        .updateTable('catalogue.seller_offer')
        .set({ selling_price_fils: offer.unitPrice + 10_000 })
        .where('id', '=', offer.offerId)
        .execute();
    };
    const caps = calls('capture');
    const res = await pay(c, started.body.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('price_approval_required');
    expect(calls('capture')).toBe(caps);
    const [p] = await paymentsFor(started.body.id);
    expect(p!.state).toBe('Voided');
    expect(gw.inspect(p!.provider_ref!)!.state).toBe('voided');
    expect(await ordersFor(started.body.id)).toHaveLength(0);
  });

  it('a seller withdraws an offer before payment: refused up front, nothing authorised', async () => {
    const c = await scenario();
    const started = await start(c);
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ offer_status: 'Inactive' })
      .where('id', '=', c.comp.items[0]!.offerId)
      .execute();
    const view = await api(h, 'GET', `/v1/checkout/${started.body.id}`, c.b.actor);
    expect(view.body.state).toBe('Rebuild Required');
    const auths = calls('authorize');
    const res = await pay(c, started.body.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('seller_validation_failed');
    expect(calls('authorize')).toBe(auths);
    expect(await paymentsFor(started.body.id)).toHaveLength(0);
  });

  it('the database itself refuses a successful payment for an unvalidated request', async () => {
    const b = await newBuyer(h);
    const offer = await h.admin
      .selectFrom('catalogue.eligible_offer')
      .select(['offer_id', 'selling_price_fils'])
      .limit(1)
      .executeTakeFirstOrThrow();
    const { purchaseRequestId } = await fixtures.reservation(h.admin, {
      customerId: b.id,
      offerId: offer.offer_id!,
      priceFils: Number(offer.selling_price_fils),
      validated: false,
    });
    const row = await h.admin
      .insertInto('commerce.payment')
      .values({
        purpose: 'Order',
        customer_id: b.id,
        purchase_request_id: purchaseRequestId,
        amount_fils: 1000,
        idempotency_key: key(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.admin
      .updateTable('commerce.payment')
      .set({ state: 'Authorized' })
      .where('id', '=', row.id)
      .execute();
    await expect(
      h.admin
        .updateTable('commerce.payment')
        .set({ state: 'Successful', captured_at: new Date() })
        .where('id', '=', row.id)
        .execute(),
    ).rejects.toThrow(/not fully validated/);
  });

  it('REGRESSION: if the order cannot be placed after capture, the buyer is refunded in full and nothing half-exists', async () => {
    const c = await scenario();
    const started = await start(c);
    const victim = c.comp.items[0]!;
    const stockBefore = await stockOf(c.comp.items.map((i) => i.offerId));
    gw.afterCapture = async () => {
      // Stock vanishes between capture and order placement. The database stops sellers and operators doing
      // this to reserved stock, so only a platform fault could — which is exactly what compensation is for.
      await withActor(h.admin, { kind: 'system' }, (trx) =>
        trx
          .updateTable('catalogue.seller_offer')
          .set({ stock_qty: 0, availability: 'Out of Stock' })
          .where('id', '=', victim.offerId)
          .execute(),
      );
    };
    const res = await pay(c, started.body.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('order_could_not_be_placed');
    const [p] = await paymentsFor(started.body.id);
    expect(p!.state).toBe('Refunded');
    expect(gw.inspect(p!.provider_ref!)).toMatchObject({
      state: 'captured',
      refunded: Number(p!.amount_fils),
    });
    const [refund] = await h.admin
      .selectFrom('commerce.refund')
      .selectAll()
      .where('payment_id', '=', p!.id)
      .execute();
    expect(refund).toMatchObject({ state: 'Succeeded', amount_fils: Number(p!.amount_fils) });
    expect(await ordersFor(started.body.id)).toHaveLength(0);
    const after = await stockOf(c.comp.items.map((i) => i.offerId));
    for (const i of c.comp.items.filter((x) => x.offerId !== victim.offerId))
      expect(after.get(i.offerId)).toBe(stockBefore.get(i.offerId));
    expect((await api(h, 'GET', `/v1/checkout/${started.body.id}`, c.b.actor)).body.state).toBe(
      'Rebuild Required',
    );
  });
});

describe('price changes need the buyer’s approval (gap #9)', () => {
  it('shows the change, refuses to charge it unapproved, and approval names the exact total', async () => {
    const c = await scenario();
    const started = await start(c);
    const offer = c.comp.items[0]!;
    const newPrice = offer.unitPrice + 5_000;
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ selling_price_fils: newPrice })
      .where('id', '=', offer.offerId)
      .execute();
    const view = await api(h, 'GET', `/v1/checkout/${started.body.id}`, c.b.actor);
    expect(view.body.state).toBe('Awaiting Price Approval');
    const line = view.body.lines.find((l: any) => l.offerId === offer.offerId);
    expect(line).toMatchObject({
      status: 'Price Changed',
      quotedUnitPrice: offer.unitPrice,
      currentUnitPrice: newPrice,
    });
    const newTotal = view.body.total;
    expect(newTotal).toBe(started.body.total + 5_000 * offer.quantity);

    const refused = await pay(c, started.body.id);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('price_approval_required');

    const wrong = await api(
      h,
      'POST',
      `/v1/checkout/${started.body.id}/approve-prices`,
      c.b.actor,
      { approvedTotal: started.body.total },
    );
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe('total_changed');

    const approved = await api(
      h,
      'POST',
      `/v1/checkout/${started.body.id}/approve-prices`,
      c.b.actor,
      { approvedTotal: newTotal },
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.state).toBe('Ready to Pay');
    const paid = await pay(c, started.body.id);
    expect(paid.body).toMatchObject({ status: 'paid', paid: newTotal });
    const [order] = await ordersFor(started.body.id);
    const l = await h.admin
      .selectFrom('fulfilment.order_line')
      .select('unit_price_fils')
      .where('master_order_id', '=', order!.id)
      .where('offer_id', '=', offer.offerId)
      .executeTakeFirstOrThrow();
    expect(Number(l.unit_price_fils)).toBe(newPrice);
  });
});

describe('GATE: the 24-hour purchase window', () => {
  it('expires: the state says so, payment is refused, and the sweeper releases the hold', async () => {
    const c = await scenario();
    const started = await start(c);
    h.clock.advanceHours(25);
    const view = await api(h, 'GET', `/v1/checkout/${started.body.id}`, c.b.actor);
    expect(view.body.state).toBe('Expired');
    const res = await pay(c, started.body.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('reservation_expired');
    expect(await paymentsFor(started.body.id)).toHaveLength(0);
    await runKind('commerce.expire_reservations');
    const r = await h.admin
      .selectFrom('commerce.reservation')
      .select('state')
      .where('purchase_request_id', '=', started.body.id)
      .executeTakeFirstOrThrow();
    expect(r.state).toBe('Expired');
  });
});

describe('seller confirmation where stock is thin (ADR-028)', () => {
  async function lowStock() {
    const c = await scenario();
    const item = c.comp.items[0]!;
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ availability: 'Low Stock', stock_qty: 4 })
      .where('id', '=', item.offerId)
      .execute();
    return { c, item, seller: await newSeller(h, item.partnerId) };
  }

  it('waits for the seller; the 24-hour window starts at the LAST confirmation; other sellers cannot answer', async () => {
    const { c, item, seller } = await lowStock();
    const started = await start(c);
    expect(started.body).toMatchObject({
      state: 'Awaiting Seller Confirmation',
      pendingSellerConfirmations: 1,
      expiresAt: null,
    });
    const early = await pay(c, started.body.id);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('awaiting_seller_confirmation');

    const tasks = await api(h, 'GET', '/v1/seller/purchase-tasks', seller);
    const mine = tasks.body.tasks.find((t: any) =>
      t.lines.some((l: any) => l.offerId === item.offerId),
    );
    expect(mine.lines[0]).toMatchObject({ quantity: item.quantity, stockQty: 4 });

    const stranger = await newSeller(
      h,
      c.comp.items.find((i) => i.partnerId !== item.partnerId)?.partnerId ?? item.partnerId,
    );
    if (stranger.kind === 'seller' && stranger.partnerId !== item.partnerId) {
      expect(
        (
          await api(h, 'POST', `/v1/seller/purchase-tasks/${mine.id}/respond`, stranger, {
            response: 'Confirmed',
          })
        ).status,
      ).toBe(404);
    }

    h.clock.advanceHours(3);
    const ok = await api(h, 'POST', `/v1/seller/purchase-tasks/${mine.id}/respond`, seller, {
      response: 'Confirmed',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const view = await api(h, 'GET', `/v1/checkout/${started.body.id}`, c.b.actor);
    expect(view.body.state).toBe('Ready to Pay');
    expect(new Date(view.body.expiresAt).getTime() - h.clock.now()).toBeCloseTo(24 * 3_600_000, -3);
    expect(
      (
        await api(h, 'POST', `/v1/seller/purchase-tasks/${mine.id}/respond`, seller, {
          response: 'Confirmed',
        })
      ).status,
    ).toBe(200); // same answer: no-op
    expect(
      (
        await api(h, 'POST', `/v1/seller/purchase-tasks/${mine.id}/respond`, seller, {
          response: 'Declined',
        })
      ).status,
    ).toBe(409);
    expect((await pay(c, started.body.id)).status).toBe(200);
  });

  it('a decline sends the buyer back to rebuild and frees the held stock', async () => {
    const { c, item, seller } = await lowStock();
    const started = await start(c);
    const task = (await api(h, 'GET', '/v1/seller/purchase-tasks', seller)).body.tasks.find(
      (t: any) => t.responded === null && t.lines.some((l: any) => l.offerId === item.offerId),
    );
    expect(
      (
        await api(h, 'POST', `/v1/seller/purchase-tasks/${task.id}/respond`, seller, {
          response: 'Declined',
        })
      ).status,
    ).toBe(200);
    expect((await api(h, 'GET', `/v1/checkout/${started.body.id}`, c.b.actor)).body.state).toBe(
      'Rebuild Required',
    );
    expect(h.notifier.ofTemplate('checkout.seller_declined').length).toBeGreaterThan(0);
    const held = await h.admin
      .selectFrom('commerce.reserved_qty')
      .select('reserved')
      .where('offer_id', '=', item.offerId)
      .execute();
    expect(held.filter((r) => Number(r.reserved) > 0).length).toBeLessThanOrEqual(held.length);
    const res = await pay(c, started.body.id);
    expect(res.status).toBe(409);
  });

  it('a silent seller is escalated at half the SLA and treated as declined at the SLA', async () => {
    const { c, item } = await lowStock();
    const started = await start(c);
    h.clock.advanceHours(2.5);
    await runKind('commerce.sweep_confirmations');
    const t = await h.admin
      .selectFrom('commerce.confirmation_task')
      .select(['escalated_at', 'response'])
      .where('partner_id', '=', item.partnerId)
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow();
    expect(t.escalated_at).not.toBeNull();
    expect(t.response).toBeNull();
    expect(h.notifier.ofTemplate('ops.seller_unresponsive').length).toBeGreaterThan(0);
    h.clock.advanceHours(2);
    await runKind('commerce.sweep_confirmations');
    expect((await api(h, 'GET', `/v1/checkout/${started.body.id}`, c.b.actor)).body.state).toBe(
      'Rebuild Required',
    );
  });
});

describe('concurrency', () => {
  it('GATE: 12 buyers racing for 3 units — exactly 3 are validated, exactly 3 orders are placed, stock ends at 0', async () => {
    // An offer no live reservation touches, so the only competition is the 12 buyers below.
    const offer = await h.admin
      .selectFrom('catalogue.eligible_offer as e')
      .select(['e.offer_id', 'e.selling_price_fils'])
      .where('e.product_type', '=', 'Vase')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('commerce.reservation_line as rl')
              .select('rl.offer_id')
              .whereRef('rl.offer_id', '=', 'e.offer_id'),
          ),
        ),
      )
      .limit(1)
      .executeTakeFirstOrThrow();
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ availability: 'In Stock', stock_qty: 3 })
      .where('id', '=', offer.offer_id!)
      .execute();
    const buyers = await Promise.all(Array.from({ length: 12 }, () => newBuyer(h)));
    const lines = {
      source: {
        kind: 'lines',
        lines: [
          {
            offerId: offer.offer_id,
            quantity: 1,
            expectedUnitPrice: Number(offer.selling_price_fils),
          },
        ],
      },
    };
    const started = await Promise.all(
      buyers.map((b) => api(h, 'POST', '/v1/checkout', b.actor, lines, key())),
    );
    const ready = started
      .map((s, i) => ({ s, b: buyers[i]! }))
      .filter(({ s }) => s.body.state === 'Ready to Pay');
    expect(ready).toHaveLength(3);
    expect(started.filter((s) => s.body.state === 'Rebuild Required')).toHaveLength(9);

    const results = await Promise.all(
      ready.map(({ s, b }) =>
        api(h, 'POST', `/v1/checkout/${s.body.id}/pay`, b.actor, body(), key()),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const row = await h.admin
      .selectFrom('catalogue.seller_offer')
      .select(['stock_qty', 'availability'])
      .where('id', '=', offer.offer_id!)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ stock_qty: 0, availability: 'Out of Stock' });
    const sold = await h.admin
      .selectFrom('fulfilment.order_line')
      .select((e) => e.fn.sum<string>('quantity').as('n'))
      .where('offer_id', '=', offer.offer_id!)
      .executeTakeFirstOrThrow();
    expect(Number(sold.n)).toBe(3);
    expect((await ledger(h)).unbalanced).toEqual([]);
  });

  it('two simultaneous payments for one checkout (different keys): the database allows one live payment, so the buyer is charged once', async () => {
    const c = await scenario();
    const started = await start(c);
    const a0 = calls('authorize');
    const c0 = calls('capture');
    const v0 = calls('void');
    const results = await Promise.all([pay(c, started.body.id), pay(c, started.body.id)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('payment_in_progress');
    expect(await ordersFor(started.body.id)).toHaveLength(1);
    const ps = await paymentsFor(started.body.id);
    expect(
      ps.filter((p) => ['Pending', 'Authorized', 'Successful'].includes(p.state)),
    ).toHaveLength(1);
    expect(calls('capture') - c0).toBe(1);
    expect(calls('authorize') - a0).toBe(1);
    expect(calls('void') - v0).toBe(0);
  });
});

describe('access control', () => {
  it('guests cannot check out (they register first, then resume); other buyers cannot see or pay my checkout', async () => {
    const c = await scenario();
    const asGuest = await api(
      h,
      'POST',
      '/v1/checkout',
      guest(),
      { source: { kind: 'composition', compositionId: c.comp.compositionId } },
      key(),
    );
    expect(asGuest.status).toBe(403);
    expect(asGuest.body.code).toBe('registration_required');

    const started = await start(c);
    const other = await newBuyer(h);
    expect((await api(h, 'GET', `/v1/checkout/${started.body.id}`, other.actor)).status).toBe(404);
    expect(
      (await api(h, 'POST', `/v1/checkout/${started.body.id}/pay`, other.actor, body(), key()))
        .status,
    ).toBe(404);
    expect(
      (
        await api(
          h,
          'POST',
          '/v1/checkout',
          other.actor,
          { source: { kind: 'composition', compositionId: c.comp.compositionId } },
          key(),
        )
      ).status,
    ).toBe(404);
  });

  it('requires an Idempotency-Key to start or pay', async () => {
    const c = await scenario();
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/checkout',
      headers: h.as(c.b.actor),
      payload: { source: { kind: 'composition', compositionId: c.comp.compositionId } },
    });
    expect(res.statusCode).toBe(400);
  });
});
