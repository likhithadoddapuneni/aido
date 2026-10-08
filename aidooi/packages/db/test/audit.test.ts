import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withActor } from '../src/context.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';
import { expectPgError } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

const record = (db: TestDatabase['admin'], entityId: string) =>
  sql<{ id: string }>`
    SELECT audit.record('order_line', ${entityId}, 'Confirmed', 'Preparing', 'seller_user', 'u-1', 'picked', '{"k":1}'::jsonb) AS id`.execute(
    db,
  );

describe('audit.event', () => {
  it('records state changes with the transaction correlation id', async () => {
    const { rows } = await withActor(t.app, { kind: 'system' }, (trx) => record(trx, 'line-1'), {
      correlationId: 'req-42',
    });
    const event = await t.admin
      .selectFrom('audit.event')
      .selectAll()
      .where('id', '=', rows[0]!.id)
      .executeTakeFirstOrThrow();
    expect(event).toMatchObject({
      entity_type: 'order_line',
      entity_id: 'line-1',
      from_state: 'Confirmed',
      to_state: 'Preparing',
      actor_type: 'seller_user',
      correlation_id: 'req-42',
      data: { k: 1 },
    });
  });

  it('commits or rolls back together with the change it describes', async () => {
    await t.admin
      .transaction()
      .execute(async (trx) => {
        await record(trx, 'rolled-back');
        throw new Error('abort');
      })
      .catch(() => undefined);
    const rows = await t.admin
      .selectFrom('audit.event')
      .select('id')
      .where('entity_id', '=', 'rolled-back')
      .execute();
    expect(rows).toEqual([]);
  });

  it('rejects UPDATE, DELETE and TRUNCATE even for the owner / superuser', async () => {
    await record(t.admin, 'immutable');
    await expectPgError(
      t.admin
        .updateTable('audit.event')
        .set({ reason: 'edited' })
        .where('entity_id', '=', 'immutable')
        .execute(),
      {
        message: /append-only/,
      },
    );
    await expectPgError(
      t.admin.deleteFrom('audit.event').where('entity_id', '=', 'immutable').execute(),
      {
        message: /append-only/,
      },
    );
    await expectPgError(sql`TRUNCATE audit.event`.execute(t.admin), { message: /append-only/ });
    await expectPgError(sql`TRUNCATE audit.event_default`.execute(t.admin), {
      message: /append-only/,
    });
    const partition = await sql<{ relname: string }>`
      SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
       WHERE i.inhparent = 'audit.event'::regclass AND c.relname <> 'event_default' LIMIT 1`.execute(
      t.admin,
    );
    await expectPgError(sql.raw(`TRUNCATE audit.${partition.rows[0]!.relname}`).execute(t.admin), {
      message: /append-only/,
    });
  });

  it('gives the application role insert and select only', async () => {
    await expectPgError(t.app.updateTable('audit.event').set({ reason: 'x' }).execute(), {
      code: '42501',
    });
    await expectPgError(t.app.deleteFrom('audit.event').execute(), { code: '42501' });
    await expectPgError(sql`TRUNCATE audit.event`.execute(t.app), { code: '42501' });
    await expect(record(t.app, 'app-write')).resolves.toBeDefined();
  });

  it('routes rows to monthly partitions and everything else to the default', async () => {
    await sql`INSERT INTO audit.event (at, entity_type, entity_id, actor_type)
              VALUES (now(), 'x', 'this-month', 'system'), ('2040-06-15', 'x', 'far-future', 'system')`.execute(
      t.admin,
    );
    const { rows } = await sql<{ entity_id: string; part: string }>`
      SELECT entity_id, tableoid::regclass::text AS part FROM audit.event
       WHERE entity_id IN ('this-month', 'far-future') ORDER BY entity_id`.execute(t.admin);
    const month = new Date();
    const expected = `audit.event_y${month.getUTCFullYear()}m${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(rows).toEqual([
      { entity_id: 'far-future', part: 'audit.event_default' },
      { entity_id: 'this-month', part: expected },
    ]);
  });

  it('creates future partitions idempotently, including when called as the app role', async () => {
    const first = await sql<{ n: number }>`SELECT audit.ensure_partitions(5) AS n`.execute(t.app);
    expect(first.rows[0]!.n).toBe(2); // the migration already created the current month plus three
    const second = await sql<{ n: number }>`SELECT audit.ensure_partitions(5) AS n`.execute(t.app);
    expect(second.rows[0]!.n).toBe(0);
  });

  it('only accepts known actor types', async () => {
    await expectPgError(
      sql`INSERT INTO audit.event (entity_type, entity_id, actor_type) VALUES ('x', 'y', 'robot')`.execute(
        t.admin,
      ),
      { constraint: 'event_actor_type_enum' },
    );
  });
});
