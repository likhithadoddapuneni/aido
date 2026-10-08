import { ApiProblem, NetworkError } from './problem.ts';

/**
 * A user intent is one tap on "Pay": it gets ONE idempotency key, however many times the network makes us
 * retry. The server returns the original outcome for a repeated key, so a flaky connection can never
 * charge or create twice.
 */
export interface RetryOptions {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `op` with a stable idempotency key, retrying — with the SAME key — when the outcome is unknown
 * (no response) or the server said "try again" (503, request in progress). Business refusals (4xx) are
 * never retried: they would only be refused again.
 */
export async function withIntent<T>(
  newKey: () => string,
  op: (idempotencyKey: string) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const key = newKey();
  const attempts = opts.attempts ?? 4;
  const base = opts.baseDelayMs ?? 300;
  const sleep = opts.sleep ?? wait;
  const random = opts.random ?? Math.random;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op(key);
    } catch (e) {
      last = e;
      const retryable = e instanceof NetworkError || (e instanceof ApiProblem && e.retryable);
      if (!retryable || i === attempts - 1) throw e;
      await sleep(base * 2 ** i * (0.5 + random() / 2)); // exponential, jittered
    }
  }
  throw last;
}
