import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures } from '@aidooi/db/testing';
import { aed, bps, fils, percentOf } from '@aidooi/domain';
import { createRuns } from '../src/modules/settlement/service.ts';
import { statementCsv, type StatementDetail } from '../src/modules/settlement/statements.ts';
import { sweepAutoConfirm } from '../src/modules/fulfilment/service.ts';
import { buyer, ops, seller, startHarness, type Harness } from './support/harness.ts';
import {
  balance,
  confirmDirect,
  createOrder,
  deliver,
  ledgerNetAll,
  lineRow,
} from './support/orders.ts';

const post = (h: Harness, url: string, actor: Parameters<Harness['as']>[0], payload?: unknown) =>
  h.app.inject({ method: 'POST', url, headers: h.as(actor), payload: payload ?? {} });
const get = (
  h: Harness,
  url: string,
  actor: Parameters<Harness['as']>[0],
  extra: Record<string, string> = {},
) => h.app.inject({ method: 'GET', url, headers: h.as(actor, extra) });

const periodOf = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const nextPeriod = (p: string, n = 1) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return periodOf(new Date(Date.UTC(y, m - 1 + n, 1)));
};

/** Report an issue and have ops refund it: the line ends Refunded. */
async function refund(
  h: Harness,
  o: { orderId: string; customerId: string },
  lineId: string,
  opsId: string,
) {
  const raised = await post(
    h,
    `/v1/orders/${o.orderId}/lines/${lineId}/issues`,
    buyer(o.customerId),
    { flag: 'Damaged' },
  );
  const r = await post(h, `/v1/ops/issues/${raised.json().id}/resolve`, ops(opsId, 'ops_support'), {
    resolution: 'Refunded',
    note: 'Returned',
  });
  expect(r.statusCode).toBe(200);
}

describe('worked example: two partners, a refund before settlement, a held line, clawbacks (WF-08)', () => {
  let h: Harness;
  let p1: string;
  let p2: string;
  let creator: string;
  let approver: string;
  let period: string;
  const L: Record<string, string> = {};
  let o1: Awaited<ReturnType<typeof createOrder>>;

  beforeAll(async () => {
    h = await startHarness();
    p1 = h.seeded!.partners.get('PRT-001')!;
    p2 = h.seeded!.partners.get('PRT-002')!;
    creator = await fixtures.opsUser(h.admin);
    approver = await fixtures.opsUser(h.admin);
    const at = new Date(h.clock.now());
    period = periodOf(at);

    o1 = await createOrder(h, {
      lines: [
        { partner: 'PRT-001', unitPriceFils: aed(1000), commissionBps: 1000 }, // net 900
        { partner: 'PRT-001', unitPriceFils: aed(500), commissionBps: 2000 }, //  net 400
        { partner: 'PRT-002', unitPriceFils: aed(2000), commissionBps: 1500 }, // net 1700
      ],
    });
    [L['a'], L['b'], L['c']] = o1.lineIds as [string, string, string];
    const o2 = await createOrder(h, {
      lines: [{ partner: 'PRT-001', unitPriceFils: aed(300), commissionBps: 1000 }],
    });
    L['d'] = o2.lineIds[0]!;
    const o3 = await createOrder(h, {
      lines: [{ partner: 'PRT-001', unitPriceFils: aed(400), commissionBps: 1000 }],
    });
    L['e'] = o3.lineIds[0]!;
    for (const id of [L['a']!, L['b']!, L['c']!, L['d']!, L['e']!]) await confirmDirect(h, id, at);
    await refund(h, o2, L['d']!, creator); // refunded before settlement: never eligible
    await post(h, `/v1/orders/${o3.orderId}/lines/${L['e']}/issues`, buyer(o3.customerId), {
      flag: 'Missing',
    }); // held
  });
  afterAll(() => h.close());

  const run = (p = period, actor = ops(creator, 'ops_finance')) =>
    post(h, '/v1/ops/settlement/runs', actor, { period: p });
  const runOf = (res: { json(): { runs: { partnerId: string }[] } }, partner: string) =>
    res.json().runs.find((r) => r.partnerId === partner) as Record<string, unknown>;

  it('settles eligible lines per partner, leaves the refunded and held lines out, and reports the held amount', async () => {
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(runOf(res, p1)).toMatchObject({
      state: 'Draft',
      grossFils: aed(1500),
      commissionFils: aed(100 + 100),
      adjustmentFils: 0,
      netFils: aed(1300),
    });
    expect(runOf(res, p2)).toMatchObject({
      grossFils: aed(2000),
      commissionFils: aed(300),
      netFils: aed(1700),
    });
    expect(res.json().held).toEqual([{ partnerId: p1, grossFils: aed(400) }]);

    expect(
      await Promise.all(
        ['a', 'b', 'c'].map(async (k) => (await lineRow(h, L[k]!)).settlement_state),
      ),
    ).toEqual(['Included', 'Included', 'Included']);
    expect(await lineRow(h, L['d']!)).toMatchObject({
      state: 'Refunded',
      settlement_state: 'Not Eligible',
    });
    expect((await lineRow(h, L['e']!)).settlement_state).toBe('On Hold');
    const included = await h.admin
      .selectFrom('settlement.settlement_line')
      .select('order_line_id')
      .execute();
    expect(included.map((r) => r.order_line_id).sort()).toEqual([L['a']!, L['b']!, L['c']!].sort());
  });

  it('is idempotent: re-running, or running twice at once, changes nothing and never double-counts', async () => {
    const before = await h.admin.selectFrom('settlement.settlement_line').selectAll().execute();
    const [x, y] = await Promise.all([
      createRuns(h.ctx, period, ops(creator, 'ops_finance') as never, 'c1'),
      createRuns(h.ctx, period, ops(creator, 'ops_finance') as never, 'c2'),
    ]);
    const again = await run();
    expect(again.json().runs.find((r: { partnerId: string }) => r.partnerId === p1)).toMatchObject({
      grossFils: aed(1500),
      netFils: aed(1300),
    });
    expect(x.runs.length + y.runs.length).toBeGreaterThan(0);
    expect(
      await h.admin.selectFrom('settlement.settlement_line').selectAll().execute(),
    ).toHaveLength(before.length);
    expect(
      await h.admin.selectFrom('settlement.settlement_run').select('id').execute(),
    ).toHaveLength(2);
  });

  it('a line settles once even when a later period is run before the first is approved', async () => {
    await run(nextPeriod(period));
    const sales = await h.admin
      .selectFrom('settlement.settlement_line')
      .select('order_line_id')
      .where('kind', '=', 'Sale')
      .execute();
    expect(new Set(sales.map((s) => s.order_line_id)).size).toBe(sales.length);
    expect(sales).toHaveLength(3);
  });

  it('four-eyes: builders cannot approve; admin cannot approve; only a different finance user can', async () => {
    const runs = await get(
      h,
      '/v1/ops/settlement/runs?period=' + period,
      ops(creator, 'ops_finance'),
    );
    const r1 = runs.json().items.find((r: { partnerId: string }) => r.partnerId === p1);
    const r2 = runs.json().items.find((r: { partnerId: string }) => r.partnerId === p2);
    expect(
      (await post(h, `/v1/ops/settlement/runs/${r1.id}/approve`, ops(creator, 'ops_finance')))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(h, `/v1/ops/settlement/runs/${r1.id}/approve`, ops(approver, 'ops_admin')))
        .statusCode,
    ).toBe(403);
    expect((await post(h, `/v1/ops/settlement/runs/${r1.id}/approve`, seller(p1))).statusCode).toBe(
      403,
    );
    expect(
      (
        await post(h, `/v1/ops/settlement/runs/${r1.id}/mark-paid`, ops(approver, 'ops_finance'), {
          bankReference: 'WIRE-1',
        })
      ).statusCode,
    ).toBe(409);

    const ok = await post(
      h,
      `/v1/ops/settlement/runs/${r1.id}/approve`,
      ops(approver, 'ops_finance'),
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ state: 'Approved', netFils: aed(1300) });
    expect(
      (await post(h, `/v1/ops/settlement/runs/${r1.id}/approve`, ops(approver, 'ops_finance')))
        .statusCode,
    ).toBe(409);
    await post(h, `/v1/ops/settlement/runs/${r2.id}/approve`, ops(approver, 'ops_finance'));

    // Ledger: sales moved to what we owe sellers and to our commission; the books balance.
    expect(await balance(h, `seller_payable:${p1}`)).toBe(-aed(1300));
    expect(await balance(h, `seller_payable:${p2}`)).toBe(-aed(1700));
    expect(await balance(h, 'commission_revenue')).toBe(-aed(500));
    expect(await ledgerNetAll(h)).toBe(0);
    expect(await h.admin.selectFrom('settlement.statement').select('id').execute()).toHaveLength(2);
  });

  it("paying out settles the seller's balance against the bank and marks the lines Paid", async () => {
    const r1 = (
      await get(h, '/v1/ops/settlement/runs?period=' + period, ops(creator, 'ops_finance'))
    )
      .json()
      .items.find((r: { partnerId: string }) => r.partnerId === p1);
    const paid = await post(
      h,
      `/v1/ops/settlement/runs/${r1.id}/mark-paid`,
      ops(approver, 'ops_finance'),
      { bankReference: 'WIRE-2026-0001' },
    );
    expect(paid.json()).toMatchObject({ state: 'Paid', payoutRef: 'WIRE-2026-0001' });
    expect(await balance(h, `seller_payable:${p1}`)).toBe(0);
    expect(await balance(h, 'bank')).toBe(-aed(1300));
    expect((await lineRow(h, L['a']!)).settlement_state).toBe('Paid');
    expect(
      (
        await post(h, `/v1/ops/settlement/runs/${r1.id}/mark-paid`, ops(approver, 'ops_finance'), {
          bankReference: 'WIRE-AGAIN',
        })
      ).statusCode,
    ).toBe(409);
    expect(await ledgerNetAll(h)).toBe(0);
  });

  it('a refund AFTER payout is clawed back exactly once, in a run that can absorb it', async () => {
    // Line a (AED 1000, 10% → net 900) was paid. The buyer returns it.
    await refund(h, o1, L['a']!, creator);
    expect(await lineRow(h, L['a']!)).toMatchObject({
      state: 'Refunded',
      settlement_state: 'Adjusted',
    });

    // No sales to absorb it yet: the clawback waits rather than invoicing a negative payout.
    const p2nd = nextPeriod(period);
    const waiting = await run(p2nd);
    expect(waiting.json().runs.filter((r: { partnerId: string }) => r.partnerId === p1)).toEqual(
      [],
    );
    expect(
      await h.admin
        .selectFrom('settlement.settlement_line')
        .select('id')
        .where('kind', '=', 'Clawback')
        .execute(),
    ).toHaveLength(0);

    // A new sale arrives; now the run can absorb it.
    const o4 = await createOrder(h, {
      lines: [{ partner: 'PRT-001', unitPriceFils: aed(2000), commissionBps: 1000 }],
    });
    await confirmDirect(h, o4.lineIds[0]!, new Date(h.clock.now()));
    const res = await run(p2nd);
    expect(runOf(res, p1)).toMatchObject({
      grossFils: aed(2000),
      commissionFils: aed(200),
      adjustmentFils: aed(900),
      netFils: aed(900),
    });
    expect(
      await h.admin
        .selectFrom('settlement.settlement_line')
        .select('kind')
        .where('order_line_id', '=', L['a']!)
        .orderBy('kind')
        .execute(),
    ).toEqual([{ kind: 'Clawback' }, { kind: 'Sale' }]);

    // Once only.
    await run(p2nd);
    await run(nextPeriod(period, 2));
    expect(
      await h.admin
        .selectFrom('settlement.settlement_line')
        .select('id')
        .where('kind', '=', 'Clawback')
        .execute(),
    ).toHaveLength(1);

    const r = (await get(h, `/v1/ops/settlement/runs?period=${p2nd}`, ops(creator, 'ops_finance')))
      .json()
      .items.find((x: { partnerId: string }) => x.partnerId === p1);
    expect(
      (await post(h, `/v1/ops/settlement/runs/${r.id}/approve`, ops(approver, 'ops_finance')))
        .statusCode,
    ).toBe(200);
    expect(await balance(h, `seller_payable:${p1}`)).toBe(-aed(900));
    expect(await ledgerNetAll(h)).toBe(0);
  });

  describe('statements', () => {
    it('are readable only by the owning seller, as JSON and as CSV', async () => {
      const mine = await get(h, '/v1/seller/statements', seller(p1));
      expect(mine.statusCode).toBe(200);
      expect(mine.json().items.length).toBeGreaterThanOrEqual(1);
      const stmt = mine.json().items[0];
      const theirs = await get(h, '/v1/seller/statements', seller(p2));
      expect(theirs.json().items.map((s: { id: string }) => s.id)).not.toContain(stmt.id);
      expect((await get(h, `/v1/seller/statements/${stmt.id}`, seller(p2))).statusCode).toBe(404);
      expect((await get(h, `/v1/seller/statements/${stmt.id}/csv`, seller(p2))).statusCode).toBe(
        404,
      );
      expect((await get(h, '/v1/seller/statements', null)).statusCode).toBe(401);
      expect(
        (await get(h, '/v1/seller/statements', seller(p1, undefined, 'seller_staff'))).statusCode,
      ).toBe(403);
      expect((await get(h, '/v1/seller/statements', buyer(o1.customerId))).statusCode).toBe(403);

      const detail = await get(h, `/v1/seller/statements/${stmt.id}`, seller(p1));
      expect(detail.json().netFils).toBe(stmt.netFils);
      const viaAccept = await get(h, `/v1/seller/statements/${stmt.id}`, seller(p1), {
        accept: 'text/csv',
      });
      const viaPath = await get(h, `/v1/seller/statements/${stmt.id}/csv`, seller(p1));
      for (const res of [viaAccept, viaPath]) {
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.body.split('\r\n')[0]).toBe(
          'kind,order_line_id,product,gross_aed,commission_aed,net_aed',
        );
        expect(res.body).toContain(detail.json().lines[0].orderLineId);
      }
      expect(viaAccept.body).toBe(viaPath.body);
    });

    it('CSV neutralises formula injection and quotes specials', () => {
      const s: StatementDetail = {
        id: 'i',
        runId: 'r',
        period: '2026-10',
        state: 'Approved',
        netFils: 12345,
        issuedAt: '2026-10-01T00:00:00.000Z',
        taxInvoiceNo: 'T-1',
        grossFils: 15000,
        commissionFils: 2655,
        adjustmentFils: 0,
        lines: [
          {
            orderLineId: 'l',
            kind: 'Sale',
            productName: '=HYPERLINK("http://evil","x"), "Sofa"',
            grossFils: 15000,
            commissionFils: 2655,
            netFils: 12345,
          },
        ],
      };
      const csv = statementCsv(s);
      expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x""), ""Sofa"""`);
      expect(csv).toContain('150.00,26.55,123.45');
    });
  });
});

describe('GATE: only delivered + receipt-confirmed (or eligible auto-confirmed) lines become settlement-eligible', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());

  it('settles confirmed and auto-confirmed lines, and nothing that is merely paid, prepared, dispatched or delivered', async () => {
    const p = h.seeded!.partners.get('PRT-004')!;
    const s = seller(p);
    const finance = await fixtures.opsUser(h.admin);
    const o = await createOrder(h, {
      lines: Array.from({ length: 6 }, () => ({
        partner: 'PRT-004',
        unitPriceFils: aed(100),
        commissionBps: 1000,
      })),
    });
    const [paid, prepared, dispatched, delivered, confirmed, auto] = o.lineIds as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    await post(h, `/v1/seller/order-lines/${prepared}/advance`, s, { to: 'Preparing' });
    for (const to of ['Preparing', 'Ready for Dispatch', 'Dispatched'])
      await post(h, `/v1/seller/order-lines/${dispatched}/advance`, s, { to });
    await deliver(h, s, delivered);
    await deliver(h, s, confirmed);
    await post(
      h,
      `/v1/orders/${o.orderId}/lines/${confirmed}/confirm-receipt`,
      buyer(o.customerId),
    );
    await deliver(h, s, auto);
    await h.admin
      .updateTable('fulfilment.order_line')
      .set({ delivered_at: new Date(h.clock.now() - 72 * 3_600_000 - 1) })
      .where('id', '=', auto)
      .execute();
    await sweepAutoConfirm(h.ctx);

    const res = await post(h, '/v1/ops/settlement/runs', ops(finance, 'ops_finance'), {
      period: periodOf(new Date(h.clock.now())),
    });
    expect(res.json().runs).toHaveLength(1);
    const lines = await h.admin
      .selectFrom('settlement.settlement_line')
      .select('order_line_id')
      .execute();
    expect(lines.map((l) => l.order_line_id).sort()).toEqual([confirmed, auto].sort());
    for (const id of [paid, prepared, dispatched, delivered])
      expect((await lineRow(h, id)).settlement_state).toBe('Not Eligible');
    expect(res.json().runs[0]).toMatchObject({
      grossFils: aed(200),
      commissionFils: aed(20),
      netFils: aed(180),
    });
  });

  it('a line confirmed after the period ends waits for a later period', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-005', unitPriceFils: aed(100) }] });
    await confirmDirect(h, o.lineIds[0]!, new Date(Date.UTC(2031, 5, 10)));
    const finance = await fixtures.opsUser(h.admin);
    const early = await post(h, '/v1/ops/settlement/runs', ops(finance, 'ops_finance'), {
      period: '2031-05',
    });
    expect(
      early
        .json()
        .runs.filter(
          (r: { partnerId: string }) => r.partnerId === h.seeded!.partners.get('PRT-005'),
        ),
    ).toEqual([]);
    const ontime = await post(h, '/v1/ops/settlement/runs', ops(finance, 'ops_finance'), {
      period: '2031-06',
    });
    expect(ontime.json().runs).toHaveLength(1);
  });

  it('validates the period and the caller', async () => {
    const finance = await fixtures.opsUser(h.admin);
    expect(
      (await post(h, '/v1/ops/settlement/runs', ops(finance, 'ops_finance'), { period: '2026-13' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(h, '/v1/ops/settlement/runs', ops(finance, 'ops_support'), { period: '2026-10' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await post(h, '/v1/ops/settlement/runs', seller(h.seeded!.partners.get('PRT-001')!), {
          period: '2026-10',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('a line refunded while its run is still a Draft', () => {
  it('is netted by a clawback in the same run at approval, so the approved totals are exactly what is owed', async () => {
    const h = await startHarness();
    try {
      const creator = await fixtures.opsUser(h.admin);
      const approver = await fixtures.opsUser(h.admin);
      const p = h.seeded!.partners.get('PRT-003')!;
      const at = new Date(h.clock.now());
      const o = await createOrder(h, {
        lines: [
          { partner: 'PRT-003', unitPriceFils: aed(1000), commissionBps: 1000 },
          { partner: 'PRT-003', unitPriceFils: aed(600), commissionBps: 1000 },
        ],
      });
      for (const id of o.lineIds) await confirmDirect(h, id, at);
      const period = periodOf(at);
      await post(h, '/v1/ops/settlement/runs', ops(creator, 'ops_finance'), { period });
      await refund(h, o, o.lineIds[0]!, creator);

      const runs = (
        await get(h, '/v1/ops/settlement/runs?period=' + period, ops(creator, 'ops_finance'))
      ).json().items;
      const approved = await post(
        h,
        `/v1/ops/settlement/runs/${runs[0].id}/approve`,
        ops(approver, 'ops_finance'),
      );
      expect(approved.json()).toMatchObject({
        grossFils: aed(1600),
        commissionFils: aed(160),
        adjustmentFils: aed(900),
        netFils: aed(540),
      });
      expect(await balance(h, `seller_payable:${p}`)).toBe(-aed(540));
      expect(await ledgerNetAll(h)).toBe(0);
      expect((await lineRow(h, o.lineIds[0]!)).settlement_state).toBe('Adjusted');
    } finally {
      await h.close();
    }
  });

  it('a run with nothing left to pay cannot be paid out', async () => {
    const h = await startHarness();
    try {
      const creator = await fixtures.opsUser(h.admin);
      const approver = await fixtures.opsUser(h.admin);
      const at = new Date(h.clock.now());
      const o = await createOrder(h, { lines: [{ partner: 'PRT-003', unitPriceFils: aed(500) }] });
      await confirmDirect(h, o.lineIds[0]!, at);
      const period = periodOf(at);
      await post(h, '/v1/ops/settlement/runs', ops(creator, 'ops_finance'), { period });
      await refund(h, o, o.lineIds[0]!, creator);
      const [run] = (
        await get(h, '/v1/ops/settlement/runs?period=' + period, ops(creator, 'ops_finance'))
      ).json().items;
      expect(
        (
          await post(h, `/v1/ops/settlement/runs/${run.id}/approve`, ops(approver, 'ops_finance'))
        ).json().netFils,
      ).toBe(0);
      const pay = await post(
        h,
        `/v1/ops/settlement/runs/${run.id}/mark-paid`,
        ops(approver, 'ops_finance'),
        { bankReference: 'NONE-1' },
      );
      expect(pay.statusCode).toBe(422);
      expect(pay.json().code).toBe('nothing_to_pay');
    } finally {
      await h.close();
    }
  });
});

describe('PROPERTY: persisted run totals equal Σ(gross − commission) over included lines', () => {
  it('holds for arbitrary mixes of confirmed, held and refunded-before-settlement lines', async () => {
    const h = await startHarness();
    try {
      const finance = await fixtures.opsUser(h.admin);
      const partner = h.seeded!.partners.get('PRT-006')!;
      let iteration = 0;
      const lineArb = fc.record({
        unit: fc.integer({ min: 1, max: 500_000 }),
        qty: fc.integer({ min: 1, max: 3 }),
        rate: fc.integer({ min: 0, max: 3000 }),
        fate: fc.constantFrom('confirm', 'confirm', 'hold', 'refund'),
      });
      await fc.assert(
        fc.asyncProperty(fc.array(lineArb, { minLength: 1, maxLength: 5 }), async (lines) => {
          const i = iteration++;
          const at = new Date(Date.UTC(2040 + Math.floor(i / 12), i % 12, 15));
          const o = await createOrder(h, {
            lines: lines.map((l) => ({
              partner: 'PRT-006',
              unitPriceFils: l.unit,
              quantity: l.qty,
              commissionBps: l.rate,
            })),
          });
          let net = 0;
          let gross = 0;
          let commission = 0;
          let held = 0;
          for (const [k, l] of lines.entries()) {
            const id = o.lineIds[k]!;
            const g = l.unit * l.qty;
            await confirmDirect(h, id, at);
            if (l.fate === 'confirm') {
              const c = percentOf(fils(g), bps(l.rate));
              gross += g;
              commission += c;
              net += g - c;
            } else {
              const raised = await post(
                h,
                `/v1/orders/${o.orderId}/lines/${id}/issues`,
                buyer(o.customerId),
                { flag: 'Damaged' },
              );
              if (l.fate === 'hold') held += g;
              else
                await post(
                  h,
                  `/v1/ops/issues/${raised.json().id}/resolve`,
                  ops(finance, 'ops_support'),
                  { resolution: 'Refunded', note: 'r' },
                );
            }
          }
          const res = await post(h, '/v1/ops/settlement/runs', ops(finance, 'ops_finance'), {
            period: periodOf(at),
          });
          const mine = res.json().runs.find((r: { partnerId: string }) => r.partnerId === partner);
          if (gross === 0) {
            expect(mine).toBeUndefined();
          } else {
            expect(mine).toMatchObject({
              grossFils: gross,
              commissionFils: commission,
              adjustmentFils: 0,
              netFils: net,
            });
          }
          const reported = (res.json().held as { partnerId: string; grossFils: number }[])
            .filter((x) => x.partnerId === partner)
            .reduce((t, x) => t + x.grossFils, 0);
          expect(reported).toBeGreaterThanOrEqual(held); // earlier iterations' holds remain held too
        }),
        { numRuns: 8 },
      );
      expect(await ledgerNetAll(h)).toBe(0);
    } finally {
      await h.close();
    }
  }, 120_000);
});
