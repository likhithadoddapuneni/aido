/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies in HTTP tests are untyped JSON */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aed, fils, instant, quoteDeposit } from '@aidooi/domain';
import { runAsSystem } from '../src/context.ts';
import { creditDepositForOrder, markViewingPurchased } from '../src/modules/viewing/index.ts';
import { startHarness, type Harness } from './support/harness.ts';
import {
  api,
  auditTrail,
  bookViewing,
  compositionFromRun,
  depositRow,
  inDays,
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

describe('creating a viewing', () => {
  it('guests cannot request a viewing: they are asked to register and nothing is lost', async () => {
    const guest = {
      kind: 'buyer',
      customerId: null,
      guestSessionId: 'a0000000-0000-4000-8000-000000000009',
    } as const;
    const r = await api(
      h,
      'POST',
      '/v1/viewings',
      guest,
      { compositionId: 'a0000000-0000-4000-8000-000000000001' },
      key(),
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('registration_required');
    expect((await api(h, 'GET', '/v1/viewings', null)).status).toBe(401);
  });

  it('groups products by showroom, quotes the deposit, asks each showroom, and tells them after commit', async () => {
    const b = await newBuyer(h);
    const comp = await compositionFromRun(h, b.id);
    const before = h.notifier.ofTemplate('viewing.seller_confirmation_requested').length;
    const r = await api(
      h,
      'POST',
      '/v1/viewings',
      b.actor,
      { compositionId: comp.compositionId },
      key(),
    );
    expect(r.status).toBe(201);
    const v = r.body;
    const partners = new Set(comp.items.map((i) => i.partnerId));
    expect(v.stops).toHaveLength(partners.size);
    expect(v.stops.flatMap((s: any) => s.products)).toHaveLength(comp.items.length);
    expect(v.state).toBe('Awaiting Seller Confirmation');
    expect(v.deposit).toBeNull(); // stored only when the visit is final (the stored deposit is immutable)

    const total = comp.items.reduce((t, i) => t + i.unitPrice * i.quantity, 0);
    expect(v.depositQuote.amount).toBe(
      quoteDeposit([{ offer: { sellingPrice: fils(total) }, qty: 1 }]).amount,
    );

    const sent = h.notifier.ofTemplate('viewing.seller_confirmation_requested').length - before;
    const pending = v.stops.filter((s: any) => s.confirmation === 'Pending').length;
    expect(sent).toBe(pending);
    expect(await auditTrail(h, 'viewing_request', v.id)).toEqual([
      '∅→Draft',
      'Draft→Awaiting Seller Confirmation',
    ]);
  });

  it('is idempotent: a retried request returns the same viewing and creates one', async () => {
    const b = await newBuyer(h);
    const comp = await compositionFromRun(h, b.id);
    const k = key();
    const a = await api(
      h,
      'POST',
      '/v1/viewings',
      b.actor,
      { compositionId: comp.compositionId },
      k,
    );
    const again = await api(
      h,
      'POST',
      '/v1/viewings',
      b.actor,
      { compositionId: comp.compositionId },
      k,
    );
    expect(again.body.id).toBe(a.body.id);
    const other = await api(
      h,
      'POST',
      '/v1/viewings',
      b.actor,
      { compositionId: comp.compositionId, itemSlotKeys: [comp.items[0]!.slotKey] },
      k,
    );
    expect(other.status).toBe(422);
    expect(other.body.code).toBe('idempotency_key_reuse');
    const mine = await api(h, 'GET', '/v1/viewings', b.actor);
    expect(mine.body).toHaveLength(1);
  });

  it('concurrent double-submit of the same request creates exactly one viewing', async () => {
    const b = await newBuyer(h);
    const comp = await compositionFromRun(h, b.id);
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        api(h, 'POST', '/v1/viewings', b.actor, { compositionId: comp.compositionId }, k),
      ),
    );
    expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const rows = await h.admin
      .selectFrom('viewing.viewing_request')
      .select('id')
      .where('customer_id', '=', b.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('refuses a composition that belongs to someone else, and unknown or unavailable products', async () => {
    const owner = await newBuyer(h);
    const stranger = await newBuyer(h);
    const comp = await compositionFromRun(h, owner.id);
    expect(
      (
        await api(
          h,
          'POST',
          '/v1/viewings',
          stranger.actor,
          { compositionId: comp.compositionId },
          key(),
        )
      ).status,
    ).toBe(404);
    const unknown = await api(
      h,
      'POST',
      '/v1/viewings',
      owner.actor,
      { compositionId: comp.compositionId, itemSlotKeys: ['Nope#9'] },
      key(),
    );
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe('unknown_slot');

    // The offer sold out since the recommendation: it is simply not available to view.
    const victim = comp.items[0]!;
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ stock_qty: 0, availability: 'Out of Stock' })
      .where('id', '=', victim.offerId)
      .execute();
    const gone = await api(
      h,
      'POST',
      '/v1/viewings',
      owner.actor,
      { compositionId: comp.compositionId },
      key(),
    );
    expect(gone.status).toBe(422);
    expect(gone.body.code).toBe('viewing_items_unavailable');
    expect(gone.body.errors.map((e: any) => e.path)).toContain(victim.slotKey);
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ stock_qty: 5, availability: 'In Stock' })
      .where('id', '=', victim.offerId)
      .execute();
  });

  it('a fresh, on-display offer needs no seller action; a stale confirmation does (72h)', async () => {
    const b = await newBuyer(h);
    const comp = await compositionFromRun(h, b.id);
    const target = comp.items[0]!;
    const only = { compositionId: comp.compositionId, itemSlotKeys: [target.slotKey] };

    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({
        viewing_status: 'On Display',
        viewing_confirmed_at: new Date(h.clock.now() - 3_600_000),
      })
      .where('id', '=', target.offerId)
      .execute();
    const fresh = await api(h, 'POST', '/v1/viewings', b.actor, only, key());
    expect(fresh.body.state).toBe('Awaiting Deposit');
    expect(fresh.body.deposit).toMatchObject({ state: 'Pending' });

    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ viewing_confirmed_at: new Date(h.clock.now() - 80 * 3_600_000) })
      .where('id', '=', target.offerId)
      .execute();
    const stale = await api(h, 'POST', '/v1/viewings', b.actor, only, key());
    expect(stale.body.state).toBe('Awaiting Seller Confirmation');
    expect(stale.body.stops[0].confirmation).toBe('Pending');
  });
});

describe('showroom confirmation', () => {
  it('only the showroom that owns the task can answer it', async () => {
    const b = await newBuyer(h);
    const comp = await compositionFromRun(h, b.id);
    for (const i of comp.items)
      await h.admin
        .updateTable('catalogue.seller_offer')
        .set({ viewing_status: 'Viewable on Request' })
        .where('id', '=', i.offerId)
        .execute();
    const v = (
      await api(h, 'POST', '/v1/viewings', b.actor, { compositionId: comp.compositionId }, key())
    ).body;
    const partners = [...new Set(comp.items.map((i) => i.partnerId))];
    expect(partners.length).toBeGreaterThan(1);
    const [p1, p2] = partners as [string, string];
    const s1 = await newSeller(h, p1);
    const s2 = await newSeller(h, p2);
    const tasks1 = (await api(h, 'GET', '/v1/seller/viewing-tasks', s1)).body as {
      id: string;
      viewingRequestId: string;
    }[];
    const task1 = tasks1.find((t) => t.viewingRequestId === v.id)!.id;
    // Each showroom sees only its own queue.
    const tasks2 = (await api(h, 'GET', '/v1/seller/viewing-tasks', s2)).body as { id: string }[];
    expect(tasks2.some((t) => t.id === task1)).toBe(false);
    const wrong = await api(h, 'POST', `/v1/seller/viewing-tasks/${task1}/respond`, s2, {
      response: 'Confirmed',
    });
    expect(wrong.status).toBe(404);
    expect(
      (
        await api(h, 'POST', `/v1/seller/viewing-tasks/${task1}/respond`, b.actor, {
          response: 'Confirmed',
        })
      ).status,
    ).toBe(403);
    const ok = await api(h, 'POST', `/v1/seller/viewing-tasks/${task1}/respond`, s1, {
      response: 'Confirmed',
    });
    expect(ok.status).toBe(200);
    // Same answer again is a no-op; the opposite answer is refused.
    expect(
      (
        await api(h, 'POST', `/v1/seller/viewing-tasks/${task1}/respond`, s1, {
          response: 'Confirmed',
        })
      ).status,
    ).toBe(200);
    const flip = await api(h, 'POST', `/v1/seller/viewing-tasks/${task1}/respond`, s1, {
      response: 'Declined',
    });
    expect(flip.status).toBe(409);
    expect(flip.body.code).toBe('task_already_answered');
  });

  it('a confirmation with display confirmed refreshes the 72h freshness of those offers', async () => {
    const b = await newBuyer(h);
    const comp = await compositionFromRun(h, b.id);
    const item = comp.items[0]!;
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({
        viewing_status: 'On Display',
        viewing_confirmed_at: new Date(h.clock.now() - 100 * 3_600_000),
      })
      .where('id', '=', item.offerId)
      .execute();
    await api(
      h,
      'POST',
      '/v1/viewings',
      b.actor,
      { compositionId: comp.compositionId, itemSlotKeys: [item.slotKey] },
      key(),
    );
    const s = await newSeller(h, item.partnerId);
    const task = (await api(h, 'GET', '/v1/seller/viewing-tasks', s)).body[0];
    expect(task.products[0].onDisplay).toBe(true);
    await api(h, 'POST', `/v1/seller/viewing-tasks/${task.id}/respond`, s, {
      response: 'Confirmed',
      displayConfirmed: true,
    });
    const offer = await h.admin
      .selectFrom('catalogue.seller_offer')
      .select('viewing_confirmed_at')
      .where('id', '=', item.offerId)
      .executeTakeFirstOrThrow();
    expect(Date.now() - new Date(offer.viewing_confirmed_at!).getTime()).toBeLessThan(60_000);
  });
});

describe('a full viewing: confirm → deposit → pass → scan → complete → deposit held then refunded', () => {
  it('runs end to end with a balanced ledger, audit at every step and the attribution trail', async () => {
    const booked = await bookViewing(h);
    const v = booked.viewing;
    expect(v.state).toBe('Confirmed');
    expect(v.pass).toBeTruthy();
    const dep = await depositRow(h, v.id);
    expect(dep).toMatchObject({ state: 'Paid' });
    expect(Number(dep.amount_fils)).toBe(v.deposit!.amount);

    // Pass: stable, hash-only at rest, scannable offline.
    const pass = await api(h, 'GET', `/v1/viewings/${v.id}/pass`, booked.buyerActor);
    expect(pass.body.token).toBe(v.pass);
    const row = await viewingRow(h, v.id);
    expect(row.qr_token_hash).not.toBe(pass.body.token);
    expect(row.qr_token_hash).toMatch(/^[0-9a-f]{64}$/);

    await visit(h, booked, 'Completed');
    const done = await viewingRow(h, v.id);
    expect(done.state).toBe('Completed');
    expect(done.outcome_at).not.toBeNull();
    expect((await depositRow(h, v.id)).state).toBe('Paid'); // held for the credit window

    // Day 7 with no purchase: refunded in full, automatically.
    h.clock.advanceHours(24 * 7 + 1);
    await runJobs(h, 'viewing.release_deposit');
    await runJobs(h, 'viewing.process_refund');
    expect((await depositRow(h, v.id)).state).toBe('Refunded');

    const l = await ledger(h);
    expect(l.unbalanced).toEqual([]);
    const mine = l.forRef(dep.id);
    expect(mine.map((e) => `${e.account}:${e.direction}`).sort()).toEqual([
      'deposits_held:credit',
      'deposits_held:debit',
      'psp_clearing:credit',
      'psp_clearing:debit',
    ]);
    const pay = await h.admin
      .selectFrom('commerce.payment')
      .select('state')
      .where('viewing_deposit_id', '=', dep.id)
      .executeTakeFirstOrThrow();
    expect(pay.state).toBe('Refunded');

    expect(await auditTrail(h, 'viewing_request', v.id)).toEqual([
      '∅→Draft',
      'Draft→Awaiting Seller Confirmation',
      'Awaiting Seller Confirmation→Awaiting Deposit',
      'Awaiting Deposit→Confirmed',
      'Confirmed→Completed',
    ]);
    expect(await auditTrail(h, 'viewing_deposit', dep.id)).toEqual([
      '∅→Pending',
      'Pending→Paid',
      'Paid→Refunded',
    ]);
    const stages = await h.admin
      .selectFrom('viewing.attribution_event')
      .select('stage')
      .where('viewing_request_id', '=', v.id)
      .orderBy('at')
      .orderBy('id')
      .execute();
    expect(stages.map((s) => s.stage)).toEqual([
      'Recommended',
      'Requested',
      'Confirmed',
      'Viewed',
      'Not Purchased',
    ]);
  });

  it('the unused-deposit job refuses to run early', async () => {
    const booked = await bookViewing(h, { onlyPartners: 1 });
    await visit(h, booked, 'Completed');
    await h.admin
      .updateTable('platform.job')
      .set({ run_at: new Date(Date.now() - 1000) })
      .where('kind', '=', 'viewing.release_deposit')
      .execute();
    const r = await runJobs(h);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect((await depositRow(h, booked.viewing.id)).state).toBe('Paid');
  });
});

describe('GATE — Deposit: 5% of selected products, max AED 500; Completed/no purchase = full refund; purchase = full credit; No-show = non-refundable', () => {
  it('satisfies every clause', async () => {
    // 5% and the cap, agreeing with the database CHECK.
    const small = await bookViewing(h, { onlyPartners: 1, project: { tier: 'Essential' } });
    const smallDep = await depositRow(h, small.viewing.id);
    const base = Number(smallDep.basis_fils);
    expect(Number(smallDep.amount_fils)).toBe(Math.min(Math.floor((base * 5 + 50) / 100), 50_000));
    const big = await bookViewing(h, {
      project: { tier: 'Luxury', spec: { lengthM: 8, widthM: 6 } },
    });
    const bigDep = await depositRow(h, big.viewing.id);
    expect(bigDep.capped).toBe(true);
    expect(Number(bigDep.amount_fils)).toBe(aed(500));

    // Completed, no purchase → full refund.
    await visit(h, small, 'Completed');
    h.clock.advanceHours(24 * 7 + 1);
    await runJobs(h, 'viewing.release_deposit');
    await runJobs(h, 'viewing.process_refund');
    expect((await depositRow(h, small.viewing.id)).state).toBe('Refunded');

    // Completed, then a purchase → full credit (order at least as large as the deposit).
    const bought = await bookViewing(h, { onlyPartners: 1 });
    await visit(h, bought, 'Completed');
    const dep = await depositRow(h, bought.viewing.id);
    const res = await runAsSystem(h.ctx, (trx) =>
      creditDepositForOrder(trx, h.ctx, {
        viewingRequestId: bought.viewing.id,
        customerId: bought.customerId,
        orderGross: aed(100_000),
        now: instant(h.clock.now()),
      }),
    );
    expect(res.credit).toBe(Number(dep.amount_fils));
    expect(res.excessRefundDue).toBe(0);
    expect((await depositRow(h, bought.viewing.id)).state).toBe('Credited');

    // No-show → non-refundable, and it becomes revenue.
    const missed = await booked_noShow();
    expect((await depositRow(h, missed.viewing.id)).state).toBe('Non-refundable');
    const l = await ledger(h);
    expect(l.unbalanced).toEqual([]);
    expect(l.balance('forfeited_deposits_revenue')).toBeLessThan(0); // credit-side
  });

  async function booked_noShow() {
    const b = await bookViewing(h, { onlyPartners: 1 });
    await visit(h, b, 'No-show');
    return b;
  }
});

describe('credit on purchase', () => {
  it('credits min(deposit, order) once, refunds the excess to the deposit payment, and is idempotent', async () => {
    const b = await bookViewing(h, { onlyPartners: 1 });
    await visit(h, b, 'Completed');
    const dep = await depositRow(h, b.viewing.id);
    const amount = Number(dep.amount_fils);
    const orderGross = fils(Math.floor(amount / 2));
    const args = {
      viewingRequestId: b.viewing.id,
      customerId: b.customerId,
      orderGross,
      now: instant(h.clock.now()),
    };

    const first = await runAsSystem(h.ctx, (trx) => creditDepositForOrder(trx, h.ctx, args));
    expect(first).toEqual({ credit: orderGross, excessRefundDue: amount - orderGross });
    const second = await runAsSystem(h.ctx, (trx) => creditDepositForOrder(trx, h.ctx, args));
    expect(second).toEqual(first);

    await runJobs(h, 'viewing.process_refund');
    const refunds = await h.admin
      .selectFrom('commerce.refund')
      .select(['reason', 'state', 'amount_fils'])
      .execute();
    const mine = refunds.filter((r) => r.reason === 'deposit_excess');
    expect(
      mine.some((r) => r.state === 'Succeeded' && Number(r.amount_fils) === amount - orderGross),
    ).toBe(true);
    expect((await depositRow(h, b.viewing.id)).state).toBe('Credited');

    // A later release job finds nothing to refund: the deposit was used.
    h.clock.advanceHours(24 * 8);
    await runJobs(h, 'viewing.release_deposit');
    expect((await depositRow(h, b.viewing.id)).state).toBe('Credited');

    await runAsSystem(h.ctx, (trx) => markViewingPurchased(trx, b.viewing.id));
    await runAsSystem(h.ctx, (trx) => markViewingPurchased(trx, b.viewing.id));
    const purchased = await h.admin
      .selectFrom('viewing.attribution_event')
      .select('id')
      .where('viewing_request_id', '=', b.viewing.id)
      .where('stage', '=', 'Purchased')
      .execute();
    expect(purchased).toHaveLength(1);
    expect((await ledger(h)).unbalanced).toEqual([]);
  });

  it('gives no credit to someone else, before completion, or after the window', async () => {
    const b = await bookViewing(h, { onlyPartners: 1 });
    const base = { viewingRequestId: b.viewing.id, orderGross: aed(50_000) };
    const attempt = (customerId: string, nowMs: number) =>
      runAsSystem(h.ctx, (trx) =>
        creditDepositForOrder(trx, h.ctx, { ...base, customerId, now: instant(nowMs) }),
      );
    expect((await attempt(b.customerId, h.clock.now())).credit).toBe(0); // not Completed yet
    await visit(h, b, 'Completed');
    const stranger = (await newBuyer(h)).id;
    expect((await attempt(stranger, h.clock.now())).credit).toBe(0);
    expect((await attempt(b.customerId, h.clock.now() + 8 * 86_400_000)).credit).toBe(0);
    expect((await attempt(b.customerId, h.clock.now())).credit).toBeGreaterThan(0);
  });
});

describe('showroom pass and outcome', () => {
  it('rejects tampered, expired, foreign and not-yet-valid passes; a scan is idempotent', async () => {
    const b = await bookViewing(h, { onlyPartners: 1 });
    const pass = (await api(h, 'GET', `/v1/viewings/${b.viewing.id}/pass`, b.buyerActor)).body;
    const [partnerId, seller] = [...b.sellers.entries()][0]!;
    const scan = (s: typeof seller, token: string) =>
      api(h, 'POST', '/v1/seller/viewings/scan', s, { token });

    const tampered = `${pass.token.slice(0, -4)}AAAA`;
    expect((await scan(seller, tampered)).body.code).toBe('pass_invalid');
    const [payload] = pass.token.split('.');
    expect((await scan(seller, `${payload}.${'A'.repeat(43)}`)).body.code).toBe('pass_invalid');
    expect((await scan(seller, 'not-a-pass-at-all')).body.code).toBe('pass_invalid');

    const other = [...new Set(b.composition.items.map((i) => i.partnerId))].find(
      (p) => p !== partnerId,
    )!;
    const outsider = await newSeller(h, other);
    const foreign = await scan(outsider, pass.token);
    expect(foreign.status).toBe(404);

    const first = await scan(seller, pass.token);
    expect(first.status).toBe(200);
    const again = await scan(seller, pass.token);
    expect(again.body.checkedInAt).toBe(first.body.checkedInAt);
    expect(first.body.products.length).toBeGreaterThan(0);

    // Validity window: a day before the visit to a day after (the visit is in 2 hours).
    h.clock.advanceHours(2 + 25);
    expect((await scan(seller, pass.token)).body.code).toBe('pass_expired');
  });

  it('a pass is not valid long before the visit', async () => {
    const b = await bookViewing(h, { onlyPartners: 1, visitInHours: 72 });
    const pass = (await api(h, 'GET', `/v1/viewings/${b.viewing.id}/pass`, b.buyerActor)).body;
    const seller = [...b.sellers.values()][0]!;
    const early = await api(h, 'POST', '/v1/seller/viewings/scan', seller, { token: pass.token });
    expect(early.body.code).toBe('pass_not_yet_valid');
    h.clock.advanceHours(50); // 22h before the visit: the pass is open
    expect(
      (await api(h, 'POST', '/v1/seller/viewings/scan', seller, { token: pass.token })).status,
    ).toBe(200);
  });

  it('Completed needs a check-in; No-show forbids one; outcomes are not rewritten', async () => {
    const b = await bookViewing(h, { onlyPartners: 1 });
    const seller = [...b.sellers.values()][0]!;
    const out = (outcome: string) =>
      api(h, 'POST', `/v1/seller/viewings/${b.viewing.id}/outcome`, seller, { outcome });
    expect((await out('Completed')).body.code).toBe('not_checked_in');
    const pass = (await api(h, 'GET', `/v1/viewings/${b.viewing.id}/pass`, b.buyerActor)).body;
    await api(h, 'POST', '/v1/seller/viewings/scan', seller, { token: pass.token });
    expect((await out('No-show')).body.code).toBe('already_checked_in');
    const done = await out('Completed');
    expect(done.body).toEqual({ stopAttendance: 'Attended', viewingState: 'Completed' });
    expect((await out('Completed')).status).toBe(200); // repeated: same result
    const late = await out('No-show');
    expect(late.status).toBe(409);
    // A completed viewing cannot be scanned for a different stop's no-show to flip it.
    const scan = await api(h, 'POST', '/v1/seller/viewings/scan', seller, { token: pass.token });
    expect(scan.status).toBe(200); // the showroom that checked in may re-scan
  });

  it('with several showrooms: attended anywhere = Completed; all no-show = No-show; unattended resolves after a day', async () => {
    const multi = await bookViewing(h);
    expect(multi.sellers.size).toBeGreaterThan(1);
    const [s1, s2] = [...multi.sellers.values()] as [any, any];
    const pass = (await api(h, 'GET', `/v1/viewings/${multi.viewing.id}/pass`, multi.buyerActor))
      .body;
    await api(h, 'POST', '/v1/seller/viewings/scan', s1, { token: pass.token });
    await api(h, 'POST', `/v1/seller/viewings/${multi.viewing.id}/outcome`, s1, {
      outcome: 'Completed',
    });
    expect((await viewingRow(h, multi.viewing.id)).state).toBe('Completed');
    const lateNoShow = await api(h, 'POST', `/v1/seller/viewings/${multi.viewing.id}/outcome`, s2, {
      outcome: 'No-show',
    });
    expect(lateNoShow.status).toBe(409);

    const ghost = await bookViewing(h);
    h.clock.advanceHours(2 + 25);
    await runJobs(h, 'viewing.resolve_unattended');
    expect((await viewingRow(h, ghost.viewing.id)).state).toBe('No-show');
    expect((await depositRow(h, ghost.viewing.id)).state).toBe('Non-refundable');
    expect((await ledger(h)).unbalanced).toEqual([]);
  });

  it('a buyer who checked in but was never closed out is treated as having attended', async () => {
    const b = await bookViewing(h, { onlyPartners: 1 });
    const seller = [...b.sellers.values()][0]!;
    const pass = (await api(h, 'GET', `/v1/viewings/${b.viewing.id}/pass`, b.buyerActor)).body;
    await api(h, 'POST', '/v1/seller/viewings/scan', seller, { token: pass.token });
    h.clock.advanceHours(2 + 25);
    await runJobs(h, 'viewing.resolve_unattended');
    expect((await viewingRow(h, b.viewing.id)).state).toBe('Completed');
  });

  it('inbound visibility: a buyer cannot see another buyer’s viewing or pass', async () => {
    const b = await bookViewing(h, { onlyPartners: 1 });
    const stranger = (await newBuyer(h)).actor;
    expect((await api(h, 'GET', `/v1/viewings/${b.viewing.id}`, stranger)).status).toBe(404);
    expect((await api(h, 'GET', `/v1/viewings/${b.viewing.id}/pass`, stranger)).status).toBe(404);
    expect((await api(h, 'POST', `/v1/viewings/${b.viewing.id}/cancel`, stranger)).status).toBe(
      404,
    );
    expect(inDays(h, 1)).toBeTruthy();
  });
});
