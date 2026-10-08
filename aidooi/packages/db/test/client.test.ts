import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb, createPool } from '../src/client.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

describe('connection pool', () => {
  it('REGRESSION: an idle connection killed by the server does not crash the process, and the pool recovers', async () => {
    const seen: Error[] = [];
    const pool = createPool(t.url, { max: 2, onError: (e) => seen.push(e) });
    const db = createDb(pool);
    try {
      await sql`SELECT 1`.execute(db); // opens a connection, which then sits idle in the pool

      // An operator (or a failover) terminates every other session on this database.
      await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                 WHERE datname = current_database() AND pid <> pg_backend_pid() AND application_name = ''`.execute(
        t.admin,
      );
      await new Promise((r) => setTimeout(r, 200));

      // Reaching this line at all proves there was no uncaught exception. The pool discarded the dead
      // connection and serves the next query on a fresh one.
      expect((await sql<{ ok: number }>`SELECT 1 AS ok`.execute(db)).rows[0]?.ok).toBe(1);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0]?.message).toMatch(/terminating connection/);
    } finally {
      await pool.end();
    }
  });

  it('reports to stderr by default rather than throwing', async () => {
    const pool = createPool(t.url, { max: 1 });
    const db = createDb(pool);
    try {
      await sql`SELECT 1`.execute(db);
      await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                 WHERE datname = current_database() AND pid <> pg_backend_pid()`.execute(t.admin);
      await new Promise((r) => setTimeout(r, 200));
      expect((await sql<{ ok: number }>`SELECT 2 AS ok`.execute(db)).rows[0]?.ok).toBe(2);
    } finally {
      await pool.end();
    }
  });
});
