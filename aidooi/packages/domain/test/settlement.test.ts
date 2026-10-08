import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { aed, fils, orderLineId, partnerId, settle, type SettlementLine } from '../src/index.ts';

const L = (
  id: string,
  partner: string,
  gross: number,
  commission: number,
  over: Partial<SettlementLine> = {},
): SettlementLine => ({
  lineId: orderLineId(id),
  partnerId: partnerId(partner),
  gross: aed(gross),
  commission: aed(commission),
  state: 'Receipt Confirmed',
  settlement: 'Eligible',
  settledInRun: null,
  clawedBack: false,
  ...over,
});

describe('WF-08 settlement: gross eligible − commission − clawbacks = net payable', () => {
  it('settles only eligible, receipt-confirmed lines', () => {
    const [r] = settle([
      L('a', 'P1', 2205, 286.65),
      L('b', 'P1', 1000, 130, { settlement: 'Not Eligible', state: 'Other' }),
      L('c', 'P1', 500, 65, { settlement: 'On Hold' }),
    ]);
    expect(r).toMatchObject({
      gross: aed(2205),
      commission: aed(286.65),
      net: aed(1918.35),
      held: aed(500),
    });
    expect(r?.entries).toHaveLength(1);
  });

  it('REGRESSION: a refund before settlement costs the partner nothing (the prototype subtracted it)', () => {
    const [r] = settle([
      L('a', 'P1', 1000, 140),
      L('refunded-before', 'P1', 800, 112, { state: 'Refunded', settlement: 'Not Eligible' }),
    ]);
    expect(r?.net).toBe(aed(860));
    expect(r?.clawbacks).toBe(0);
  });

  it('a line paid in an earlier run and refunded since is clawed back exactly once', () => {
    const paid = L('x', 'P1', 1000, 140, {
      state: 'Refunded',
      settlement: 'Adjusted',
      settledInRun: '2026-09',
    });
    const [first] = settle([L('a', 'P1', 500, 70), paid]);
    expect(first).toMatchObject({ salesNet: aed(430), clawbacks: aed(860), net: aed(-430) });
    expect(first?.entries.map((e) => e.kind).sort()).toEqual(['Clawback', 'Sale']);
    const [again] = settle([{ ...paid, clawedBack: true }]);
    expect(again).toMatchObject({ clawbacks: 0, net: 0 });
  });

  it('keeps partners separate and orders output deterministically', () => {
    const out = settle([L('a', 'P2', 100, 10), L('b', 'P1', 200, 20), L('c', 'P2', 300, 30)]);
    expect(out.map((r) => [r.partnerId, r.net])).toEqual([
      ['P1', aed(180)],
      ['P2', aed(360)],
    ]);
  });

  it('PROPERTY: net = Σ(gross − commission) over sales − Σ over clawbacks; entries reconcile to the total', () => {
    const lineArb = fc.record({
      gross: fc.integer({ min: 100, max: 5_000_000 }),
      rate: fc.integer({ min: 0, max: 3000 }),
      kind: fc.constantFrom('sale', 'held', 'prior-refund', 'early-refund', 'ineligible'),
    });
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 30 }), (xs) => {
        const lines = xs.map((x, i): SettlementLine => {
          const commission = fils(Math.floor((x.gross * x.rate) / 10_000));
          const base = {
            lineId: orderLineId(`l${i}`),
            partnerId: partnerId('P'),
            gross: fils(x.gross),
            commission,
            clawedBack: false,
          };
          switch (x.kind) {
            case 'sale':
              return {
                ...base,
                state: 'Receipt Confirmed',
                settlement: 'Eligible',
                settledInRun: null,
              };
            case 'held':
              return {
                ...base,
                state: 'Receipt Confirmed',
                settlement: 'On Hold',
                settledInRun: null,
              };
            case 'prior-refund':
              return {
                ...base,
                state: 'Refunded',
                settlement: 'Adjusted',
                settledInRun: '2026-08',
              };
            case 'early-refund':
              return { ...base, state: 'Refunded', settlement: 'Not Eligible', settledInRun: null };
            default:
              return { ...base, state: 'Other', settlement: 'Not Eligible', settledInRun: null };
          }
        });
        const [r] = settle(lines);
        const net = (l: SettlementLine) => l.gross - l.commission;
        const sales = lines
          .filter((l) => l.settlement === 'Eligible')
          .reduce((t, l) => t + net(l), 0);
        const claw = lines
          .filter((l) => l.settlement === 'Adjusted')
          .reduce((t, l) => t + net(l), 0);
        expect(r?.net).toBe(sales - claw);
        const entryTotal = (r?.entries ?? []).reduce(
          (t, e) => t + (e.kind === 'Sale' ? e.amount : -e.amount),
          0,
        );
        expect(entryTotal).toBe(r?.net);
        expect(r?.gross).toBe(
          lines.filter((l) => l.settlement === 'Eligible').reduce((t, l) => t + l.gross, 0),
        );
      }),
    );
  });
});
