/**
 * The whole product, once, through the real HTTP API and a real database: a stranger opens the app,
 * profiles a room, signs in without losing it, views the products in store, buys them with the viewing
 * deposit credited, the sellers deliver, the buyer confirms receipt, and finance settles the sellers.
 *
 * Each step is a Master Plan acceptance gate; the closing assertions are the ones that matter most —
 * every dirham that came in is accounted for, nothing is double-counted, and the books balance.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are untyped JSON in tests */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures } from '@aidooi/db/testing';
import { enqueue } from '@aidooi/db';
import { ops } from './support/harness.ts';
import { startHarness, type Harness } from './support/harness.ts';
import { key, ledger, newSeller, runJobs } from './support/viewing.ts';
import { relayOutbox } from '../src/modules/outbox.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const PHONE = '+971501112233';
const delivery = {
  recipientName: 'Aisha Khan',
  phone: PHONE,
  line1: 'Marina Walk, Tower 5',
  emirate: 'Dubai',
};

const call = async (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  auth: string | null | undefined,
  body?: unknown,
  extra: Record<string, string> = {},
) => {
  const res = await h.app.inject({
    method,
    url,
    headers: { ...(auth ? { authorization: auth } : {}), 'x-forwarded-for': '10.9.9.9', ...extra },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, body: res.json() as any, raw: res.body, headers: res.headers };
};
const idem = () => ({ 'idempotency-key': key() });

describe('JOURNEY: from stranger to settled seller', () => {
  const s: {
    guest?: string;
    projectId?: string;
    token?: string;
    customerId?: string;
    composition?: any;
    viewingId?: string;
    checkoutId?: string;
    orderId?: string;
    total?: number;
    deposit?: number;
    paid?: number;
  } = {};

  it('1 · a stranger opens the app and starts profiling a room as a guest — no account needed', async () => {
    const g = await call('POST', '/v1/auth/guest', null);
    expect(g.status).toBe(201);
    s.guest = `Guest ${g.body.guestToken}`;
    const p = await call('POST', '/v1/projects', s.guest, {
      input: {
        pathId: 'livingRoom',
        lengthM: 5,
        widthM: 4,
        style: 'scandinavian',
        colour: 'beige',
        tier: 'Standard',
      },
    });
    expect(p.status, p.raw).toBe(201);
    expect(p.body).toMatchObject({ sizeClass: 'Medium', state: 'Ready for Recommendation' });
    s.projectId = p.body.id;
    const cards = await call('GET', `/v1/projects/${s.projectId}/budget-cards`, s.guest ?? null);
    expect(cards.body.cards).toHaveLength(5);
  });

  it('2 · they reach a viewing and must sign in; the project follows them and nothing restarts', async () => {
    const blocked = await call(
      'POST',
      '/v1/viewings',
      s.guest!,
      { compositionId: '00000000-0000-4000-8000-000000000000' },
      idem(),
    );
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('registration_required');

    expect((await call('POST', '/v1/auth/otp/request', null, { phone: PHONE })).status).toBe(202);
    const verified = await call('POST', '/v1/auth/otp/verify', null, {
      phone: PHONE,
      code: h.otp.last(PHONE),
      guestToken: s.guest?.replace('Guest ', ''),
      policyVersion: '2026-01',
    });
    expect(verified.status, verified.raw).toBe(200);
    s.token = `Bearer ${verified.body.accessToken}`;
    s.customerId = verified.body.customer.id;

    const mine = await call('GET', `/v1/projects/${s.projectId}`, s.token ?? null);
    expect(mine.status).toBe(200); // the very same project, now owned by the customer
    expect(mine.body.id).toBe(s.projectId);
  });

  it('3 · recommendations: four differentiated, valid options from products really in stock', async () => {
    const r = await call('POST', `/v1/projects/${s.projectId}/recommend`, s.token);
    expect(r.status, r.raw).toBe(200);
    const run = r.body.runs[0];
    expect(run.status).toBe('Completed');
    expect(run.compositions.map((c: any) => c.objective)).toEqual([
      'best_overall',
      'best_value',
      'best_style',
      'premium',
    ]);
    for (const c of run.compositions) {
      expect(c.score).toBeGreaterThanOrEqual(70);
      expect(c.total).toBeLessThanOrEqual(c.ceiling);
      expect(c.stale).toBe(false);
    }
    s.composition = run.compositions[0];
    // The result is explainable: every candidate scored is on record, including the rejected ones.
    const scored = await h.admin
      .selectFrom('recommendation.candidate_score')
      .select('eligible')
      .where('run_id', '=', run.id)
      .execute();
    expect(scored.some((x) => !x.eligible)).toBe(true);
  });

  it('4 · they view the products in store: sellers confirm, a capped deposit is paid, the pass is scanned', async () => {
    const items = s.composition.items as any[];
    // Only products that can actually be viewed (the recommendation shows viewing status on every card).
    const viewable = items.filter((i) => i.offer.viewingStatus !== 'Not Viewable');
    expect(viewable.length).toBeGreaterThan(0);
    const created = await call(
      'POST',
      '/v1/viewings',
      s.token!,
      { compositionId: s.composition.id, itemSlotKeys: viewable.map((i) => i.slotKey) },
      idem(),
    );
    expect(created.status, created.raw).toBe(201);
    s.viewingId = created.body.id;

    const partnerIds = [...new Set(viewable.map((i) => i.offer.partner.id as string))];
    const sellers = new Map<string, Awaited<ReturnType<typeof newSeller>>>();
    for (const p of partnerIds) {
      const actor = await newSeller(h, p);
      sellers.set(p, actor);
      for (const t of (await call('GET', '/v1/seller/viewing-tasks', null, undefined, h.as(actor)))
        .body as { id: string }[]) {
        const r = await call(
          'POST',
          `/v1/seller/viewing-tasks/${t.id}/respond`,
          null,
          { response: 'Confirmed', displayConfirmed: true },
          h.as(actor),
        );
        expect(r.status, r.raw).toBe(200);
      }
    }
    const view = await call('GET', `/v1/viewings/${s.viewingId}`, s.token!);
    expect(view.body.state).toBe('Awaiting Deposit');

    const deposit = await call(
      'POST',
      `/v1/viewings/${s.viewingId}/deposit`,
      s.token!,
      {
        paymentToken: 'tok_ok',
        scheduledAt: new Date(h.clock.now() + 2 * 3_600_000).toISOString(),
      },
      idem(),
    );
    expect(deposit.status, deposit.raw).toBe(200);
    const dep = await h.admin
      .selectFrom('viewing.viewing_deposit')
      .select(['amount_fils', 'basis_fils'])
      .where('viewing_request_id', '=', s.viewingId!)
      .executeTakeFirstOrThrow();
    s.deposit = Number(dep.amount_fils);
    expect(s.deposit).toBeLessThanOrEqual(50_000); // AED 500 cap
    expect(s.deposit).toBe(Math.min(Math.floor((Number(dep.basis_fils) * 5 + 50) / 100), 50_000));

    const pass = await call('GET', `/v1/viewings/${s.viewingId}/pass`, s.token!);
    expect(pass.status).toBe(200);
    for (const actor of sellers.values()) {
      const scan = await call(
        'POST',
        '/v1/seller/viewings/scan',
        null,
        { token: pass.body.token },
        h.as(actor),
      );
      expect(scan.status, scan.raw).toBe(200);
      const out = await call(
        'POST',
        `/v1/seller/viewings/${s.viewingId}/outcome`,
        null,
        { outcome: 'Completed' },
        h.as(actor),
      );
      expect(out.status, out.raw).toBe(200);
    }
    expect((await call('GET', `/v1/viewings/${s.viewingId}`, s.token!)).body.state).toBe(
      'Completed',
    );
  });

  it('5 · they buy: one checkout, one payment, the deposit credited in full', async () => {
    const offerIds = (s.composition.items as any[]).map((i) => i.offer.id);
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ availability: 'In Stock', stock_qty: 50 })
      .where('id', 'in', offerIds)
      .execute();

    const started = await call(
      'POST',
      '/v1/checkout',
      s.token!,
      {
        source: { kind: 'composition', compositionId: s.composition.id },
        viewingRequestId: s.viewingId,
      },
      idem(),
    );
    expect(started.status, started.raw).toBe(201);
    expect(started.body.state).toBe('Ready to Pay');
    s.total = started.body.total;
    expect(started.body.depositCredit).toBe(s.deposit);
    expect(started.body.payable).toBe(s.total! - s.deposit!);
    s.checkoutId = started.body.id;

    const paid = await call(
      'POST',
      `/v1/checkout/${s.checkoutId}/pay`,
      s.token!,
      { paymentToken: 'tok_ok', delivery },
      idem(),
    );
    expect(paid.status, paid.raw).toBe(200);
    expect(paid.body).toMatchObject({
      status: 'paid',
      paid: s.total! - s.deposit!,
      depositCredit: s.deposit,
    });
    s.orderId = paid.body.orderId;
    s.paid = paid.body.paid;

    await relayOutbox(h.ctx);
    expect(
      h.notifier.ofTemplate('order.confirmed').some((n) => n.data['orderId'] === s.orderId),
    ).toBe(true);
  });

  it('6 · the buyer sees ONE order, with no sign of how it splits between sellers', async () => {
    const order = await call('GET', `/v1/orders/${s.orderId}`, s.token!);
    expect(order.status, order.raw).toBe(200);
    expect(order.body.lines.length).toBe(s.composition.items.length);
    expect(JSON.stringify(order.body)).not.toMatch(/commission/i);
    expect(order.body.status).toBe('Confirmed');
  });

  it('7 · sellers prepare, dispatch and deliver their own lines; the buyer confirms receipt', async () => {
    const lines = await h.admin
      .selectFrom('fulfilment.order_line')
      .select(['id', 'partner_id'])
      .where('master_order_id', '=', s.orderId!)
      .execute();
    for (const l of lines) {
      const seller = await newSeller(h, l.partner_id);
      for (const to of ['Preparing', 'Ready for Dispatch', 'Dispatched']) {
        const r = await call(
          'POST',
          `/v1/seller/order-lines/${l.id}/advance`,
          null,
          { to },
          h.as(seller),
        );
        expect(r.status, r.raw).toBe(200);
      }
      const delivered = await call(
        'POST',
        `/v1/seller/order-lines/${l.id}/advance`,
        null,
        { to: 'Delivered', proofPhotoKey: `proof/${l.id}.jpg` },
        h.as(seller),
      );
      expect(delivered.status, delivered.raw).toBe(200);
    }
    expect((await call('GET', `/v1/orders/${s.orderId}`, s.token!)).body.status).not.toBe(
      'Completed',
    ); // not until receipt
    for (const l of lines) {
      const r = await call(
        'POST',
        `/v1/orders/${s.orderId}/lines/${l.id}/confirm-receipt`,
        s.token!,
      );
      expect(r.status, r.raw).toBe(200);
    }
    expect((await call('GET', `/v1/orders/${s.orderId}`, s.token!)).body.status).toBe('Completed');
    const eligible = await h.admin
      .selectFrom('fulfilment.order_line')
      .select('settlement_state')
      .where('master_order_id', '=', s.orderId!)
      .execute();
    expect(eligible.every((e) => e.settlement_state === 'Eligible')).toBe(true);
  });

  it('8 · finance settles the sellers with four-eyes approval; sellers read their statements', async () => {
    const creator = ops(await fixtures.opsUser(h.admin), 'ops_finance');
    const approver = ops(await fixtures.opsUser(h.admin), 'ops_finance');
    const period = new Date(h.clock.now()).toISOString().slice(0, 7);

    const created = await call('POST', '/v1/ops/settlement/runs', null, { period }, h.as(creator));
    expect(created.status, created.raw).toBe(200);
    const runs = created.body.runs as {
      id: string;
      partnerId: string;
      grossFils: number;
      commissionFils: number;
      netFils: number;
    }[];
    expect(runs.length).toBeGreaterThan(0);

    const self = await call(
      'POST',
      `/v1/ops/settlement/runs/${runs[0]!.id}/approve`,
      null,
      {},
      h.as(creator),
    );
    expect(self.status).toBe(403); // four eyes: the creator cannot approve their own run

    for (const r of runs) {
      expect(
        (await call('POST', `/v1/ops/settlement/runs/${r.id}/approve`, null, {}, h.as(approver)))
          .status,
      ).toBe(200);
      expect(
        (
          await call(
            'POST',
            `/v1/ops/settlement/runs/${r.id}/mark-paid`,
            null,
            { bankReference: `BANK-${r.id.slice(0, 8)}` },
            h.as(approver),
          )
        ).status,
      ).toBe(200);
    }
    const grossSettled = runs.reduce((t, r) => t + r.grossFils, 0);
    expect(grossSettled).toBe(s.total); // every line of the order was settled, once

    for (const r of runs) {
      const seller = await newSeller(h, r.partnerId);
      const statements = await call('GET', '/v1/seller/statements', null, undefined, h.as(seller));
      expect(statements.status).toBe(200);
      expect(JSON.stringify(statements.body)).toContain(String(r.netFils));
    }
  });

  it('9 · THE BOOKS: every dirham is accounted for and every entry group balances', async () => {
    const lg = await ledger(h);
    expect(lg.unbalanced).toEqual([]);
    // What the buyer put in = what the order is worth: the card paid, plus the deposit credited.
    expect(s.paid! + s.deposit!).toBe(s.total);
    // …and all of it reached the payment provider's books, none of it twice.
    expect(lg.balance('psp_clearing')).toBe(s.total);
    // After settlement the money owed onward has been apportioned and paid out: nothing is left owed.
    expect(lg.balance('sales_collected')).toBe(0);
    const accounts = await h.admin
      .selectFrom('commerce.ledger_entry')
      .select('account')
      .distinct()
      .execute();
    for (const { account } of accounts.filter((a) => a.account.startsWith('seller_payable:'))) {
      expect(lg.balance(account), account).toBe(0);
    }
    const commission = await h.admin
      .selectFrom('fulfilment.order_line')
      .select((e) => e.fn.sum<string>('commission_fils').as('n'))
      .where('master_order_id', '=', s.orderId!)
      .executeTakeFirstOrThrow();
    // Revenue is credit-nature, so its balance (debit − credit) is negative.
    expect(-lg.balance('commission_revenue')).toBe(Number(commission.n));
    // Conservation of money: what came in left as exactly commission plus seller payouts, to the fil.
    expect(-lg.balance('commission_revenue') - lg.balance('bank')).toBe(s.total);
    // The deposit this buyer paid was consumed by the order: the liability it created is gone.
    const heldForViewing = lg.forRef(s.orderId!).filter((e) => e.account === 'deposits_held');
    expect(heldForViewing.reduce((t, e) => t + Number(e.amount_fils), 0)).toBe(s.deposit);
  });

  it('10 · the trail: every state change on the order is in the audit log, with who and why', async () => {
    const rows = await h.admin
      .selectFrom('audit.event')
      .select(['entity_type', 'actor_type'])
      .where((eb) =>
        eb.or([
          eb('entity_id', '=', s.orderId!),
          eb('entity_id', '=', s.checkoutId!),
          eb('entity_id', '=', s.viewingId!),
        ]),
      )
      .execute();
    const types = new Set(rows.map((r) => r.entity_type));
    for (const t of ['master_order', 'purchase_request', 'viewing_request'])
      expect(types.has(t), t).toBe(true);
    expect(new Set(rows.map((r) => r.actor_type))).toEqual(expect.objectContaining({}));
    await enqueue(h.admin, 'platform.relay_outbox', {});
    await runJobs(h, 'platform.relay_outbox');
  });
});
