import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context.ts';
import { HttpError } from './problem.ts';
import { auditActor } from './actor.ts';
import { canonicalJson } from '../modules/catalogue/compat-maps.ts';

export interface Stored<T> {
  readonly status: number;
  readonly body: T;
}

/** A request still holding its key this long is assumed dead (the process crashed) and may be retaken. */
const STALE_AFTER_SECONDS = 120;

/**
 * Make a mutating endpoint safe to retry. The client sends `Idempotency-Key`; the first request runs,
 * its response is stored, and every retry with the same key returns that response without acting
 * again. The same key with a *different* body is a client bug and is refused, never "last write wins".
 *
 * The key is scoped to the route and the caller, so one user's keys can never collide with another's.
 */
export async function withIdempotency<T>(
  ctx: AppContext,
  req: FastifyRequest,
  scope: string,
  body: unknown,
  run: () => Promise<Stored<T>>,
): Promise<Stored<T> & { readonly replayed: boolean }> {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 16 || key.length > 128) {
    throw new HttpError(
      400,
      'idempotency_key_required',
      'An Idempotency-Key header (16–128 characters) is required.',
    );
  }
  const actor = req.actor ? auditActor(req.actor) : { type: 'anonymous', id: null };
  const fullScope = `${scope}|${actor.type}:${actor.id ?? ''}`;
  const requestHash = createHash('sha256')
    .update(canonicalJson(body ?? null))
    .digest('hex');

  const claimed = await sql<{ key: string }>`
    INSERT INTO platform.idempotency_key (key, scope, request_hash, status)
    VALUES (${key}, ${fullScope}, ${requestHash}, 'InProgress')
    ON CONFLICT (scope, key) DO NOTHING
    RETURNING key`.execute(ctx.db);

  if (claimed.rows.length === 0) {
    const { rows } = await sql<{
      request_hash: string;
      status: string;
      response: Stored<T> | null;
      age: number;
    }>`
      SELECT request_hash, status, response, extract(epoch FROM now() - created_at)::int AS age
        FROM platform.idempotency_key WHERE scope = ${fullScope} AND key = ${key}`.execute(ctx.db);
    const existing = rows[0];
    if (!existing) return withIdempotency(ctx, req, scope, body, run); // expired between the two statements
    if (existing.request_hash !== requestHash) {
      throw new HttpError(
        422,
        'idempotency_key_reuse',
        'This Idempotency-Key was already used with a different request.',
      );
    }
    if (existing.status === 'Completed' && existing.response)
      return { ...existing.response, replayed: true };
    if (existing.age < STALE_AFTER_SECONDS) {
      throw new HttpError(
        409,
        'request_in_progress',
        'This request is already being processed. Retry shortly.',
      );
    }
    // The original attempt died without finishing: take the key over.
    await sql`DELETE FROM platform.idempotency_key WHERE scope = ${fullScope} AND key = ${key} AND status = 'InProgress'`.execute(
      ctx.db,
    );
    return withIdempotency(ctx, req, scope, body, run);
  }

  try {
    const result = await run();
    await sql`
      UPDATE platform.idempotency_key SET status = 'Completed', response = ${JSON.stringify(result)}::jsonb
       WHERE scope = ${fullScope} AND key = ${key}`.execute(ctx.db);
    return { ...result, replayed: false };
  } catch (error) {
    // A failed attempt must not poison the key: the client's retry should run again.
    await sql`DELETE FROM platform.idempotency_key WHERE scope = ${fullScope} AND key = ${key}`.execute(
      ctx.db,
    );
    throw error;
  }
}
