import { sql, type Kysely } from 'kysely';
import type { DB } from './generated/db.ts';

export interface EnqueueOptions {
  readonly runAt?: Date;
  readonly maxAttempts?: number;
  /** While a job with this key is Pending, Running or Failed, enqueueing it again is a no-op. */
  readonly dedupeKey?: string;
}

export interface ClaimedJob {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** Pass a transaction to make the job atomic with the change that caused it. Returns the id, or null if deduplicated. */
export async function enqueue(
  db: Kysely<DB>,
  kind: string,
  payload: unknown,
  options: EnqueueOptions = {},
): Promise<string | null> {
  const { rows } = await sql<{ id: string }>`
    INSERT INTO platform.job (kind, payload, run_at, max_attempts, dedupe_key)
    VALUES (${kind}, ${JSON.stringify(payload)}::jsonb, coalesce(${options.runAt ?? null}::timestamptz, now()),
            ${options.maxAttempts ?? 8}, ${options.dedupeKey ?? null})
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('Pending', 'Running', 'Failed')
    DO NOTHING
    RETURNING id`.execute(db);
  return rows[0]?.id ?? null;
}

/**
 * Leases up to `limit` runnable jobs to `workerId` for `leaseSeconds`. FOR UPDATE SKIP LOCKED means
 * concurrent workers never receive the same job. A job whose lease expired (worker died) becomes
 * claimable again; if it has no attempts left it is buried instead.
 */
export async function claim(
  db: Kysely<DB>,
  workerId: string,
  kinds: readonly string[],
  limit: number,
  leaseSeconds: number,
): Promise<ClaimedJob[]> {
  await sql`
    UPDATE platform.job
       SET status = 'Dead', locked_by = NULL, locked_until = NULL,
           last_error = coalesce(last_error, 'lease expired with no attempts left')
     WHERE status = 'Running' AND locked_until < now() AND attempts >= max_attempts
       AND kind = ANY(${kinds as string[]})`.execute(db);

  const { rows } = await sql<{
    id: string;
    kind: string;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  }>`
    WITH picked AS (
      SELECT id FROM platform.job
       WHERE kind = ANY(${kinds as string[]})
         AND ((status IN ('Pending', 'Failed') AND run_at <= now())
              OR (status = 'Running' AND locked_until < now()))
       ORDER BY run_at, created_at
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED)
    UPDATE platform.job j
       SET status = 'Running', attempts = j.attempts + 1, locked_by = ${workerId},
           locked_until = now() + make_interval(secs => ${leaseSeconds})
      FROM picked
     WHERE j.id = picked.id
    RETURNING j.id, j.kind, j.payload, j.attempts, j.max_attempts`.execute(db);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}

/** False means the lease was lost (expired and reclaimed); the result must not be trusted as final. */
export async function complete(db: Kysely<DB>, jobId: string, workerId: string): Promise<boolean> {
  const { rows } = await sql<{ id: string }>`
    UPDATE platform.job
       SET status = 'Succeeded', locked_by = NULL, locked_until = NULL, last_error = NULL
     WHERE id = ${jobId} AND locked_by = ${workerId} AND status = 'Running'
    RETURNING id`.execute(db);
  return rows.length === 1;
}

/**
 * Records a failure. Retries back off exponentially (5s, 10s, 20s … capped at 1h); once attempts
 * are exhausted the job is Dead and stays for inspection. Returns the new status, or null if the
 * lease was lost.
 */
export async function fail(
  db: Kysely<DB>,
  jobId: string,
  workerId: string,
  error: string,
): Promise<'Failed' | 'Dead' | null> {
  const { rows } = await sql<{ status: 'Failed' | 'Dead' }>`
    UPDATE platform.job
       SET status = CASE WHEN attempts >= max_attempts THEN 'Dead' ELSE 'Failed' END,
           run_at = CASE WHEN attempts >= max_attempts THEN run_at
                         ELSE now() + least(interval '1 hour', make_interval(secs => 5 * power(2, attempts - 1))) END,
           locked_by = NULL, locked_until = NULL, last_error = ${error}
     WHERE id = ${jobId} AND locked_by = ${workerId} AND status = 'Running'
    RETURNING status`.execute(db);
  return rows[0]?.status ?? null;
}
