import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import pg from 'pg';
import { createDb, createPool } from '../client.ts';
import type { DB } from '../generated/db.ts';
import { migrate } from '../migrate.ts';

export const DEFAULT_ADMIN_URL = 'postgres://aidooi:aidooi@localhost:5433/aidooi';

export function adminUrl(): string {
  return process.env['DATABASE_ADMIN_URL'] ?? DEFAULT_ADMIN_URL;
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export interface TestDatabase {
  readonly name: string;
  readonly url: string;
  /** Owner connection: bypasses nothing it has not been denied, and is a superuser in local dev. */
  readonly admin: Kysely<DB>;
  readonly adminPool: pg.Pool;
  /** Connected as aidooi_app: what the API and worker actually get. */
  readonly app: Kysely<DB>;
  readonly appPool: pg.Pool;
  drop(): Promise<void>;
}

async function withAdminClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** A throwaway, fully migrated database. Call `drop()` when done. */
export async function createTestDatabase(
  options: { migrations?: boolean } = {},
): Promise<TestDatabase> {
  const name = `aidooi_test_${randomBytes(6).toString('hex')}`;
  await withAdminClient((c) => c.query(`CREATE DATABASE ${name}`));
  const url = withDatabase(adminUrl(), name);
  if (options.migrations !== false) await migrate(url);

  const adminPool = createPool(url, { max: 3 });
  const appPool = createPool(url, { max: 14, role: 'aidooi_app' });
  return {
    name,
    url,
    admin: createDb(adminPool),
    adminPool,
    app: createDb(appPool),
    appPool,
    async drop() {
      await Promise.all([appPool.end(), adminPool.end()]);
      await withAdminClient((c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    },
  };
}

/** For tools that need a database but not a Kysely handle (codegen). */
export async function withScratchDatabase<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const name = `aidooi_scratch_${randomBytes(6).toString('hex')}`;
  await withAdminClient((c) => c.query(`CREATE DATABASE ${name}`));
  const url = withDatabase(adminUrl(), name);
  try {
    await migrate(url);
    return await fn(url);
  } finally {
    await withAdminClient((c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  }
}
