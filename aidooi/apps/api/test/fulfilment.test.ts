import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures } from '@aidooi/db/testing';
import { aed } from '@aidooi/domain';
import { allJobHandlers } from '../src/jobs/registry.ts';
import { runOnce } from '../src/jobs/runner.ts';
import { sweepAutoConfirm } from '../src/modules/fulfilment/service.ts';
import { buyer, guest, ops, seller, startHarness, type Harness } from './support/harness.ts';
import {
  balance,
  confirmDirect,
  createOrder,
  deliver,
  ledgerNetAll,
  lineRow,
} from './support/orders.ts';

let h: Harness;
let p1: string;
let p2: string;
beforeAll(async () => {
  h = await startHarness();
  p1 = h.seeded!.partners.get('PRT-001')!;
  p2 = h.seeded!.partners.get('PRT-002')!;
});
afterAll(() => h.close());

const post = (url: string, actor: Parameters<Harness['as']>[0], payload?: unknown) =>
  h.app.inject({ method: 'POST', url, headers: h.as(actor), payload: payload ?? {} });
const get = (url: string, actor: Parameters<Harness['as']>[0]) =>
  h.app.inject({ method: 'GET', url, headers: h.as(actor) });
const auditOf = (id: string) =>
  h.admin
    .selectFrom('audit.event')
    .select(['from_state', 'to_state', 'actor_type'])
    .where('entity_id', '=', id)
    .orderBy('at')
    .execute();

describe('line lifecycle: seller moves it, buyer sees one order (WF-06)', () => {
  it("walks both sellers' lines to completion; the buyer sees a single grouped order that never names a seller", async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }, { partner: 'PRT-002' }] });
    const [l1, l2] = o.lineIds as [string, string];
    const s1 = seller(p1);
    const s2 = seller(p2);
    const me = buyer(o.customerId);

    let view = await get(`/v1/orders/${o.orderId}`, me);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({
      status: 'Confirmed',
      grossFils: o.grossFils,
      paidFils: o.paidFils,
      payment: { state: 'Successful' },
    });
    expect(view.json().estimatedDeliveryBy).toBeTruthy();

    await deliver(h, s1, l1);
    view = await get(`/v1/orders/${o.orderId}`, me);
    expect(view.json().status).toBe('In Progress');
    expect(view.body).not.toContain(p1);
    expect(view.body).not.toContain(p2);

    const confirm = await post(`/v1/orders/${o.orderId}/lines/${l1}/confirm-receipt`, me);
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json()).toMatchObject({ id: l1, state: 'Receipt Confirmed' });
    const row = await lineRow(h, l1);
    expect(row).toMatchObject({ state: 'Receipt Confirmed', settlement_state: 'Eligible' });
    expect(row.receipt_confirmed_at).not.toBeNull();
    expect((await get(`/v1/orders/${o.orderId}`, me)).json().status).toBe('In Progress');

    await deliver(h, s2, l2);
    await post(`/v1/orders/${o.orderId}/lines/${l2}/confirm-receipt`, me);
    expect((await get(`/v1/orders/${o.orderId}`, me)).json().status).toBe('Completed');

    // Every transition left an audit row, in order, with who did it.
    expect((await auditOf(l1)).map((a) => a.to_state)).toEqual([
      'Preparing',
      'Ready for Dispatch',
      'Dispatched',
      'Delivered',
      'Receipt Confirmed',
    ]);
    expect((await auditOf(l1)).map((a) => a.actor_type)).toEqual([
      'seller_user',
      'seller_user',
      'seller_user',
      'seller_user',
      'customer',
    ]);
    // The buyer was told at each step, after commit.
    expect(
      h.notifier.ofTemplate('fulfilment.line_dispatched').some((n) => n.data['orderLineId'] === l1),
    ).toBe(true);
  });

  it('lists orders newest first with a cursor', async () => {
    const cust = await fixtures.customer(h.admin);
    const a = await createOrder(h, { customerId: cust, lines: [{ partner: 'PRT-001' }] });
    const b = await createOrder(h, { customerId: cust, lines: [{ partner: 'PRT-001' }] });
    const first = await get('/v1/orders?limit=1', buyer(cust));
    expect(first.json().items.map((x: { id: string }) => x.id)).toEqual([b.orderId]);
    const next = await get(`/v1/orders?limit=1&cursor=${first.json().nextCursor}`, buyer(cust));
    expect(next.json().items.map((x: { id: string }) => x.id)).toEqual([a.orderId]);
    expect(next.json().nextCursor).toBeNull();
  });
});

describe('who may touch a line', () => {
  it("a seller cannot see or move another partner's line; a buyer cannot touch another buyer's", async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    expect(
      (await post(`/v1/seller/order-lines/${line}/advance`, seller(p2), { to: 'Preparing' }))
        .statusCode,
    ).toBe(404);
    expect((await lineRow(h, line)).state).toBe('Confirmed');
    const list = await get('/v1/seller/order-lines?limit=100', seller(p2));
    expect(list.json().items.some((l: { id: string }) => l.id === line)).toBe(false);

    const stranger = buyer((await createOrder(h, { lines: [{ partner: 'PRT-004' }] })).customerId);
    expect((await get(`/v1/orders/${o.orderId}`, stranger)).statusCode).toBe(404);
    expect(
      (await post(`/v1/orders/${o.orderId}/lines/${line}/confirm-receipt`, stranger)).statusCode,
    ).toBe(404);
    expect(
      (await post(`/v1/orders/${o.orderId}/lines/${line}/issues`, stranger, { flag: 'Damaged' }))
        .statusCode,
    ).toBe(404);
  });

  it('guests, anonymous callers and the wrong kind of user are refused', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    expect((await get('/v1/orders', guest())).statusCode).toBe(403);
    expect((await get('/v1/orders', guest())).json().code).toBe('registration_required');
    expect((await get('/v1/orders', null)).statusCode).toBe(401);
    expect((await get('/v1/seller/order-lines', buyer(o.customerId))).statusCode).toBe(403);
    expect(
      (
        await post(`/v1/ops/order-lines/${o.lineIds[0]}/advance`, seller(p1), {
          to: 'Preparing',
          reason: 'phone call',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('transitions are forward-only (AID-LOG-015)', () => {
  it('rejects a skipped step with 422, and the database refuses it too', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    const r = await post(`/v1/seller/order-lines/${line}/advance`, seller(p1), {
      to: 'Dispatched',
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('illegal_transition');
    // Backstop: bypassing the application still cannot skip a step.
    await expect(
      h.admin
        .updateTable('fulfilment.order_line')
        .set({ state: 'Delivered', delivered_at: new Date() })
        .where('id', '=', line)
        .execute(),
    ).rejects.toThrow();
  });

  it('a retried request is a no-op, not an error', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    const first = await post(`/v1/seller/order-lines/${line}/advance`, seller(p1), {
      to: 'Preparing',
    });
    const again = await post(`/v1/seller/order-lines/${line}/advance`, seller(p1), {
      to: 'Preparing',
    });
    expect(first.json()).toMatchObject({ changed: true, state: 'Preparing' });
    expect(again.json()).toMatchObject({ changed: false, state: 'Preparing' });
    expect(await auditOf(line)).toHaveLength(1);
  });

  it('Delivered needs proof of delivery', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    for (const to of ['Preparing', 'Ready for Dispatch', 'Dispatched'])
      await post(`/v1/seller/order-lines/${line}/advance`, seller(p1), { to });
    const r = await post(`/v1/seller/order-lines/${line}/advance`, seller(p1), { to: 'Delivered' });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('proof_of_delivery_required');
  });

  it("a seller cannot confirm receipt on the buyer's behalf", async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const r = await post(`/v1/seller/order-lines/${o.lineIds[0]}/advance`, seller(p1), {
      to: 'Receipt Confirmed',
    });
    expect(r.statusCode).toBe(400);
  });

  it('ops can record a telephone update, but must say why, and it is audited with who did it', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    const opsId = h.seeded!.opsUserId;
    expect(
      (await post(`/v1/ops/order-lines/${line}/advance`, ops(opsId), { to: 'Preparing' }))
        .statusCode,
    ).toBe(400);
    const ok = await post(`/v1/ops/order-lines/${line}/advance`, ops(opsId), {
      to: 'Preparing',
      reason: 'Partner confirmed by phone at 10:15',
    });
    expect(ok.statusCode).toBe(200);
    const [a] = await h.admin
      .selectFrom('audit.event')
      .select(['actor_type', 'actor_id', 'reason'])
      .where('entity_id', '=', line)
      .execute();
    expect(a).toMatchObject({
      actor_type: 'ops_user',
      actor_id: opsId,
      reason: 'Partner confirmed by phone at 10:15',
    });
    expect(
      (
        await post(`/v1/ops/order-lines/${line}/advance`, ops(opsId, 'ops_catalogue'), {
          to: 'Ready for Dispatch',
          reason: 'phone call',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('issues (WF-07)', () => {
  it('an open issue blocks the line; resolving it unblocks', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    await post(`/v1/seller/order-lines/${line}/advance`, seller(p1), { to: 'Preparing' });
    const raised = await post(`/v1/orders/${o.orderId}/lines/${line}/issues`, buyer(o.customerId), {
      flag: 'Delayed',
      note: 'Was due Monday',
    });
    expect(raised.statusCode).toBe(201);
    const blocked = await post(`/v1/seller/order-lines/${line}/advance`, seller(p1), {
      to: 'Ready for Dispatch',
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().code).toBe('open_issue_blocks_line');
    expect((await get(`/v1/orders/${o.orderId}`, buyer(o.customerId))).json().status).toBe(
      'Issue Reported',
    );

    const seen = await get('/v1/seller/issues?state=Open', seller(p1));
    expect(seen.json().items.map((i: { id: string }) => i.id)).toContain(raised.json().id);
    expect(
      (await get('/v1/seller/issues', seller(p2))).json().items.map((i: { id: string }) => i.id),
    ).not.toContain(raised.json().id);

    expect(
      (
        await post(`/v1/seller/issues/${raised.json().id}/respond`, seller(p1), {
          note: 'Rushing it',
          action: 'PartnerHandling',
        })
      ).json().state,
    ).toBe('Partner Handling');
    expect(
      (
        await post(`/v1/seller/issues/${raised.json().id}/respond`, seller(p1), {
          note: 'Sent today',
          action: 'Resolved',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(`/v1/seller/order-lines/${line}/advance`, seller(p1), {
          to: 'Ready for Dispatch',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('the same problem cannot be reported twice while it is live (409)', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const url = `/v1/orders/${o.orderId}/lines/${o.lineIds[0]}/issues`;
    expect((await post(url, buyer(o.customerId), { flag: 'Damaged' })).statusCode).toBe(201);
    const dup = await post(url, buyer(o.customerId), { flag: 'Damaged' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('issue_already_open');
    expect((await post(url, buyer(o.customerId), { flag: 'Delayed' })).statusCode).toBe(201);
  });

  it('an issue on an eligible line holds its settlement; closing it releases the hold', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    await confirmDirect(h, line, new Date());
    expect((await lineRow(h, line)).settlement_state).toBe('Eligible');

    const raised = await post(`/v1/orders/${o.orderId}/lines/${line}/issues`, buyer(o.customerId), {
      flag: 'Damaged',
    });
    expect((await lineRow(h, line)).settlement_state).toBe('On Hold');

    const resolved = await post(
      `/v1/ops/issues/${raised.json().id}/resolve`,
      ops(h.seeded!.opsUserId),
      { resolution: 'Rejected', note: 'Photos show no damage' },
    );
    expect(resolved.json()).toMatchObject({ state: 'Rejected', lineState: 'Receipt Confirmed' });
    expect((await lineRow(h, line)).settlement_state).toBe('Eligible');
  });

  it('a hold persists until the LAST open issue closes', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    await confirmDirect(h, line, new Date());
    const a = await post(`/v1/orders/${o.orderId}/lines/${line}/issues`, buyer(o.customerId), {
      flag: 'Damaged',
    });
    const b = await post(`/v1/orders/${o.orderId}/lines/${line}/issues`, buyer(o.customerId), {
      flag: 'Missing',
    });
    await post(`/v1/ops/issues/${a.json().id}/resolve`, ops(h.seeded!.opsUserId), {
      resolution: 'Resolved',
      note: 'fixed',
    });
    expect((await lineRow(h, line)).settlement_state).toBe('On Hold');
    await post(`/v1/ops/issues/${b.json().id}/resolve`, ops(h.seeded!.opsUserId), {
      resolution: 'Resolved',
      note: 'found',
    });
    expect((await lineRow(h, line)).settlement_state).toBe('Eligible');
  });

  it('a closed issue cannot be closed again', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const raised = await post(
      `/v1/orders/${o.orderId}/lines/${o.lineIds[0]}/issues`,
      buyer(o.customerId),
      { flag: 'Delayed' },
    );
    const body = { resolution: 'Resolved', note: 'ok' };
    await post(`/v1/ops/issues/${raised.json().id}/resolve`, ops(h.seeded!.opsUserId), body);
    const again = await post(
      `/v1/ops/issues/${raised.json().id}/resolve`,
      ops(h.seeded!.opsUserId),
      body,
    );
    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe('issue_closed');
  });
});

describe('72-hour auto-confirmation (AID-LOG-015 §7)', () => {
  const deliveredAt = async (lineId: string, msAgo: number) => {
    for (const state of ['Preparing', 'Ready for Dispatch', 'Dispatched']) {
      await h.admin
        .updateTable('fulfilment.order_line')
        .set({ state })
        .where('id', '=', lineId)
        .execute();
    }
    await h.admin
      .updateTable('fulfilment.order_line')
      .set({ state: 'Delivered', delivered_at: new Date(h.clock.now() - msAgo) })
      .where('id', '=', lineId)
      .execute();
  };
  const H72 = 72 * 3_600_000;

  it('is not due at exactly 72 hours, and is due one millisecond later', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }, { partner: 'PRT-001' }] });
    const [exact, late] = o.lineIds as [string, string];
    await deliveredAt(exact, H72);
    await deliveredAt(late, H72 + 1);
    expect(await sweepAutoConfirm(h.ctx)).toBeGreaterThanOrEqual(1);
    expect((await lineRow(h, exact)).state).toBe('Delivered');
    const confirmed = await lineRow(h, late);
    expect(confirmed).toMatchObject({ state: 'Receipt Confirmed', settlement_state: 'Eligible' });
    expect((await auditOf(late)).at(-1)).toMatchObject({
      to_state: 'Receipt Confirmed',
      actor_type: 'system',
    });
    h.clock.advanceHours(0.001);
    await sweepAutoConfirm(h.ctx);
    expect((await lineRow(h, exact)).state).toBe('Receipt Confirmed');
  });

  it('never confirms a line with an open issue', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    await deliveredAt(line, H72 + 5_000);
    await post(`/v1/orders/${o.orderId}/lines/${line}/issues`, buyer(o.customerId), {
      flag: 'Damaged',
    });
    await sweepAutoConfirm(h.ctx);
    expect((await lineRow(h, line)).state).toBe('Delivered');
  });

  it('concurrent sweepers divide the work: every line confirmed exactly once', async () => {
    const o = await createOrder(h, {
      lines: Array.from({ length: 6 }, () => ({ partner: 'PRT-005' })),
    });
    for (const id of o.lineIds) await deliveredAt(id, H72 + 60_000);
    const results = await Promise.all([
      sweepAutoConfirm(h.ctx),
      sweepAutoConfirm(h.ctx),
      sweepAutoConfirm(h.ctx),
    ]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(6);
    for (const id of o.lineIds) {
      expect((await lineRow(h, id)).state).toBe('Receipt Confirmed');
      expect((await auditOf(id)).filter((a) => a.to_state === 'Receipt Confirmed')).toHaveLength(1);
    }
  });

  it('the sweeper is a registered recurring job', async () => {
    const { RECURRING } = await import('../src/jobs/registry.ts');
    expect(RECURRING.map((r) => r.kind)).toContain('fulfilment.sweep_auto_confirm');
    expect(allJobHandlers()['fulfilment.sweep_auto_confirm']).toBeTypeOf('function');
  });
});

describe('refunds (AID-LOG-014)', () => {
  it('routes across the capture AND the deposit payment, reconciles to the fil, and balances the ledger', async () => {
    const o = await createOrder(h, {
      lines: [
        { partner: 'PRT-001', unitPriceFils: aed(1000) },
        { partner: 'PRT-002', unitPriceFils: aed(2000) },
      ],
      depositCreditFils: aed(500),
    });
    expect(o).toMatchObject({
      grossFils: aed(3000),
      depositCreditFils: aed(500),
      paidFils: aed(2500),
    });
    const [la, lb] = o.lineIds as [string, string];
    const refundVia = async (line: string) => {
      const raised = await post(
        `/v1/orders/${o.orderId}/lines/${line}/issues`,
        buyer(o.customerId),
        { flag: 'Damaged' },
      );
      return post(`/v1/ops/issues/${raised.json().id}/resolve`, ops(h.seeded!.opsUserId), {
        resolution: 'Refunded',
        note: 'Arrived broken',
      });
    };
    const salesBefore = await balance(h, 'sales_collected');

    expect((await refundVia(la)).json()).toMatchObject({
      state: 'Refunded',
      lineState: 'Refunded',
    });
    let refunds = await h.admin
      .selectFrom('commerce.refund')
      .select(['payment_id', 'amount_fils', 'state'])
      .where('order_line_id', '=', la)
      .execute();
    expect(refunds).toEqual([
      { payment_id: o.capturePaymentId, amount_fils: aed(1000), state: 'Succeeded' },
    ]);

    await refundVia(lb);
    refunds = await h.admin
      .selectFrom('commerce.refund')
      .select(['payment_id', 'amount_fils', 'state'])
      .where('order_line_id', '=', lb)
      .orderBy('amount_fils', 'desc')
      .execute();
    // 2000 refunded = the remaining 1500 captured + the 500 deposit credit.
    expect(refunds).toEqual([
      { payment_id: o.capturePaymentId, amount_fils: aed(1500), state: 'Succeeded' },
      { payment_id: o.depositPaymentId, amount_fils: aed(500), state: 'Succeeded' },
    ]);
    const payments = await h.admin
      .selectFrom('commerce.payment')
      .select(['id', 'state'])
      .where('id', 'in', [o.capturePaymentId!, o.depositPaymentId!])
      .execute();
    expect(payments.every((p) => p.state === 'Refunded')).toBe(true);
    expect(await lineRow(h, la)).toMatchObject({
      state: 'Refunded',
      settlement_state: 'Not Eligible',
    });

    // Money out equals money in; the provider agrees; the books balance.
    const provider = (ref: string) => h.gateway.inspect(ref);
    const refs = await h.admin
      .selectFrom('commerce.payment')
      .select('provider_ref')
      .where('id', 'in', [o.capturePaymentId!, o.depositPaymentId!])
      .execute();
    expect(refs.reduce((t, r) => t + (provider(r.provider_ref!)?.refunded ?? 0), 0)).toBe(
      aed(3000),
    );
    expect((await balance(h, 'sales_collected')) - salesBefore).toBe(o.grossFils); // refunds drew down exactly what the order credited
    expect(await ledgerNetAll(h)).toBe(0);
  });

  it('refuses a partial refund rather than getting the books wrong', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const raised = await post(
      `/v1/orders/${o.orderId}/lines/${o.lineIds[0]}/issues`,
      buyer(o.customerId),
      { flag: 'Damaged' },
    );
    const r = await post(`/v1/ops/issues/${raised.json().id}/resolve`, ops(h.seeded!.opsUserId), {
      resolution: 'Refunded',
      note: 'x',
      refundAmountFils: 100,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('partial_refund_unsupported');
    expect((await lineRow(h, o.lineIds[0]!)).state).toBe('Confirmed');
  });

  it('survives a provider timeout AFTER the provider acted: exactly one refund at the provider', async () => {
    const o = await createOrder(h, {
      lines: [{ partner: 'PRT-001', unitPriceFils: aed(800) }],
      paymentToken: 'tok_flaky_once',
    });
    const raised = await post(
      `/v1/orders/${o.orderId}/lines/${o.lineIds[0]}/issues`,
      buyer(o.customerId),
      { flag: 'Damaged' },
    );
    const res = await post(`/v1/ops/issues/${raised.json().id}/resolve`, ops(h.seeded!.opsUserId), {
      resolution: 'Refunded',
      note: 'broken',
    });
    expect(res.statusCode).toBe(200); // the buyer-facing outcome does not depend on the provider being up

    const [refund] = await h.admin
      .selectFrom('commerce.refund')
      .select(['id', 'state'])
      .where('order_line_id', '=', o.lineIds[0]!)
      .execute();
    expect(refund?.state).toBe('Pending'); // the timeout left it durable and retryable
    expect(await balance(h, 'psp_clearing')).toBeGreaterThan(-1); // nothing posted yet for this refund

    const r = await runOnce(h.ctx, allJobHandlers());
    expect(r.failed).toBe(0);
    const after = await h.admin
      .selectFrom('commerce.refund')
      .select('state')
      .where('id', '=', refund!.id)
      .executeTakeFirstOrThrow();
    expect(after.state).toBe('Succeeded');
    const calls = h.gateway.calls.filter(
      (c) => c.op === 'refund' && c.key === `refund:${refund!.id}`,
    );
    expect(calls).toHaveLength(1);
    const ledgerRows = await h.admin
      .selectFrom('commerce.ledger_entry')
      .select('id')
      .where('ref_type', '=', 'refund')
      .where('ref_id', '=', refund!.id)
      .execute();
    expect(ledgerRows).toHaveLength(2); // posted once, not twice
    expect(await ledgerNetAll(h)).toBe(0);
  });

  it('a seller cancelling a paid line before dispatch refunds the buyer', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001', unitPriceFils: aed(700) }] });
    const line = o.lineIds[0]!;
    const r = await post(`/v1/seller/order-lines/${line}/advance`, seller(p1), {
      to: 'Cancelled',
      reason: 'Out of stock at the warehouse',
    });
    expect(r.json()).toMatchObject({ state: 'Cancelled', changed: true });
    const refunds = await h.admin
      .selectFrom('commerce.refund')
      .select(['amount_fils', 'state'])
      .where('order_line_id', '=', line)
      .execute();
    expect(refunds).toEqual([{ amount_fils: aed(700), state: 'Succeeded' }]);
    expect((await get(`/v1/orders/${o.orderId}`, buyer(o.customerId))).json().status).toBe(
      'Cancelled',
    );
    // Cannot be cancelled after dispatch.
    const o2 = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    for (const to of ['Preparing', 'Ready for Dispatch', 'Dispatched'])
      await post(`/v1/seller/order-lines/${o2.lineIds[0]}/advance`, seller(p1), { to });
    expect(
      (
        await post(`/v1/seller/order-lines/${o2.lineIds[0]}/advance`, seller(p1), {
          to: 'Cancelled',
          reason: 'changed my mind',
        })
      ).statusCode,
    ).toBe(422);
  });

  it("a buyer's cancellation request approved before dispatch ends the line as Cancelled, and sibling issues close with it", async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    const cancel = await post(`/v1/orders/${o.orderId}/lines/${line}/issues`, buyer(o.customerId), {
      flag: 'Cancellation Requested',
    });
    const delayed = await post(
      `/v1/orders/${o.orderId}/lines/${line}/issues`,
      buyer(o.customerId),
      { flag: 'Delayed' },
    );
    const r = await post(`/v1/ops/issues/${cancel.json().id}/resolve`, ops(h.seeded!.opsUserId), {
      resolution: 'Refunded',
      note: 'Approved',
    });
    expect(r.json()).toMatchObject({ lineState: 'Cancelled' });
    const sibling = await h.admin
      .selectFrom('fulfilment.issue')
      .select('state')
      .where('id', '=', delayed.json().id)
      .executeTakeFirstOrThrow();
    expect(sibling.state).toBe('Resolved');
    expect(await ledgerNetAll(h)).toBe(0);
  });
});

describe('seller worklist', () => {
  it('filters by state, pages with a cursor, and shows buyer details only for delivery', async () => {
    const o = await createOrder(h, {
      lines: [{ partner: 'PRT-006' }, { partner: 'PRT-006' }, { partner: 'PRT-006' }],
    });
    const s = seller(h.seeded!.partners.get('PRT-006')!);
    await post(`/v1/seller/order-lines/${o.lineIds[0]}/advance`, s, { to: 'Preparing' });
    const prep = await get('/v1/seller/order-lines?state=Preparing&limit=100', s);
    expect(prep.json().items.map((l: { id: string }) => l.id)).toEqual([o.lineIds[0]]);

    const p1res = await get('/v1/seller/order-lines?limit=2', s);
    expect(p1res.json().items).toHaveLength(2);
    const p2res = await get(`/v1/seller/order-lines?limit=2&cursor=${p1res.json().nextCursor}`, s);
    const all = [...p1res.json().items, ...p2res.json().items].map((l: { id: string }) => l.id);
    expect(new Set(all).size).toBe(all.length);

    const line = prep.json().items[0];
    expect(line.delivery).toMatchObject({
      recipientName: 'Test Buyer',
      phone: '+971501234567',
      emirate: 'Dubai',
    });
    expect(Object.keys(line.delivery).sort()).toEqual([
      'area',
      'emirate',
      'instructions',
      'line1',
      'line2',
      'phone',
      'recipientName',
    ]);
    expect((await get('/v1/seller/order-lines?cursor=garbage', s)).statusCode).toBe(400);
  });
});

describe('overdue notifications', () => {
  it('tells the seller about a line past its promised window', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-004' }] });
    const line = o.lineIds[0]!;
    // The snapshot promises a delivery time (write-once); age the order instead.
    await h.admin
      .updateTable('fulfilment.order_line')
      .set({ created_at: new Date(Date.now() - 40 * 86_400_000) })
      .where('id', '=', line)
      .execute();
    await allJobHandlers()['fulfilment.notify_overdue']!(h.ctx, {
      id: 'x',
      kind: 'fulfilment.notify_overdue',
      payload: {},
      attempts: 1,
      maxAttempts: 1,
    });
    const sent = h.notifier
      .ofTemplate('fulfilment.line_overdue')
      .filter((n) => n.data['orderLineId'] === line);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual({ kind: 'partner', id: o.partnerIds[0] });
    // Fresh lines are not overdue.
    const fresh = await createOrder(h, { lines: [{ partner: 'PRT-004' }] });
    await allJobHandlers()['fulfilment.notify_overdue']!(h.ctx, {
      id: 'x',
      kind: 'fulfilment.notify_overdue',
      payload: {},
      attempts: 1,
      maxAttempts: 1,
    });
    expect(
      h.notifier
        .ofTemplate('fulfilment.line_overdue')
        .some((n) => n.data['orderLineId'] === fresh.lineIds[0]),
    ).toBe(false);
  });
});

describe('delivery-proof upload', () => {
  it('signs an upload for the seller’s own line, with a server-chosen key; another seller gets 404', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const line = o.lineIds[0]!;
    const res = await post(`/v1/seller/order-lines/${line}/proof-upload`, seller(p1), {
      contentType: 'image/jpeg',
      sizeBytes: 250_000,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.storageKey).toMatch(new RegExp(`^proofs/${line}/[0-9a-f-]{36}\\.jpg$`));
    expect(body).toMatchObject({ method: 'PUT' });
    expect(h.media.signed.at(-1)).toMatchObject({ key: body.storageKey, maxBytes: 250_000 });
    expect(
      (
        await post(`/v1/seller/order-lines/${line}/proof-upload`, seller(p2), {
          contentType: 'image/jpeg',
          sizeBytes: 1000,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('refuses non-image types and oversize files, and buyers', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    const url = `/v1/seller/order-lines/${o.lineIds[0]}/proof-upload`;
    expect(
      (await post(url, seller(p1), { contentType: 'application/pdf', sizeBytes: 10 })).statusCode,
    ).toBe(400);
    expect(
      (await post(url, seller(p1), { contentType: 'image/png', sizeBytes: 50_000_000 })).statusCode,
    ).toBe(400);
    expect(
      (await post(url, buyer(o.customerId), { contentType: 'image/png', sizeBytes: 10 }))
        .statusCode,
    ).toBe(403);
  });
});
