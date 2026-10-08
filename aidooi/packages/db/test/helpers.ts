import { expect } from 'vitest';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../src/generated/db.ts';

interface PgErrorShape {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: string;
}

/** Asserts the promise rejects with a Postgres error matching every given field. */
export async function expectPgError(
  promise: Promise<unknown>,
  expected: { code?: string; constraint?: string; message?: RegExp },
): Promise<void> {
  let caught: PgErrorShape | undefined;
  try {
    await promise;
  } catch (error) {
    caught = error as PgErrorShape;
  }
  expect(caught, 'expected the statement to be rejected by the database').toBeDefined();
  if (expected.code) expect(caught?.code).toBe(expected.code);
  if (expected.constraint) expect(caught?.constraint).toBe(expected.constraint);
  if (expected.message) expect(caught?.message).toMatch(expected.message);
}

class Rollback extends Error {}

export type Attempt = { ok: true } | { ok: false; error: PgErrorShape };

/** Runs `fn` in a transaction that is always rolled back; reports whether it succeeded. */
export async function attempt(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<unknown>,
): Promise<Attempt> {
  let result: Attempt = { ok: true };
  try {
    await db.transaction().execute(async (trx) => {
      try {
        await fn(trx);
      } catch (error) {
        result = { ok: false, error: error as PgErrorShape };
      }
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result;
}
