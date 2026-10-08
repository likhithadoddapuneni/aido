import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';
import { ENUMS, STATE_TRANSITIONS } from '../src/vocab.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

const SCHEMAS = [
  'platform',
  'identity',
  'catalogue',
  'recommendation',
  'viewing',
  'commerce',
  'fulfilment',
  'settlement',
  'audit',
];
const literals = (def: string) =>
  [...def.matchAll(/'((?:[^']|'')*)'::text/g)].map((m) => m[1]!.replaceAll("''", "'"));
const sorted = (xs: readonly string[]) => [...xs].sort();

async function checkConstraints() {
  const { rows } = await sql<{ tbl: string; name: string; def: string }>`
    SELECT n.nspname || '.' || c.relname AS tbl, con.conname AS name, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE con.contype = 'c' AND NOT c.relispartition AND n.nspname = ANY(${SCHEMAS})`.execute(
    t.admin,
  );
  return rows;
}

describe('controlled vocabularies', () => {
  it('lists each value once', () => {
    for (const e of ENUMS)
      expect(new Set(e.values).size, `${e.table}.${e.column}`).toBe(e.values.length);
  });

  it('matches the CHECK constraint on every listed column', async () => {
    const constraints = await checkConstraints();
    for (const e of ENUMS) {
      const table = e.table.split('.')[1]!;
      const name = `${table}_${e.column}_enum`;
      const found = constraints.find((c) => c.tbl === e.table && c.name === name);
      expect(found, `${e.table} has no constraint ${name}`).toBeDefined();
      expect(sorted(literals(found!.def)), `${e.table}.${e.column}`).toEqual(sorted(e.values));
    }
  });

  it('leaves no enum-style CHECK unlisted in vocab.ts', async () => {
    const listed = new Set(
      ENUMS.map((e) => `${e.table}.${e.table.split('.')[1]}_${e.column}_enum`),
    );
    const unlisted = (await checkConstraints())
      .filter((c) => /= ANY \(\(?ARRAY\[/.test(c.def))
      .map((c) => `${c.tbl}.${c.name}`)
      .filter((full) => !listed.has(full));
    expect(unlisted).toEqual([]);
  });

  it('names enum constraints consistently', async () => {
    const odd = (await checkConstraints())
      .filter((c) => /= ANY \(\(?ARRAY\[/.test(c.def) && !c.name.endsWith('_enum'))
      .map((c) => `${c.tbl}.${c.name}`);
    expect(odd).toEqual([]);
  });
});

describe('state machines', () => {
  it('seed the same edges as vocab.ts, no more and no fewer', async () => {
    const rows = await t.admin.selectFrom('platform.state_transition').selectAll().execute();
    const inDb = rows.map((r) => `${r.machine}|${r.from_state}|${r.to_state}`).sort();
    const inCode = Object.entries(STATE_TRANSITIONS)
      .flatMap(([machine, m]) => m.edges.map(([from, to]) => `${machine}|${from}|${to}`))
      .sort();
    expect(inDb).toEqual(inCode);
  });

  it('only use states the guarded column allows', () => {
    for (const [machine, m] of Object.entries(STATE_TRANSITIONS)) {
      const column = ENUMS.find((e) => e.table === m.table && e.column === m.column);
      expect(column, `${machine} guards a column with no enum`).toBeDefined();
      const states = new Set(m.edges.flat());
      for (const s of states) expect(column!.values, `${machine}: ${s}`).toContain(s);
    }
  });

  it('are enforced by a trigger on exactly the tables vocab.ts names', async () => {
    const { rows } = await sql<{ tbl: string; args: string }>`
      SELECT tgrelid::regclass::text AS tbl, encode(tgargs, 'escape') AS args
        FROM pg_trigger WHERE tgfoid = 'platform.enforce_state_transition'::regproc AND NOT tgisinternal`.execute(
      t.admin,
    );
    const inDb = rows
      .map((r) => `${r.tbl}|${r.args.split('\\000').filter(Boolean).join(',')}`)
      .sort();
    const inCode = Object.entries(STATE_TRANSITIONS)
      .map(([machine, m]) => `${m.table}|${machine},${m.column}`)
      .sort();
    expect(inDb).toEqual(inCode);
  });
});

describe('schema conventions', () => {
  it('stores money only as bigint *_fils, and every bigint is money or a sequence-like counter', async () => {
    const { rows } = await sql<{ tbl: string; col: string; type: string }>`
      SELECT table_schema || '.' || table_name AS tbl, column_name AS col, data_type AS type
        FROM information_schema.columns
       WHERE table_schema = ANY(${SCHEMAS}) AND (column_name LIKE '%\\_fils' OR data_type = 'bigint')`.execute(
      t.admin,
    );
    const bad = rows.filter((r) => !(r.col.endsWith('_fils') && r.type === 'bigint'));
    expect(bad).toEqual([]);
  });

  it('uses timestamptz everywhere', async () => {
    const { rows } = await sql<{ tbl: string; col: string }>`
      SELECT table_schema || '.' || table_name AS tbl, column_name AS col FROM information_schema.columns
       WHERE table_schema = ANY(${SCHEMAS}) AND data_type = 'timestamp without time zone'`.execute(
      t.admin,
    );
    expect(rows).toEqual([]);
  });

  it('forces row-level security on every table that carries a partner_id', async () => {
    const { rows } = await sql<{ tbl: string; forced: boolean }>`
      SELECT n.nspname || '.' || c.relname AS tbl, (c.relrowsecurity AND c.relforcerowsecurity) AS forced
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'partner_id' AND NOT a.attisdropped
       WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY(${SCHEMAS})`.execute(t.admin);
    expect(rows.length).toBeGreaterThan(8);
    expect(rows.filter((r) => !r.forced).map((r) => r.tbl)).toEqual([]);
  });

  it('makes an explicit decision about row-level security for every table that carries a customer_id', async () => {
    // Tables whose access control is deliberately the service layer's. Adding a customer-owned
    // table without RLS means adding it here, in review, with a reason.
    const serviceLayerOnly = new Set([
      'identity.guest_session',
      'identity.refresh_token_family',
      'identity.device_token',
      'recommendation.project',
      'commerce.purchase_request',
    ]);
    const { rows } = await sql<{ tbl: string; forced: boolean }>`
      SELECT n.nspname || '.' || c.relname AS tbl, (c.relrowsecurity AND c.relforcerowsecurity) AS forced
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'customer_id' AND NOT a.attisdropped
       WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY(${SCHEMAS})`.execute(t.admin);
    const undecided = rows
      .filter((r) => !r.forced && !serviceLayerOnly.has(r.tbl))
      .map((r) => r.tbl);
    expect(undecided).toEqual([]);
  });

  it('gives every table a primary key', async () => {
    const { rows } = await sql<{ tbl: string }>`
      SELECT n.nspname || '.' || c.relname AS tbl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY(${SCHEMAS}) AND NOT c.relispartition
         AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p')`.execute(
      t.admin,
    );
    expect(rows).toEqual([]);
  });
});
