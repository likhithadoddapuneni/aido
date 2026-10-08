import { describe, expect, it } from 'vitest';
import { dubaiInstant, previousPeriod } from '../src/lib/time.ts';

describe('previousPeriod', () => {
  it('is the month before, in Dubai', () => {
    expect(previousPeriod(new Date('2026-10-07T08:00:00Z'))).toBe('2026-09');
  });
  it('wraps January back to the previous December', () => {
    expect(previousPeriod(new Date('2027-01-15T08:00:00Z'))).toBe('2026-12');
  });
  it('uses Dubai’s calendar: 21:00 UTC on the 30th is already the 1st in Dubai', () => {
    expect(previousPeriod(new Date('2026-09-30T21:00:00Z'))).toBe('2026-09');
    expect(previousPeriod(new Date('2026-09-30T19:59:00Z'))).toBe('2026-08');
  });
});

describe('dubaiInstant', () => {
  it('reads a typed time as Dubai time', () => {
    expect(dubaiInstant('2026-10-01T09:00')).toBe('2026-10-01T05:00:00.000Z');
    expect(dubaiInstant('2026-10-01T09:00:30')).toBe('2026-10-01T05:00:30.000Z');
  });
  it('treats empty or nonsense as nothing', () => {
    expect(dubaiInstant('')).toBeUndefined();
    expect(dubaiInstant('tomorrow')).toBeUndefined();
  });
});
