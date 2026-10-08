import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addHours,
  aed,
  allocate,
  bps,
  bpsFromRate,
  fils,
  fixedClock,
  formatAed,
  formatCatalogueId,
  instant,
  offerId,
  percentOf,
  productId,
  sum,
  times,
} from '../src/index.ts';

describe('money', () => {
  it('rejects non-integers: floats never carry money', () => {
    expect(() => fils(10.5)).toThrow(RangeError);
    expect(() => fils(Number.NaN)).toThrow(RangeError);
    expect(aed(12.34)).toBe(1234);
    expect(aed(0.1 + 0.2)).toBe(30);
  });

  it('percentOf rounds half-up to the fil, once', () => {
    expect(percentOf(fils(1_000), bps(1400))).toBe(140);
    expect(percentOf(fils(1), bps(5000))).toBe(1); // 0.5 → 1
    expect(percentOf(fils(3), bps(1666))).toBe(0); // 0.4998 → 0
    expect(percentOf(fils(250_000), bpsFromRate(0.13))).toBe(32_500);
    expect(() => percentOf(fils(-1), bps(100))).toThrow();
  });

  it('bps is validated', () => {
    expect(() => bps(-1)).toThrow();
    expect(() => bps(10_001)).toThrow();
    expect(() => bps(1.5)).toThrow();
    expect(bpsFromRate(0.1234)).toBe(1234);
  });

  it('allocate splits exactly, never loses a fil, and is deterministic', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          const parts = allocate(fils(total), weights);
          expect(sum(parts)).toBe(total);
          expect(parts.every((p) => p >= 0)).toBe(true);
          expect(allocate(fils(total), weights)).toEqual(parts);
        },
      ),
    );
    expect(allocate(fils(100), [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('allocate is proportional within one fil', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 2, maxLength: 8 }),
        (total, weights) => {
          const parts = allocate(fils(total), weights);
          const w = weights.reduce((a, b) => a + b, 0);
          parts.forEach((p, i) =>
            expect(Math.abs(p - (total * (weights[i] as number)) / w)).toBeLessThan(1),
          );
        },
      ),
    );
  });

  it('times and sum are exact', () => {
    expect(times(fils(1999), 3)).toBe(5997);
    expect(() => times(fils(1), -1)).toThrow();
    expect(sum([fils(1), fils(2), fils(3)])).toBe(6);
  });

  it('formats AED', () => {
    expect(formatAed(fils(123_456))).toBe('AED 1,234.56');
    expect(formatAed(fils(5))).toBe('AED 0.05');
  });
});

describe('ids', () => {
  it('formats and validates AID-DATA-005 identifiers', () => {
    expect(formatCatalogueId('AID', 12)).toBe('AID-00000012');
    expect(productId('AID-00000012')).toBe('AID-00000012');
    expect(() => productId('AIO-00000012')).toThrow(TypeError);
    expect(() => offerId('AIO-1')).toThrow(TypeError);
    expect(() => formatCatalogueId('AID', 0)).toThrow(RangeError);
  });
});

describe('time', () => {
  it('a fixed clock is the only source of now', () => {
    const c = fixedClock(1_000);
    expect(c.now()).toBe(1_000);
    c.advanceHours(1);
    expect(c.now()).toBe(1_000 + 3_600_000);
    expect(addHours(instant(0), 24)).toBe(86_400_000);
  });
});
