import type { ClaimedJob } from '@aidooi/db';
import type { AppContext } from '../context.ts';

/**
 * A handler must be idempotent: a job can run more than once (a worker may die after acting but
 * before acknowledging). It signals failure by throwing; the runner retries with backoff and
 * eventually buries the job as Dead.
 */
export type JobHandler = (ctx: AppContext, job: ClaimedJob) => Promise<void>;
export type JobHandlers = Readonly<Record<string, JobHandler>>;

/** A job kind that must always be scheduled: after each run it enqueues its own next run. */
export interface RecurringJob {
  readonly kind: string;
  readonly everySeconds: number;
}
