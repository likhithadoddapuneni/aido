import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, migrate, MIGRATIONS_DIR, MigrationError } from '../src/migrate.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';

let t: TestDatabase;
let dir: string;

beforeEach(async () => {
  t = await createTestDatabase({ migrations: false });
  dir = await mkdtemp(join(tmpdir(), 'aidooi-migrations-'));
});

afterEach(async () => {
  await t.drop();
  await rm(dir, { recursive: true, force: true });
});

describe('migration runner', () => {
  it('applies every migration once and is idempotent', async () => {
    const all = await loadMigrations();
    const first = await migrate(t.url);
    expect(first).toEqual(all.map((m) => m.version));
    expect(await migrate(t.url)).toEqual([]);
  });

  it('refuses to run when an applied migration was edited', async () => {
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    await migrate(t.url, { dir });
    const file = join(dir, '0001_platform.sql');
    await writeFile(file, (await readFile(file, 'utf8')) + '\n-- sneaky edit\n');
    await expect(migrate(t.url, { dir })).rejects.toThrow(
      /0001_platform was modified after it was applied/,
    );
  });

  it('refuses to run when an applied migration disappeared', async () => {
    await writeFile(join(dir, '0001_a.sql'), 'CREATE TABLE platform.a (id int);');
    await writeFile(join(dir, '0002_b.sql'), 'CREATE TABLE platform.b (id int);');
    await migrate(t.url, { dir });
    await rm(join(dir, '0002_b.sql'));
    await expect(migrate(t.url, { dir })).rejects.toThrow(
      /Applied migration 0002 is missing from disk/,
    );
  });

  it('rejects gaps and malformed names', async () => {
    await writeFile(join(dir, '0001_a.sql'), 'SELECT 1;');
    await writeFile(join(dir, '0003_c.sql'), 'SELECT 1;');
    await expect(loadMigrations(dir)).rejects.toThrow(/contiguous/);
    await rm(join(dir, '0003_c.sql'));
    await writeFile(join(dir, 'oops.sql'), 'SELECT 1;');
    await expect(loadMigrations(dir)).rejects.toBeInstanceOf(MigrationError);
  });

  it('rolls a failing migration back completely and records nothing for it', async () => {
    await writeFile(join(dir, '0001_ok.sql'), 'CREATE TABLE platform.ok (id int);');
    await writeFile(join(dir, '0002_bad.sql'), 'CREATE TABLE platform.half (id int); SELECT 1/0;');
    await expect(migrate(t.url, { dir })).rejects.toThrow(/0002_bad failed: division by zero/);

    const tables = await t.adminPool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'platform' ORDER BY 1",
    );
    expect(tables.rows.map((r: { table_name: string }) => r.table_name)).toEqual([
      'ok',
      'schema_migration',
    ]);
    const recorded = await t.adminPool.query('SELECT version FROM platform.schema_migration');
    expect(recorded.rows).toEqual([{ version: '0001' }]);
  });

  it('serialises concurrent runners so each migration is applied exactly once', async () => {
    const runs = await Promise.all([migrate(t.url), migrate(t.url), migrate(t.url)]);
    const total = runs.reduce((n, applied) => n + applied.length, 0);
    expect(total).toBe((await loadMigrations()).length);
  });
});
