import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

// Serialises concurrent deploys (two pods starting at once). Any fixed number works.
const ADVISORY_LOCK_KEY = 7_243_091;

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export class MigrationError extends Error {
  override name = 'MigrationError';
}

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const [index, file] of files.entries()) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new MigrationError(`Invalid migration file name: ${file}`);
    const expected = String(index + 1).padStart(4, '0');
    if (match[1] !== expected) {
      throw new MigrationError(
        `Migration versions must be contiguous: expected ${expected}, found ${file}`,
      );
    }
    const sql = await readFile(join(dir, file), 'utf8');
    migrations.push({
      version: match[1]!,
      name: match[2]!,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return migrations;
}

export interface MigrateOptions {
  readonly dir?: string;
  readonly log?: (message: string) => void;
}

/**
 * Applies pending migrations, each in its own transaction. Forward-only: an applied migration is
 * never edited (its checksum is verified on every run) and there are no down migrations. Changes
 * that break running code ship as expand → migrate → contract across separate releases.
 * Returns the versions applied by this call.
 */
export async function migrate(
  connection: string | pg.ClientConfig,
  options: MigrateOptions = {},
): Promise<string[]> {
  const log = options.log ?? (() => {});
  const migrations = await loadMigrations(options.dir);
  const client = new pg.Client(
    typeof connection === 'string' ? { connectionString: connection } : connection,
  );
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS platform;
      CREATE TABLE IF NOT EXISTS platform.schema_migration (
        version    text PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM platform.schema_migration ORDER BY version',
    );
    const byVersion = new Map(migrations.map((m) => [m.version, m]));
    for (const applied of rows) {
      const onDisk = byVersion.get(applied.version);
      if (!onDisk) {
        throw new MigrationError(`Applied migration ${applied.version} is missing from disk`);
      }
      if (onDisk.checksum !== applied.checksum) {
        throw new MigrationError(
          `Migration ${applied.version}_${onDisk.name} was modified after it was applied. ` +
            'Add a new migration instead of editing an applied one.',
        );
      }
    }

    const appliedVersions = new Set(rows.map((r) => r.version));
    const done: string[] = [];
    for (const m of migrations) {
      if (appliedVersions.has(m.version)) continue;
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query(
          'INSERT INTO platform.schema_migration (version, name, checksum) VALUES ($1, $2, $3)',
          [m.version, m.name, m.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new MigrationError(
          `Migration ${m.version}_${m.name} failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      log(`applied ${m.version}_${m.name}`);
      done.push(m.version);
    }
    return done;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}
