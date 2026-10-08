import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { enqueue } from '@aidooi/db';
import { HookedGateway } from './support/hooked-gateway.ts';
import { startHarness, type Harness } from './support/harness.ts';
import {
  api,
  auditTrail,
  bookViewing,
  depositRow,
  key,
  ledger,
  runJobs,
  visit,
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

async function completedViewing() {
  const booked = await bookViewing(h);
  await visit(h, booked, 'Completed');
  await h.admin
    .updateTable('catalogue.seller_offer')
    .set({ availability: 'In Stock', stock_qty: 50 })
    .where(
      'id',
      'in',
      booked.composition.items.map((i) => i.offerId),
    )
    .execute();
  const deposit = await depositRow(h, booked.viewing.id);
  return { booked, deposit: Number(deposit.amount_fils) };
}

describe('GATE: a viewing deposit is credited in full when the buyer purchases', () => {
  it('reduces what is charged, consumes the deposit once, and the books balance', async () => {
    const { booked, deposit } = await completedViewing();
    const total = booked.composition.items.reduce((t, i) => t + i.unitPrice * i.quantity, 0);
    expect(deposit).toBeLessThan(total);

    const started = await api(
      h,
      'POST',
      '/v1/checkout',
      booked.buyerActor,
      {
        source: { kind: 'composition', compositionId: booked.composition.compositionId },
        viewingRequestId: booked.viewing.id,
      },
      key(),
    );
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(started.body).toMatchObject({
      state: 'Ready to Pay',
      total,
      depositCredit: deposit,
      payable: total - deposit,
    });

    const paid = await api(
      h,
      'POST',
      `/v1/checkout/${started.body.id}/pay`,
      booked.buyerActor,
      { paymentToken: 'tok_ok', delivery },
      key(),
    );
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({
      status: 'paid',
      paid: total - deposit,
      depositCredit: deposit,
    });

    const order = await h.admin
      .selectFrom('commerce.master_order')
      .selectAll()
      .where('id', '=', paid.body.orderId)
      .executeTakeFirstOrThrow();
    expect(order).toMatchObject({
      gross_fils: total,
      deposit_credit_fils: deposit,
      paid_fils: total - deposit,
      viewing_request_id: booked.viewing.id,
    });
    const pay = await h.admin
      .selectFrom('commerce.payment')
      .select('amount_fils')
      .where('id', '=', order.payment_id!)
      .executeTakeFirstOrThrow();
    expect(Number(pay.amount_fils)).toBe(total - deposit);

    const dep = await depositRow(h, booked.viewing.id);
    expect(dep.state).toBe('Credited');
    expect(Number(dep.credited_fils)).toBe(deposit);

    // Cash in = card for the viewing + card for the order; liabilities settle: deposits_held nets to zero.
    const lg = await ledger(h);
    expect(lg.unbalanced).toEqual([]);
    expect(
      lg
        .forRef(order.id)
        .map((e) => `${e.account}:${e.direction}:${e.amount_fils}`)
        .sort(),
    ).toEqual(
      [
        `psp_clearing:debit:${total - deposit}`,
        `deposits_held:debit:${deposit}`,
        `sales_collected:credit:${total}`,
      ].sort(),
    );
    const attribution = await h.admin
      .selectFrom('viewing.attribution_event')
      .select('stage')
      .where('viewing_request_id', '=', booked.viewing.id)
      .execute();
    expect(attribution.map((a) => a.stage)).toContain('Purchased');
    expect(await auditTrail(h, 'master_order', order.id)).toEqual(['∅→Confirmed']);

    // The credit is single-use: a second checkout for the same viewing gets none.
    const second = await api(
      h,
      'POST',
      '/v1/checkout',
      booked.buyerActor,
      {
        source: { kind: 'composition', compositionId: booked.composition.compositionId },
        viewingRequestId: booked.viewing.id,
      },
      key(),
    );
    expect(second.body.depositCredit).toBe(0);
  });

  it('a viewing that was not completed earns no credit, and another customer cannot claim it', async () => {
    const booked = await bookViewing(h);
    const early = await api(
      h,
      'POST',
      '/v1/checkout',
      booked.buyerActor,
      {
        source: { kind: 'composition', compositionId: booked.composition.compositionId },
        viewingRequestId: booked.viewing.id,
      },
      key(),
    );
    expect(early.body.depositCredit).toBe(0);
    await visit(h, booked, 'Completed');
    const other = await h.admin
      .insertInto('identity.customer')
      .values({ phone_e164: '+971509990001', full_name: 'Other' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const stolen = await api(
      h,
      'POST',
      '/v1/checkout',
      { kind: 'buyer', customerId: other.id, guestSessionId: null },
      {
        source: {
          kind: 'lines',
          lines: [
            {
              offerId: booked.composition.items[0]!.offerId,
              quantity: 1,
              expectedUnitPrice: booked.composition.items[0]!.unitPrice,
            },
          ],
        },
        viewingRequestId: booked.viewing.id,
      },
      key(),
    );
    expect(stolen.body.depositCredit).toBe(0);
  });

  it('an order smaller than the deposit is covered entirely; the excess goes back to the buyer', async () => {
    const { booked, deposit } = await completedViewing();
    const heldBefore = (await ledger(h)).balance('deposits_held');
    const cheapest = [...booked.composition.items].sort(
      (a, b) => a.unitPrice * a.quantity - b.unitPrice * b.quantity,
    )[0]!;
    const price = cheapest.unitPrice * cheapest.quantity;
    expect(price, 'fixture must be cheaper than the deposit').toBeLessThan(deposit);

    const started = await api(
      h,
      'POST',
      '/v1/checkout',
      booked.buyerActor,
      {
        source: {
          kind: 'lines',
          lines: [
            {
              offerId: cheapest.offerId,
              quantity: cheapest.quantity,
              expectedUnitPrice: cheapest.unitPrice,
            },
          ],
        },
        viewingRequestId: booked.viewing.id,
      },
      key(),
    );
    expect(started.body).toMatchObject({ total: price, depositCredit: price, payable: 0 });

    const authsBefore = gw.calls.filter((c) => c.op === 'authorize').length;
    const paid = await api(
      h,
      'POST',
      `/v1/checkout/${started.body.id}/pay`,
      booked.buyerActor,
      { paymentToken: 'tok_ok', delivery },
      key(),
    );
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ status: 'paid', paid: 0, depositCredit: price });
    expect(gw.calls.filter((c) => c.op === 'authorize').length).toBe(authsBefore); // no card was charged

    const order = await h.admin
      .selectFrom('commerce.master_order')
      .selectAll()
      .where('id', '=', paid.body.orderId)
      .executeTakeFirstOrThrow();
    expect(order.payment_id).toBeNull();
    expect(Number(order.paid_fils)).toBe(0);

    const dep = await depositRow(h, booked.viewing.id);
    expect(dep.state).toBe('Credited');
    expect(Number(dep.credited_fils)).toBe(price);

    // The excess deposit is refunded to the card that paid it.
    const refunds0 = gw.calls.filter((c) => c.op === 'refund').length;
    await enqueue(h.admin, 'viewing.process_refund', {});
    await runJobs(h, 'viewing.process_refund');
    const lg = await ledger(h);
    expect(lg.unbalanced).toEqual([]);
    expect(gw.calls.filter((c) => c.op === 'refund').length).toBeGreaterThanOrEqual(refunds0);
    // Everything this buyer deposited is now credited to the order or returned: the liability it created is gone.
    expect(lg.balance('deposits_held') - heldBefore).toBe(deposit);
  });
});
