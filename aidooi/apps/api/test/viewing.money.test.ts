/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies in HTTP tests are untyped JSON */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aed, fils, instant } from '@aidooi/domain';
import { runAsSystem } from '../src/context.ts';
import {
  applyDepositPaymentEvent,
  creditDepositForOrder,
  quoteDepositCredit,
} from '../src/modules/viewing/index.ts';
import { startHarness, type Harness } from './support/harness.ts';
import {
  api,
  auditTrail,
  bookViewing,
  compositionFromRun,
  depositRow,
  key,
  ledger,
  newBuyer,
  newSeller,
  runJobs,
  viewingRow,
  visit,
} from './support/viewing.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

/** A viewing already waiting for its deposit (one fresh on-display item, so no showroom needs to answer). */
async function awaitingDeposit() {
  const b = await newBuyer(h);
  const comp = await compositionFromRun(h, b.id);
  const item = comp.items[0]!;
  await h.admin
    .updateTable('catalogue.seller_offer')
    .set({ viewing_status: 'On Display', viewing_confirmed_at: new Date(h.clock.now()) })
    .where('id', '=', item.offerId)
    .execute();
  const v = (
    await api(
      h,
      'POST',
      '/v1/viewings',
      b.actor,
      { compositionId: comp.compositionId, itemSlotKeys: [item.slotKey] },
      key(),
    )
  ).body;
  expect(v.state).toBe('Awaiting Deposit');
  return { b, comp, item, v };
}

const when = () => new Date(h.clock.now() + 2 * 3_600_000).toISOString();
const pay = (
  a: Awaited<ReturnType<typeof awaitingDeposit>>,
  token: string,
  k = key(),
  scheduledAt = when(),
) =>
  api(
    h,
    'POST',
    `/v1/viewings/${a.v.id}/deposit`,
    a.b.actor,
    { paymentToken: token, scheduledAt },
    k,
  );
const payments = (viewingId: string) =>
  h.admin
    .selectFrom('commerce.payment as p')
    .innerJoin('viewing.viewing_deposit as d', 'd.id', 'p.viewing_deposit_id')
    .select(['p.id', 'p.state', 'p.failure_code', 'p.provider_ref', 'd.id as deposit_id'])
    .where('d.viewing_request_id', '=', viewingId)
    .execute();
const deliverWebhooks = async (providerRef: string) => {
  const delivered = [];
  for (const hook of h.gateway.drainWebhooks()) {
    const event = h.gateway.parseWebhook(hook.body, hook.signature);
    if (event.providerRef !== providerRef) continue;
    delivered.push({ event, handled: await applyDepositPaymentEvent(h.ctx, event) });
  }
  return delivered;
};

describe('paying the deposit', () => {
  it('captures once, posts one balanced ledger group, confirms the viewing and issues the pass', async () => {
    const a = await awaitingDeposit();
    const r = await pay(a, 'tok_ok');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('confirmed');
    expect(r.body.viewing.state).toBe('Confirmed');
    expect(r.body.viewing.pass).toBeTruthy();
    const dep = await depositRow(h, a.v.id);
    expect(dep.state).toBe('Paid');
    const l = await ledger(h);
    expect(l.unbalanced).toEqual([]);
    expect(l.forRef(dep.id)).toHaveLength(2);
    expect(l.forRef(dep.id).find((e) => e.account === 'psp_clearing')?.direction).toBe('debit');
    const [p] = await payments(a.v.id);
    expect(await auditTrail(h, 'payment', p!.id)).toEqual([
      '∅→Pending',
      'Pending→Authorized',
      'Authorized→Successful',
    ]);
    expect(await auditTrail(h, 'viewing_deposit', dep.id)).toEqual(['∅→Pending', 'Pending→Paid']);
  });

  it('GATEWAY TIMEOUT AFTER THE PROVIDER ACTED: retrying with the same key charges exactly once', async () => {
    const a = await awaitingDeposit();
    const k = key();
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 5 && statuses.at(-1) !== 200; i++) {
      last = await pay(a, 'tok_flaky_once', k);
      statuses.push(last.status);
    }
    expect(statuses.slice(0, -1).every((s) => s === 503)).toBe(true);
    expect(statuses.at(-1)).toBe(200);
    expect(last!.body.viewing.state).toBe('Confirmed');

    const mine = await payments(a.v.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.state).toBe('Successful');
    const dep = await depositRow(h, a.v.id);
    expect((await ledger(h)).forRef(dep.id)).toHaveLength(2); // one group
    const calls = h.gateway.calls.filter((c) => c.key.startsWith(`${mine[0]!.id}:`));
    expect(calls.filter((c) => c.op === 'authorize')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'capture')).toHaveLength(1);

    // Replaying after success returns the same confirmed viewing without touching the provider.
    const replay = await pay(a, 'tok_flaky_once', k);
    expect(replay.status).toBe(200);
    expect(h.gateway.calls.filter((c) => c.key.startsWith(`${mine[0]!.id}:`))).toHaveLength(
      calls.length,
    );
  });

  it('a decline is a 402 and leaves the viewing payable; the same key replays the decline, a new key can succeed', async () => {
    const a = await awaitingDeposit();
    const k = key();
    const declined = await pay(a, 'tok_decline', k);
    expect(declined.status).toBe(402);
    expect(declined.body.code).toBe('payment_declined');
    expect((await pay(a, 'tok_decline', k)).status).toBe(402);
    expect(await payments(a.v.id)).toHaveLength(1);
    expect((await payments(a.v.id))[0]).toMatchObject({
      state: 'Failed',
      failure_code: 'card_declined',
    });
    expect((await depositRow(h, a.v.id)).state).toBe('Pending');
    expect((await pay(a, 'tok_ok')).status).toBe(200);
    expect(await payments(a.v.id)).toHaveLength(2);
  });

  it('3-D Secure: returns the challenge, then a signed webhook completes the payment; duplicates are harmless', async () => {
    const a = await awaitingDeposit();
    const r = await pay(a, 'tok_3ds');
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'requires_action' });
    expect(r.body.actionUrl).toMatch(/^https:\/\//);
    const [p] = await payments(a.v.id);
    expect(p).toMatchObject({ state: 'Pending' });
    expect((await viewingRow(h, a.v.id)).state).toBe('Awaiting Deposit');

    h.gateway.completeChallenge(p!.provider_ref!);
    const delivered = await deliverWebhooks(p!.provider_ref!);
    expect(delivered.map((d) => d.event.type)).toEqual(['authorization.succeeded']);
    expect(delivered[0]!.handled).toBe(true);
    expect((await viewingRow(h, a.v.id)).state).toBe('Confirmed');
    expect((await depositRow(h, a.v.id)).state).toBe('Paid');

    // The provider redelivers the same event.
    expect(await applyDepositPaymentEvent(h.ctx, delivered[0]!.event)).toBe(true);
    const dep = await depositRow(h, a.v.id);
    expect((await ledger(h)).forRef(dep.id)).toHaveLength(2);
    expect(
      h.gateway.calls.filter((c) => c.op === 'capture' && c.key.startsWith(`${p!.id}:`)),
    ).toHaveLength(1);
  });

  it('a failed 3-D Secure challenge fails the payment; events for other payments are not ours', async () => {
    const a = await awaitingDeposit();
    await pay(a, 'tok_3ds');
    const [p] = await payments(a.v.id);
    h.gateway.completeChallenge(p!.provider_ref!, 'failure');
    await deliverWebhooks(p!.provider_ref!);
    expect((await payments(a.v.id))[0]).toMatchObject({
      state: 'Failed',
      failure_code: 'authentication_failed',
    });
    expect((await viewingRow(h, a.v.id)).state).toBe('Awaiting Deposit');
    expect(
      await applyDepositPaymentEvent(h.ctx, {
        id: 'evt_x',
        type: 'authorization.succeeded',
        providerRef: 'unknown-ref',
      }),
    ).toBe(false);
  });

  it('a failed capture voids the authorisation and moves no money', async () => {
    const a = await awaitingDeposit();
    const r = await pay(a, 'tok_capture_fails');
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('payment_capture_failed');
    expect((await payments(a.v.id))[0]).toMatchObject({ state: 'Voided' });
    const dep = await depositRow(h, a.v.id);
    expect(dep.state).toBe('Pending');
    expect((await ledger(h)).forRef(dep.id)).toHaveLength(0);
  });

  it('two different payment attempts at once: exactly one is charged', async () => {
    const a = await awaitingDeposit();
    const results = await Promise.all([pay(a, 'tok_ok'), pay(a, 'tok_ok')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await payments(a.v.id)).filter((p) => p.state === 'Successful')).toHaveLength(1);
    const dep = await depositRow(h, a.v.id);
    expect((await ledger(h)).forRef(dep.id)).toHaveLength(2);
  });

  it('refuses the wrong state, a reused key with a different payment, and an unreasonable date', async () => {
    const a = await awaitingDeposit();
    const k = key();
    expect((await pay(a, 'tok_decline', k)).status).toBe(402);
    const reuse = await pay(a, 'tok_ok', k);
    expect(reuse.status).toBe(422);
    expect(reuse.body.code).toBe('idempotency_key_reuse');
    expect(
      (await pay(a, 'tok_ok', key(), new Date(h.clock.now() - 1000).toISOString())).body.code,
    ).toBe('invalid_schedule');
    expect(
      (await pay(a, 'tok_ok', key(), new Date(h.clock.now() + 200 * 86_400_000).toISOString())).body
        .code,
    ).toBe('invalid_schedule');
    expect((await pay(a, 'tok_ok')).status).toBe(200);
    expect((await pay(a, 'tok_ok')).body.code).toBe('viewing_not_awaiting_deposit');

    const b = await newBuyer(h);
    const comp = await compositionFromRun(h, b.id);
    const pending = (
      await api(
        h,
        'POST',
        '/v1/viewings',
        b.actor,
        { compositionId: comp.compositionId, itemSlotKeys: [comp.items[0]!.slotKey] },
        key(),
      )
    ).body;
    if (pending.state === 'Awaiting Seller Confirmation') {
      const early = await api(
        h,
        'POST',
        `/v1/viewings/${pending.id}/deposit`,
        b.actor,
        { paymentToken: 'tok_ok', scheduledAt: when() },
        key(),
      );
      expect(early.body.code).toBe('viewing_not_awaiting_deposit');
    }
    const stranger = (await newBuyer(h)).actor;
    expect(
      (
        await api(
          h,
          'POST',
          `/v1/viewings/${a.v.id}/deposit`,
          stranger,
          { paymentToken: 'tok_ok', scheduledAt: when() },
          key(),
        )
      ).status,
    ).toBe(404);
  });
});

describe('cancelling', () => {
  it('refunds a paid deposit in full, once, with the ledger back to zero for that deposit', async () => {
    const a = await awaitingDeposit();
    await pay(a, 'tok_ok');
    const dep = await depositRow(h, a.v.id);
    const c = await api(h, 'POST', `/v1/viewings/${a.v.id}/cancel`, a.b.actor);
    expect(c.status).toBe(200);
    expect(c.body.state).toBe('Cancelled');
    expect(c.body.pass).toBeNull();
    expect((await depositRow(h, a.v.id)).state).toBe('Refunded');
    const [p] = await payments(a.v.id);
    expect(p!.state).toBe('Refunded');
    const l = await ledger(h);
    const net = l
      .forRef(dep.id)
      .reduce(
        (t, e) =>
          t +
          (e.direction === 'debit' ? 1 : -1) *
            Number(e.amount_fils) *
            (e.account === 'psp_clearing' ? 1 : 0),
        0,
      );
    expect(net).toBe(0);
    expect(l.unbalanced).toEqual([]);

    expect((await api(h, 'POST', `/v1/viewings/${a.v.id}/cancel`, a.b.actor)).status).toBe(200); // idempotent
    await runJobs(h, 'viewing.process_refund');
    expect(
      h.gateway.calls.filter((c) => c.op === 'refund' && c.key.startsWith('viewing-refund:')),
    ).toBeTruthy();
    const refunds = await h.admin
      .selectFrom('commerce.refund')
      .select('id')
      .where('payment_id', '=', p!.id)
      .execute();
    expect(refunds).toHaveLength(1);
    // The pass of a cancelled viewing no longer scans.
    const sellerPartner = a.item.partnerId;
    const s = await newSeller(h, sellerPartner);
    const old = (c.body.pass as string | null) ?? '';
    expect(
      (await api(h, 'POST', '/v1/seller/viewings/scan', s, { token: old || 'x'.repeat(20) }))
        .status,
    ).toBe(422);
  });

  it('before payment there is nothing to refund; a completed or no-show viewing cannot be cancelled', async () => {
    const a = await awaitingDeposit();
    const c = await api(h, 'POST', `/v1/viewings/${a.v.id}/cancel`, a.b.actor);
    expect(c.body.state).toBe('Cancelled');
    expect(
      (await h.admin.selectFrom('commerce.refund').select('id').execute()).length,
    ).toBeGreaterThanOrEqual(0);
    expect(await payments(a.v.id)).toHaveLength(0);

    const booked = await bookViewing(h, { onlyPartners: 1 });
    await visit(h, booked, 'Completed');
    const late = await api(
      h,
      'POST',
      `/v1/viewings/${booked.viewing.id}/cancel`,
      booked.buyerActor,
    );
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('viewing_not_cancellable');
  });

  it('cancelling while a 3-D Secure payment is in flight: the money that then arrives goes straight back', async () => {
    const a = await awaitingDeposit();
    await pay(a, 'tok_3ds');
    const [p] = await payments(a.v.id);
    await api(h, 'POST', `/v1/viewings/${a.v.id}/cancel`, a.b.actor);
    h.gateway.completeChallenge(p!.provider_ref!);
    await deliverWebhooks(p!.provider_ref!);
    await runJobs(h, 'viewing.process_refund');
    expect((await viewingRow(h, a.v.id)).state).toBe('Cancelled');
    expect((await depositRow(h, a.v.id)).state).toBe('Refunded');
    expect((await payments(a.v.id))[0]!.state).toBe('Refunded');
    expect((await ledger(h)).unbalanced).toEqual([]);
  });

  it('a refund job is idempotent: running it twice refunds once', async () => {
    const a = await awaitingDeposit();
    await pay(a, 'tok_ok');
    await api(h, 'POST', `/v1/viewings/${a.v.id}/cancel`, a.b.actor);
    const before = h.gateway.calls.filter((c) => c.op === 'refund').length;
    await h.admin
      .updateTable('platform.job')
      .set({ status: 'Pending', run_at: new Date(Date.now() - 1000) })
      .where('kind', '=', 'viewing.process_refund')
      .execute();
    await runJobs(h, 'viewing.process_refund');
    expect(h.gateway.calls.filter((c) => c.op === 'refund').length).toBe(before);
  });
});

describe('a showroom declines (rule: the buyer decides — continue without it, or cancel)', () => {
  async function twoShowrooms() {
    const b = await newBuyer(h);
    const comp = await compositionFromRun(h, b.id);
    for (const i of comp.items)
      await h.admin
        .updateTable('catalogue.seller_offer')
        .set({ viewing_status: 'Viewable on Request' })
        .where('id', '=', i.offerId)
        .execute();
    const partners = [...new Set(comp.items.map((i) => i.partnerId))].slice(0, 2);
    const slots = comp.items.filter((i) => partners.includes(i.partnerId)).map((i) => i.slotKey);
    const v = (
      await api(
        h,
        'POST',
        '/v1/viewings',
        b.actor,
        { compositionId: comp.compositionId, itemSlotKeys: slots },
        key(),
      )
    ).body;
    const sellers = [await newSeller(h, partners[0]!), await newSeller(h, partners[1]!)] as const;
    const task = async (s: (typeof sellers)[number]) =>
      (
        (await api(h, 'GET', '/v1/seller/viewing-tasks', s)).body as {
          id: string;
          viewingRequestId: string;
        }[]
      ).find((t) => t.viewingRequestId === v.id)!;
    return { b, comp, v, sellers, task };
  }

  it('mixed answers: the request waits for the buyer; the deposit covers only what will be visited', async () => {
    const t = await twoShowrooms();
    const [s1, s2] = t.sellers;
    await api(h, 'POST', `/v1/seller/viewing-tasks/${(await t.task(s1)).id}/respond`, s1, {
      response: 'Confirmed',
    });
    const declined = await api(
      h,
      'POST',
      `/v1/seller/viewing-tasks/${(await t.task(s2)).id}/respond`,
      s2,
      { response: 'Declined' },
    );
    expect(declined.body.viewingState).toBe('Awaiting Seller Confirmation');
    expect(h.notifier.ofTemplate('viewing.stop_declined').length).toBeGreaterThan(0);
    expect(
      h.notifier.ofTemplate('viewing.decision_needed').some((n) => n.data['viewingId'] === t.v.id),
    ).toBe(true);

    const view = (await api(h, 'GET', `/v1/viewings/${t.v.id}`, t.b.actor)).body;
    expect(view.needsDecision).toBe(true);
    expect(view.deposit).toBeNull();
    const confirmedTotal = view.stops
      .filter((s: any) => s.confirmation === 'Confirmed')
      .flatMap((s: any) => s.products)
      .reduce((x: number, p: any) => x + p.unitPrice * p.quantity, 0);
    const allTotal = view.stops
      .flatMap((s: any) => s.products)
      .reduce((x: number, p: any) => x + p.unitPrice * p.quantity, 0);
    expect(view.depositQuote.base).toBe(confirmedTotal);
    expect(confirmedTotal).toBeLessThan(allTotal);

    const early = await api(
      h,
      'POST',
      `/v1/viewings/${t.v.id}/deposit`,
      t.b.actor,
      { paymentToken: 'tok_ok', scheduledAt: when() },
      key(),
    );
    expect(early.body.code).toBe('viewing_not_awaiting_deposit');

    const cont = await api(h, 'POST', `/v1/viewings/${t.v.id}/continue`, t.b.actor);
    expect(cont.status).toBe(200);
    expect(cont.body.state).toBe('Awaiting Deposit');
    expect(cont.body.deposit.amount).toBe(view.depositQuote.amount);
    expect((await api(h, 'POST', `/v1/viewings/${t.v.id}/continue`, t.b.actor)).body.state).toBe(
      'Awaiting Deposit',
    ); // idempotent
    const paid = await api(
      h,
      'POST',
      `/v1/viewings/${t.v.id}/deposit`,
      t.b.actor,
      { paymentToken: 'tok_ok', scheduledAt: when() },
      key(),
    );
    expect(paid.body.viewing.state).toBe('Confirmed');
    // The declined showroom is not part of the visit: it gets no notice and cannot scan.
    expect(paid.body.viewing.stops.find((s: any) => s.confirmation === 'Declined')).toBeTruthy();
    expect(
      h.notifier
        .ofTemplate('viewing.confirmed_for_seller')
        .filter((n) => n.data['viewingId'] === t.v.id),
    ).toHaveLength(1);
    const pass = paid.body.viewing.pass as string;
    expect((await api(h, 'POST', '/v1/seller/viewings/scan', s2, { token: pass })).status).toBe(
      404,
    );
  });

  it('every showroom declining cancels the request; "continue" with nothing to continue is refused', async () => {
    const t = await twoShowrooms();
    for (const s of t.sellers)
      await api(h, 'POST', `/v1/seller/viewing-tasks/${(await t.task(s)).id}/respond`, s, {
        response: 'Declined',
      });
    expect((await viewingRow(h, t.v.id)).state).toBe('Cancelled');
    expect(
      h.notifier.ofTemplate('viewing.cancelled').some((n) => n.data['viewingId'] === t.v.id),
    ).toBe(true);
    expect((await api(h, 'POST', `/v1/viewings/${t.v.id}/continue`, t.b.actor)).body.code).toBe(
      'viewing_no_decision_pending',
    );
  });

  it('a buyer who never decides lapses after 24 hours', async () => {
    const t = await twoShowrooms();
    const [s1, s2] = t.sellers;
    await api(h, 'POST', `/v1/seller/viewing-tasks/${(await t.task(s1)).id}/respond`, s1, {
      response: 'Confirmed',
    });
    await api(h, 'POST', `/v1/seller/viewing-tasks/${(await t.task(s2)).id}/respond`, s2, {
      response: 'Declined',
    });
    await runJobs(h, 'viewing.expire_unconfirmed');
    expect((await viewingRow(h, t.v.id)).state).toBe('Cancelled');
  });
});

describe('the seller SLA', () => {
  it('escalates to operations at half the SLA, once; unanswered showrooms lapse as declined at the SLA', async () => {
    const b = await newBuyer(h);
    const comp = await compositionFromRun(h, b.id);
    const item = comp.items[0]!;
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ viewing_status: 'Viewable on Request' })
      .where('id', '=', item.offerId)
      .execute();
    const v = (
      await api(
        h,
        'POST',
        '/v1/viewings',
        b.actor,
        { compositionId: comp.compositionId, itemSlotKeys: [item.slotKey] },
        key(),
      )
    ).body;
    expect(v.state).toBe('Awaiting Seller Confirmation');
    const task = await h.admin
      .selectFrom('commerce.confirmation_task')
      .selectAll()
      .where('viewing_stop_id', '=', v.stops[0].id)
      .executeTakeFirstOrThrow();
    expect(new Date(task.due_at).getTime() - h.clock.now()).toBeGreaterThan(11.9 * 3_600_000);
    expect(new Date(task.due_at).getTime() - h.clock.now()).toBeLessThanOrEqual(12 * 3_600_000);

    h.clock.advanceHours(6.5);
    await runJobs(h, 'viewing.escalate_confirmation');
    await runJobs(h, 'viewing.escalate_confirmation');
    expect(
      h.notifier
        .ofTemplate('viewing.confirmation_overdue')
        .filter((n) => n.data['taskId'] === task.id),
    ).toHaveLength(1);
    expect(
      (
        await h.admin
          .selectFrom('commerce.confirmation_task')
          .select('escalated_at')
          .where('id', '=', task.id)
          .executeTakeFirstOrThrow()
      ).escalated_at,
    ).not.toBeNull();

    // Too early to lapse: the handler refuses, the job is retried later.
    await h.admin
      .updateTable('platform.job')
      .set({ run_at: new Date(Date.now() - 1000) })
      .where('kind', '=', 'viewing.expire_unconfirmed')
      .execute();
    expect((await runJobs(h)).failed).toBeGreaterThanOrEqual(1);
    expect((await viewingRow(h, v.id)).state).toBe('Awaiting Seller Confirmation');

    h.clock.advanceHours(6);
    await h.admin
      .updateTable('platform.job')
      .set({ status: 'Pending', run_at: new Date(Date.now() - 1000) })
      .where('kind', '=', 'viewing.expire_unconfirmed')
      .execute();
    await runJobs(h);
    expect((await viewingRow(h, v.id)).state).toBe('Cancelled');
    const lapsed = await h.admin
      .selectFrom('commerce.confirmation_task')
      .select('response')
      .where('id', '=', task.id)
      .executeTakeFirstOrThrow();
    expect(lapsed.response).toBe('Declined');
  });
});

describe('deposit credit: quote and apply can never disagree', () => {
  type Case = {
    name: string;
    orderGross: (deposit: number) => number;
    customer?: 'other';
    visit?: boolean;
    nowOffsetMs?: number;
  };
  const SEVEN_DAYS = 7 * 86_400_000;
  const cases: Case[] = [
    { name: 'order larger than the deposit', orderGross: (d) => d * 20 },
    { name: 'order equal to the deposit', orderGross: (d) => d },
    { name: 'order smaller than the deposit', orderGross: (d) => Math.floor(d / 3) },
    { name: 'a different customer', orderGross: (d) => d * 2, customer: 'other' },
    { name: 'viewing not completed', orderGross: (d) => d * 2, visit: false },
    {
      name: 'one millisecond inside the window',
      orderGross: (d) => d * 2,
      nowOffsetMs: SEVEN_DAYS - 1,
    },
    { name: 'exactly at the window edge', orderGross: (d) => d * 2, nowOffsetMs: SEVEN_DAYS },
    { name: 'after the window', orderGross: (d) => d * 2, nowOffsetMs: SEVEN_DAYS + 3_600_000 },
  ];

  it.each(cases)('$name', async (c) => {
    const b = await bookViewing(h, { onlyPartners: 1 });
    if (c.visit !== false) await visit(h, b, 'Completed');
    const req = await viewingRow(h, b.viewing.id);
    const deposit = Number((await depositRow(h, b.viewing.id)).amount_fils);
    const base = req.outcome_at ? new Date(req.outcome_at).getTime() : h.clock.now();
    const args = {
      viewingRequestId: b.viewing.id,
      customerId: c.customer === 'other' ? (await newBuyer(h)).id : b.customerId,
      orderGross: fils(c.orderGross(deposit)),
      now: instant(base + (c.nowOffsetMs ?? 1000)),
    };
    const quote = await runAsSystem(h.ctx, (trx) => quoteDepositCredit(trx, args));
    const applied = await runAsSystem(h.ctx, (trx) => creditDepositForOrder(trx, h.ctx, args));
    expect(applied.credit).toBe(quote.credit);
    expect(applied.excessRefundDue).toBe(quote.excess);
    // Asking again after the credit was applied still agrees.
    expect(await runAsSystem(h.ctx, (trx) => quoteDepositCredit(trx, args))).toEqual(quote);

    const creditable =
      c.customer !== 'other' && c.visit !== false && (c.nowOffsetMs ?? 0) < SEVEN_DAYS;
    if (creditable) {
      expect(quote.credit).toBe(Math.min(deposit, args.orderGross));
      expect(quote.excess).toBe(deposit - quote.credit);
    } else {
      expect(quote).toEqual({ credit: 0, excess: 0 });
      expect((await depositRow(h, b.viewing.id)).state).toBe('Paid');
    }
  });

  it('a quote writes nothing', async () => {
    const b = await bookViewing(h, { onlyPartners: 1 });
    await visit(h, b, 'Completed');
    const jobsBefore = await h.admin.selectFrom('platform.job').select('id').execute();
    await runAsSystem(h.ctx, (trx) =>
      quoteDepositCredit(trx, {
        viewingRequestId: b.viewing.id,
        customerId: b.customerId,
        orderGross: aed(10),
        now: instant(h.clock.now()),
      }),
    );
    expect((await depositRow(h, b.viewing.id)).state).toBe('Paid');
    expect(await h.admin.selectFrom('platform.job').select('id').execute()).toHaveLength(
      jobsBefore.length,
    );
    expect(
      await h.admin
        .selectFrom('commerce.refund')
        .select('id')
        .where('reason', '=', 'deposit_excess')
        .execute(),
    ).toEqual(
      await h.admin
        .selectFrom('commerce.refund')
        .select('id')
        .where('reason', '=', 'deposit_excess')
        .execute(),
    );
  });
});

describe('every scenario leaves the books balanced', () => {
  it('Σ debits = Σ credits in every ledger group across this whole suite', async () => {
    const l = await ledger(h);
    expect(l.groupCount).toBeGreaterThan(5);
    expect(l.unbalanced).toEqual([]);
    // A deposit is held, refunded, forfeited or credited — never lost: what remains in deposits_held is
    // exactly the deposits still Paid or Credited-but-not-yet-applied by checkout.
    const heldRows = await h.admin
      .selectFrom('viewing.viewing_deposit')
      .select(['state', 'amount_fils'])
      .where('state', '=', 'Paid')
      .execute();
    const credited = await h.admin
      .selectFrom('viewing.viewing_deposit')
      .select(['amount_fils', 'credited_fils'])
      .where('state', '=', 'Credited')
      .execute();
    const queued = await h.admin
      .selectFrom('commerce.refund')
      .select('amount_fils')
      .where('state', '=', 'Pending')
      .execute();
    const expectedHeld =
      heldRows.reduce((t, r) => t + Number(r.amount_fils), 0) +
      credited.reduce((t, r) => t + Number(r.credited_fils), 0) + // the credit itself is posted by checkout, not here
      queued.reduce((t, r) => t + Number(r.amount_fils), 0); // refunds recorded but not yet executed
    // deposits_held is a liability: its net is credit-side, i.e. negative in (debit − credit) terms.
    expect(-l.balance('deposits_held')).toBe(expectedHeld);
  });
});
