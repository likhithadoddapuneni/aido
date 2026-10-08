/**
 * The least-privilege login production runs as (infra/db/api-role.sql). The point of this test is to
 * BE the attacker: connect as that role, with a compromised application's powers, and try to do the
 * things a compromised application must not be able to do.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminUrl, createTestDatabase, fixtures, type TestDatabase } from '../src/testing/index.ts';

const SQL = readFileSync(
  path.resolve(import.meta.dirname, '../../../infra/db/api-role.sql'),
  'utf8',
);
const ROLE = 'aidooi_api';

let t: TestDatabase;
let client: pg.Client;
const password = randomBytes(12).toString('hex');

async function attempt(
  sql: string,
): Promise<{ ok: true; rows: unknown[] } | { ok: false; message: string }> {
  try {
    const r = await client.query(sql);
    return { ok: true, rows: r.rows };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

beforeAll(async () => {
  t = await createTestDatabase();
  // Roles are cluster-wide: replace any left by an earlier run, then create it exactly as the script does.
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => undefined);
  await admin.end();
  const sql = SQL.replace(':api_password', `'${password}'`).replace(/^--.*$/gm, '');
  for (const stmt of sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean))
    await t.adminPool.query(stmt);

  const u = new URL(t.url);
  u.username = ROLE;
  u.password = password;
  client = new pg.Client({ connectionString: u.toString() });
  await client.connect();

  // Some data to look at.
  await fixtures.orderGraph(t.admin, {});
});

afterAll(async () => {
  await client?.end();
  await t.drop();
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`DROP OWNED BY ${ROLE}`).catch(() => undefined);
  await admin.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => undefined);
  await admin.end();
});

describe('the production API login', () => {
  it('is an ordinary role: not a superuser, cannot bypass row-level security, cannot create roles or databases', async () => {
    const r = await attempt(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication FROM pg_roles WHERE rolname = current_user`,
    );
    expect(r).toMatchObject({
      ok: true,
      rows: [
        {
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
        },
      ],
    });
  });

  it('can do its job: read the catalogue and write application rows', async () => {
    expect((await attempt(`SELECT count(*) FROM catalogue.product`)).ok).toBe(true);
    expect(
      (await attempt(`INSERT INTO platform.job (kind, payload) VALUES ('probe', '{}')`)).ok,
    ).toBe(true);
  });

  it('cannot change the schema: no CREATE, DROP, ALTER or TRUNCATE anywhere', async () => {
    for (const stmt of [
      `CREATE TABLE public.x (id int)`,
      `CREATE TABLE commerce.x (id int)`,
      `DROP TABLE commerce.payment`,
      `ALTER TABLE commerce.payment ADD COLUMN x int`,
      `TRUNCATE commerce.ledger_entry`,
      `DROP SCHEMA audit CASCADE`,
      `CREATE ROLE intruder`,
      `DROP TRIGGER payment_state ON commerce.payment`,
      `ALTER TABLE commerce.payment DISABLE TRIGGER ALL`,
    ]) {
      const r = await attempt(stmt);
      expect(r.ok, stmt).toBe(false);
      if (!r.ok) expect(r.message, stmt).toMatch(/permission denied|must be owner|must have/i);
    }
  });

  it('cannot rewrite history: the audit trail and the ledger are append-only even for the application', async () => {
    expect((await attempt(`UPDATE audit.event SET reason = 'x'`)).ok).toBe(false);
    expect((await attempt(`DELETE FROM audit.event`)).ok).toBe(false);
    expect((await attempt(`UPDATE commerce.ledger_entry SET amount_fils = 1`)).ok).toBe(false);
    expect((await attempt(`DELETE FROM commerce.ledger_entry`)).ok).toBe(false);
    expect((await attempt(`UPDATE commerce.master_order SET gross_fils = 1`)).ok).toBe(false);
  });

  it('row-level security binds it: with no actor, seller-scoped rows are invisible; as the system actor they are visible', async () => {
    await client.query('BEGIN');
    try {
      const none = await client.query(`SELECT count(*)::int AS n FROM fulfilment.order_line`);
      expect(none.rows[0].n).toBe(0);
      await client.query(`SELECT set_config('app.actor_kind', 'system', true)`);
      const all = await client.query(`SELECT count(*)::int AS n FROM fulfilment.order_line`);
      expect(all.rows[0].n).toBeGreaterThan(0);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('cannot read PII it has no business reading outside an actor context', async () => {
    await client.query('BEGIN');
    try {
      const addresses = await client.query(
        `SELECT count(*)::int AS n FROM identity.customer_address`,
      );
      expect(addresses.rows[0].n).toBe(0);
      const deliveries = await client.query(
        `SELECT count(*)::int AS n FROM commerce.order_delivery`,
      );
      expect(deliveries.rows[0].n).toBe(0);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('cannot escalate: it cannot become the owner or any other role it was not granted', async () => {
    expect((await attempt(`SET ROLE aidooi`)).ok).toBe(false);
    expect((await attempt(`SET ROLE postgres`)).ok).toBe(false);
    expect((await attempt(`SET SESSION AUTHORIZATION aidooi`)).ok).toBe(false);
  });
});
