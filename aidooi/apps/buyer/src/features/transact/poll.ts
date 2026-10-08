export interface PollOptions<T> {
  /** Return a value when done, or `undefined` to keep waiting. */
  readonly probe: () => Promise<T | undefined>;
  readonly intervalMs?: number;
  readonly maxMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly signal?: { cancelled: boolean };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ask until the answer is known. Used while the buyer is at their bank (3-D Secure) or a seller is
 * confirming: the server is the authority and the outcome arrives out of band, so the app asks again
 * rather than guessing. Gives up (returns `undefined`) after `maxMs`; a transient failure of one probe
 * does not end the wait.
 */
export async function pollUntil<T>(o: PollOptions<T>): Promise<T | undefined> {
  const interval = o.intervalMs ?? 3000;
  const max = o.maxMs ?? 5 * 60_000;
  const sleep = o.sleep ?? wait;
  const now = o.now ?? Date.now;
  const started = now();
  while (!o.signal?.cancelled && now() - started < max) {
    try {
      const v = await o.probe();
      if (v !== undefined) return v;
    } catch {
      /* try again: one failed look is not an outcome */
    }
    await sleep(interval);
  }
  return undefined;
}
