import { randomUUID } from 'node:crypto';
import { claim, complete, enqueue, fail } from '@aidooi/db';
import type { AppContext } from '../context.ts';
import type { JobHandlers, RecurringJob } from './types.ts';

/** Dedupe key for the single live run of a recurring kind. */
const recurringKey = (kind: string) => `recurring:${kind}`;

/** Seed the first run of every recurring kind. Idempotent: an already-scheduled kind is left alone. */
export async function ensureRecurring(
  ctx: AppContext,
  recurring: readonly RecurringJob[],
): Promise<void> {
  for (const r of recurring) await enqueue(ctx.db, r.kind, {}, { dedupeKey: recurringKey(r.kind) });
}

export interface RunResult {
  readonly succeeded: number;
  readonly failed: number;
  /** Jobs whose lease was lost while running; their outcome is not recorded by this worker. */
  readonly lost: number;
}

const LEASE_SECONDS = 120;

/** Claim and run one batch. Exposed separately from the loop so tests can drive it deterministically. */
export async function runOnce(
  ctx: AppContext,
  handlers: JobHandlers,
  opts: { workerId?: string; limit?: number; recurring?: readonly RecurringJob[] } = {},
): Promise<RunResult> {
  const recurring = new Map((opts.recurring ?? []).map((r) => [r.kind, r]));
  const workerId = opts.workerId ?? `worker-${randomUUID()}`;
  const kinds = Object.keys(handlers);
  if (kinds.length === 0) return { succeeded: 0, failed: 0, lost: 0 };
  const jobs = await claim(ctx.db, workerId, kinds, opts.limit ?? 10, LEASE_SECONDS);

  let succeeded = 0;
  let failed = 0;
  let lost = 0;
  for (const job of jobs) {
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
      await handler(ctx, job);
      if (await complete(ctx.db, job.id, workerId)) {
        succeeded++;
        await rescheduleIfRecurring(ctx, recurring.get(job.kind));
      } else lost++;
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const outcome = await fail(ctx.db, job.id, workerId, message.slice(0, 2000));
      if (outcome === null) lost++;
      else {
        failed++;
        // A sweeper that dies after exhausting retries must not stop the platform's housekeeping.
        if (outcome === 'Dead') await rescheduleIfRecurring(ctx, recurring.get(job.kind));
      }
    }
  }
  return { succeeded, failed, lost };
}

async function rescheduleIfRecurring(ctx: AppContext, r: RecurringJob | undefined): Promise<void> {
  if (!r) return;
  await enqueue(
    ctx.db,
    r.kind,
    {},
    { dedupeKey: recurringKey(r.kind), runAt: new Date(Date.now() + r.everySeconds * 1000) },
  );
}

export interface Worker {
  stop(): Promise<void>;
  /** When the poll loop last completed an iteration — a stalled loop is how a wedged worker shows itself. */
  lastTickAt(): number;
}

/** Poll for jobs until stopped. Sleeps only when there was nothing to do. */
export function startWorker(
  ctx: AppContext,
  handlers: JobHandlers,
  opts: {
    pollMs?: number;
    recurring?: readonly RecurringJob[];
    onError?: (e: unknown) => void;
  } = {},
): Worker {
  const workerId = `worker-${randomUUID()}`;
  const pollMs = opts.pollMs ?? 2_000;
  let stopping = false;
  let lastTick = Date.now();
  const loop = (async () => {
    await ensureRecurring(ctx, opts.recurring ?? []).catch((e) => opts.onError?.(e));
    while (!stopping) {
      let busy = false;
      try {
        const r = await runOnce(ctx, handlers, {
          workerId,
          ...(opts.recurring ? { recurring: opts.recurring } : {}),
        });
        busy = r.succeeded + r.failed + r.lost > 0;
      } catch (e) {
        opts.onError?.(e);
      }
      lastTick = Date.now();
      if (!busy && !stopping) await new Promise((res) => setTimeout(res, pollMs));
    }
  })();
  return {
    lastTickAt: () => lastTick,
    async stop() {
      stopping = true;
      await loop;
    },
  };
}
