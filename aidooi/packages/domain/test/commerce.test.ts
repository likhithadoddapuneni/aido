import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HOUR_MS,
  aed,
  assertCapturable,
  bps,
  buildStops,
  creditWindowElapsed,
  dispositionAfter,
  fils,
  instant,
  isConfirmationFresh,
  needsExplicitConfirmation,
  offerId,
  partnerId,
  partnerLocationId,
  planRefund,
  planReservation,
  productId,
  quoteDeposit,
  splitOrder,
  sum,
  validateLine,
  type CartLine,
  type Offer,
  type PricedLine,
} from '../src/index.ts';
import { seedCatalogue } from '../src/testing/index.ts';

const NOW = instant(1_800_000_000_000);
const { catalogue } = seedCatalogue();
const baseOffer = catalogue.offers.find((o) => o.availability === 'In Stock') as Offer;

const offer = (over: Partial<Offer> = {}): Offer => ({
  ...baseOffer,
  sellingPrice: aed(1000),
  stockQty: 3,
  ...over,
});
const cart = (over: Partial<CartLine> = {}): CartLine => ({
  offerId: baseOffer.id,
  partnerId: baseOffer.partnerId,
  quantity: 1,
  displayedUnitPrice: aed(1000),
  ...over,
});

describe('AID-LOG-012 viewing deposit — 5%, capped at AED 500 per request', () => {
  it.each([
    [aed(1_000), aed(50), false],
    [aed(9_999), aed(499.95), false],
    [aed(10_000), aed(500), false],
    [aed(10_001), aed(500), true],
    [aed(80_000), aed(500), true],
  ])('selected products %s → deposit %s (capped: %s)', (price, amount, capped) => {
    const q = quoteDeposit([{ offer: { sellingPrice: price }, qty: 1 }]);
    expect(q.amount).toBe(amount);
    expect(q.capped).toBe(capped);
  });

  it('sums quantities across products', () => {
    const q = quoteDeposit([
      { offer: { sellingPrice: aed(1000) }, qty: 2 },
      { offer: { sellingPrice: aed(500) }, qty: 1 },
    ]);
    expect(q.base).toBe(aed(2500));
    expect(q.amount).toBe(aed(125));
  });

  it('PROPERTY: never exceeds the cap and never exceeds 5%', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.integer({ min: 100, max: 5_000_000 }), fc.integer({ min: 1, max: 5 })),
          { minLength: 1, maxLength: 20 },
        ),
        (xs) => {
          const q = quoteDeposit(xs.map(([p, qty]) => ({ offer: { sellingPrice: fils(p) }, qty })));
          expect(q.amount).toBeLessThanOrEqual(aed(500));
          expect(q.amount).toBeLessThanOrEqual(Math.ceil(q.base * 0.05));
        },
      ),
    );
  });

  it('disposition: completed → held then credit/refund; no-show → non-refundable; cancelled → full refund', () => {
    const held = dispositionAfter('Completed', NOW);
    expect(held).toEqual({ kind: 'hold', until: NOW + 7 * 24 * HOUR_MS });
    expect(dispositionAfter('No-show', NOW)).toEqual({ kind: 'forfeit' });
    expect(dispositionAfter('Cancelled', NOW)).toEqual({ kind: 'refund' });
    if (held.kind === 'hold') {
      expect(creditWindowElapsed(held.until, instant(held.until - 1))).toBe(false);
      expect(creditWindowElapsed(held.until, held.until)).toBe(true);
    }
  });
});

describe('viewing stops (AID-LOG-012 §3–4)', () => {
  const mk = (id: string, loc: string, over: Partial<Offer> = {}) => ({
    offer: offer({ id: offerId(id), ...over }),
    locationId: partnerLocationId(loc),
    ref: id,
  });

  it('groups by physical location, minimising stops', () => {
    const stops = buildStops(
      [mk('AIO-00000001', 'A'), mk('AIO-00000002', 'B'), mk('AIO-00000003', 'A')],
      NOW,
    );
    expect(stops).toHaveLength(2);
    expect(stops[0]?.products.map((p) => p.ref)).toEqual(['AIO-00000001', 'AIO-00000003']);
    expect(stops.map((s) => s.stopNo)).toEqual([1, 2]);
  });

  it('only a fresh confirmation on a displayed product skips seller action', () => {
    const fresh = mk('AIO-00000001', 'A', {
      viewingStatus: 'On Display',
      viewingConfirmedAt: instant(NOW - 24 * HOUR_MS),
    });
    const stale = mk('AIO-00000002', 'B', {
      viewingStatus: 'On Display',
      viewingConfirmedAt: instant(NOW - 100 * HOUR_MS),
    });
    const onRequest = mk('AIO-00000003', 'C', {
      viewingStatus: 'Viewable on Request',
      viewingConfirmedAt: NOW,
    });
    const never = mk('AIO-00000004', 'D', {
      viewingStatus: 'On Display',
      viewingConfirmedAt: null,
    });
    const [a, b, c, d] = buildStops([fresh, stale, onRequest, never], NOW);
    expect([a, b, c, d].map((s) => s?.needsSellerConfirmation)).toEqual([false, true, true, true]);
    expect(isConfirmationFresh(fresh.offer, NOW)).toBe(true);
    expect(isConfirmationFresh(stale.offer, NOW)).toBe(false);
  });
});

describe('AID-LOG-014 §3 — final seller validation and the 24-hour window', () => {
  it('confirms, or names exactly why not', () => {
    expect(validateLine(cart(), offer()).status).toBe('Confirmed');
    expect(validateLine(cart({ quantity: 4 }), offer({ stockQty: 3 })).status).toBe(
      'Stock Unavailable',
    );
    expect(validateLine(cart(), offer({ availability: 'Out of Stock', stockQty: 0 })).status).toBe(
      'Stock Unavailable',
    );
    expect(validateLine(cart(), offer({ offerStatus: 'Inactive' })).status).toBe('Offer Inactive');
    expect(validateLine(cart(), undefined).status).toBe('Offer Inactive');
    const changed = validateLine(cart(), offer({ sellingPrice: aed(1100) }));
    expect(changed.status).toBe('Price Changed');
    expect(changed.currentUnitPrice).toBe(aed(1100));
  });

  it('the window runs 24h from the LAST seller confirmation', () => {
    const lines = [validateLine(cart(), offer())];
    const plan = planReservation(lines, NOW);
    expect(plan.outcome).toBe('Active');
    expect(plan.expiresAt).toBe(NOW + 24 * HOUR_MS);
  });

  it('GATE: no capture while any seller validation fails, a price awaits approval, or the window expired', () => {
    const ok = planReservation([validateLine(cart(), offer())], NOW);
    expect(() => assertCapturable(ok, instant(NOW + 24 * HOUR_MS))).not.toThrow();
    expect(() => assertCapturable(ok, instant(NOW + 24 * HOUR_MS + 1))).toThrowError(/expired/);

    const failed = planReservation(
      [validateLine(cart(), offer()), validateLine(cart(), offer({ stockQty: 0 }))],
      NOW,
    );
    expect(failed.outcome).toBe('Rebuild Required');
    expect(() => assertCapturable(failed, NOW)).toThrowError(/rebuilt/);

    const priced = planReservation([validateLine(cart(), offer({ sellingPrice: aed(1200) }))], NOW);
    expect(priced.outcome).toBe('Approval Required');
    expect(priced.total).toBe(aed(1200));
    expect(() => assertCapturable(priced, NOW)).toThrowError(/approve/);
  });
});

describe('explicit seller confirmation (ADR-028)', () => {
  it('is needed only when stock is thin', () => {
    expect(needsExplicitConfirmation({ availability: 'Low Stock' })).toBe(true);
    expect(needsExplicitConfirmation({ availability: 'In Stock' })).toBe(false);
    expect(needsExplicitConfirmation({ availability: 'Out of Stock' })).toBe(false);
  });
});

describe('order split and locked snapshots (AID-LOG-014 §7)', () => {
  const line = (
    i: number,
    partner: string,
    unit: number,
    qty: number,
    rate: number,
  ): PricedLine => ({
    productId: productId(`AID-0000000${i}`),
    offerId: offerId(`AIO-0000000${i}`),
    partnerId: partnerId(partner),
    productName: `Item ${i}`,
    quantity: qty,
    unitPrice: aed(unit),
    commissionRate: bps(rate),
  });

  it('splits one payment into per-seller orders; every line carries gross and commission', () => {
    const o = splitOrder(
      [line(1, 'P1', 2205, 1, 1300), line(2, 'P2', 500, 2, 1800), line(3, 'P1', 100, 3, 1300)],
      aed(0),
    );
    expect(o.sellerOrders.map((s) => s.partnerId)).toEqual(['P1', 'P2']);
    expect(o.gross).toBe(aed(2205 + 1000 + 300));
    const l1 = o.sellerOrders[0]?.lines[0]?.snapshot;
    expect(l1?.grossLine).toBe(aed(2205));
    expect(l1?.commission).toBe(aed(286.65));
    expect(o.payable).toBe(o.gross);
  });

  it('the deposit credit reduces what is captured, never below zero or above the gross', () => {
    const o = splitOrder([line(1, 'P1', 1000, 1, 1400)], aed(50));
    expect(o.payable).toBe(aed(950));
    expect(o.depositCredit).toBe(aed(50));
    const small = splitOrder([line(1, 'P1', 30, 1, 1400)], aed(50));
    expect(small.payable).toBe(0);
    expect(small.depositCredit).toBe(aed(30));
  });

  it('rejects an empty order', () => {
    expect(() => splitOrder([], aed(0))).toThrow();
  });

  it('PROPERTY: Σ lines = Σ seller orders = gross, and gross − credit = payable', () => {
    const lineArb = fc.record({
      partner: fc.constantFrom('P1', 'P2', 'P3'),
      unit: fc.integer({ min: 1, max: 20_000 }),
      qty: fc.integer({ min: 1, max: 6 }),
      rate: fc.integer({ min: 0, max: 3000 }),
    });
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 50_000 }),
        (ls, credit) => {
          const o = splitOrder(
            ls.map((l, i) => line(i % 9, l.partner, l.unit, l.qty, l.rate)),
            aed(credit),
          );
          const lineSum = sum(
            o.sellerOrders.flatMap((s) => s.lines.map((l) => l.snapshot.grossLine)),
          );
          expect(lineSum).toBe(o.gross);
          expect(sum(o.sellerOrders.map((s) => s.gross))).toBe(o.gross);
          expect(o.payable + o.depositCredit).toBe(o.gross);
          for (const s of o.sellerOrders)
            for (const l of s.lines)
              expect(l.snapshot.commission).toBeLessThanOrEqual(l.snapshot.grossLine);
        },
      ),
    );
  });
});

describe('refund routing (ADR-031)', () => {
  const args = (over: Partial<Parameters<typeof planRefund>[0]> = {}) => ({
    refundAmount: aed(300),
    captured: aed(950),
    alreadyRefundedToCapture: aed(0),
    depositCredited: aed(50),
    alreadyRefundedToDeposit: aed(0),
    ...over,
  });

  it('returns to the capture first, then the deposit payment', () => {
    expect(planRefund(args())).toEqual({ toCapture: aed(300), toDeposit: aed(0) });
    expect(planRefund(args({ refundAmount: aed(1000) }))).toEqual({
      toCapture: aed(950),
      toDeposit: aed(50),
    });
    expect(
      planRefund(args({ refundAmount: aed(100), alreadyRefundedToCapture: aed(900) })),
    ).toEqual({ toCapture: aed(50), toDeposit: aed(50) });
  });

  it('refuses to refund more than was paid', () => {
    expect(() => planRefund(args({ refundAmount: aed(1001) }))).toThrowError(/exceeds/);
  });

  it('PROPERTY: the plan always sums to the refund and never over-draws either payment', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (captured, deposit, a, b, c) => {
          const r1 = Math.floor(captured * a);
          const r2 = Math.floor(deposit * b);
          const room = captured - r1 + (deposit - r2);
          const refund = Math.floor(room * c);
          const plan = planRefund({
            refundAmount: fils(refund),
            captured: fils(captured),
            alreadyRefundedToCapture: fils(r1),
            depositCredited: fils(deposit),
            alreadyRefundedToDeposit: fils(r2),
          });
          expect(plan.toCapture + plan.toDeposit).toBe(refund);
          expect(plan.toCapture).toBeLessThanOrEqual(captured - r1);
          expect(plan.toDeposit).toBeLessThanOrEqual(deposit - r2);
        },
      ),
    );
  });
});
