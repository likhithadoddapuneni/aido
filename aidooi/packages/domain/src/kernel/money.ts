/**
 * Money is an integer number of fils (1 AED = 100 fils). Floats never carry money:
 * every amount that moves, is stored, or is compared goes through this module.
 */
declare const filsBrand: unique symbol;
export type Fils = number & { readonly [filsBrand]: true };

/** Basis points, 1 bp = 0.01%. Commission and deposit rates are stored as integers. */
declare const bpsBrand: unique symbol;
export type Bps = number & { readonly [bpsBrand]: true };

export const ZERO: Fils = 0 as Fils;

export function fils(n: number): Fils {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Fils must be a safe integer, got ${n}`);
  return n as Fils;
}

/** Whole or fractional dirhams → fils. For constants and tests; never for arithmetic. */
export function aed(dirhams: number): Fils {
  return fils(Math.round(dirhams * 100));
}

export function bps(n: number): Bps {
  if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new RangeError(`Invalid bps ${n}`);
  return n as Bps;
}

/** `0.14` (as stored in `numeric(5,4)`) → 1400 bps. */
export function bpsFromRate(rate: number): Bps {
  return bps(Math.round(rate * 10_000));
}

export const add = (a: Fils, b: Fils): Fils => fils(a + b);
export const sub = (a: Fils, b: Fils): Fils => fils(a - b);
export const min = (a: Fils, b: Fils): Fils => (a < b ? a : b);
export const max = (a: Fils, b: Fils): Fils => (a > b ? a : b);

export function sum(values: Iterable<Fils>): Fils {
  let total = 0;
  for (const v of values) total += v;
  return fils(total);
}

export function times(amount: Fils, quantity: number): Fils {
  if (!Number.isInteger(quantity) || quantity < 0)
    throw new RangeError(`Invalid quantity ${quantity}`);
  return fils(amount * quantity);
}

/**
 * `amount × rate`, rounded half-up to the nearest fils. Used for commission and the viewing
 * deposit. Rounding happens once, per line, and the result is persisted — never re-derived.
 */
export function percentOf(amount: Fils, rate: Bps): Fils {
  if (amount < 0) throw new RangeError('percentOf is defined for non-negative amounts');
  return fils(Math.floor((amount * rate + 5_000) / 10_000));
}

/**
 * Split `total` across `weights` so the parts sum exactly to `total` (largest-remainder
 * method; ties go to the earlier index, so the result is deterministic).
 */
export function allocate(total: Fils, weights: readonly number[]): Fils[] {
  if (weights.length === 0) throw new RangeError('allocate needs at least one weight');
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weights.some((w) => w < 0) || weightSum <= 0) throw new RangeError('Invalid weights');
  const exact = weights.map((w) => (total * w) / weightSum);
  const parts = exact.map(Math.floor);
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder === 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    remainder -= 1;
  }
  return parts.map(fils);
}

export function formatAed(amount: Fils): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100).toLocaleString('en-AE');
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}AED ${whole}.${cents}`;
}
