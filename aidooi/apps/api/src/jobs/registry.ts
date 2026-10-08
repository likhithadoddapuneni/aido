import { commerceJobs } from '../modules/commerce/jobs.ts';
import { fulfilmentJobs } from '../modules/fulfilment/jobs.ts';
import { platformJobs } from '../modules/platform-jobs.ts';
import { settlementJobs } from '../modules/settlement/jobs.ts';
import { viewingJobs } from '../modules/viewing/jobs.ts';
import type { JobHandlers, RecurringJob } from './types.ts';

/**
 * Every background job kind and its handler. Kinds are namespaced by module (`viewing.…`); two
 * modules claiming the same kind is a start-up error, not a silent override.
 */
export function allJobHandlers(): JobHandlers {
  const merged: Record<string, JobHandlers[string]> = {};
  for (const set of [platformJobs, commerceJobs, viewingJobs, fulfilmentJobs, settlementJobs]) {
    for (const [kind, handler] of Object.entries(set)) {
      if (merged[kind]) throw new Error(`Duplicate job handler for kind "${kind}"`);
      merged[kind] = handler;
    }
  }
  return merged;
}

/**
 * Sweepers that must run forever. Each is a normal job kind; the runner re-schedules it after every
 * run and `ensureRecurring` seeds the first run at start-up, so a database restore or a deploy can
 * never leave the platform without its housekeeping. Every kind listed here must have a handler.
 */
export const RECURRING: readonly RecurringJob[] = [
  { kind: 'platform.ensure_audit_partitions', everySeconds: 6 * 3600 },
  { kind: 'platform.purge_expired', everySeconds: 3600 },
  { kind: 'platform.relay_outbox', everySeconds: 5 },
  { kind: 'commerce.expire_reservations', everySeconds: 60 },
  { kind: 'commerce.sweep_confirmations', everySeconds: 60 },
  { kind: 'commerce.resume_payments', everySeconds: 60 },
  { kind: 'fulfilment.sweep_auto_confirm', everySeconds: 15 * 60 },
  { kind: 'fulfilment.notify_overdue', everySeconds: 3600 },
];
