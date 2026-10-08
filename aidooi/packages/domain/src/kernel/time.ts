/**
 * Domain code never reads the wall clock. Time enters through a `Clock` so that every rule
 * that depends on "now" (reservation expiry, auto-confirmation) is testable and replayable.
 */
declare const instantBrand: unique symbol;
/** Milliseconds since the Unix epoch. */
export type Instant = number & { readonly [instantBrand]: true };

export interface Clock {
  now(): Instant;
}

export const instant = (epochMs: number): Instant => {
  if (!Number.isFinite(epochMs)) throw new RangeError('Invalid instant');
  return epochMs as Instant;
};

export const HOUR_MS = 3_600_000;
export const addHours = (t: Instant, hours: number): Instant => instant(t + hours * HOUR_MS);
export const hoursBetween = (from: Instant, to: Instant): number => (to - from) / HOUR_MS;

export const fixedClock = (
  t: number,
): Clock & { set(t: number): void; advanceHours(h: number): void } => {
  let now = t;
  return {
    now: () => instant(now),
    set: (v) => {
      now = v;
    },
    advanceHours: (h) => {
      now += h * HOUR_MS;
    },
  };
};
