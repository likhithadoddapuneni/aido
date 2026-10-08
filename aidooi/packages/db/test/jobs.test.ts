import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claim, complete, enqueue, fail } from '../src/jobs.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

const status = async (id: string) =>
  await t.admin
    .selectFrom('platform.job')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

describe('durable jobs', () => {
  it('never hands the same job to two concurrent workers', async () => {
    const kind = 'test.concurrent';
    const total = 120;
    for (let i = 0; i < total; i++) await enqueue(t.admin, kind, { i });

    const worker = async (name: string) => {
      const mine: string[] = [];
      for (;;) {
        const batch = await claim(t.app, name, [kind], 5, 60);
        if (batch.length === 0) return mine;
        for (const job of batch) {
          mine.push(job.id);
          expect(await complete(t.app, job.id, name)).toBe(true);
        }
      }
    };
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => worker(`w${i}`)));
    const all = results.flat();
    expect(all).toHaveLength(total);
    expect(new Set(all).size).toBe(total);
    expect(results.filter((r) => r.length > 0).length).toBeGreaterThan(1);
  });

  it('claims only jobs of requested kinds that are due', async () => {
    await enqueue(t.admin, 'test.future', {}, { runAt: new Date(Date.now() + 3_600_000) });
    await enqueue(t.admin, 'test.other', {});
    expect(await claim(t.app, 'w', ['test.future'], 10, 60)).toEqual([]);
    expect((await claim(t.app, 'w', ['test.other'], 10, 60)).length).toBe(1);
  });

  it('deduplicates while a job is live and allows rescheduling once it finished', async () => {
    const key = 'expire:reservation:1';
    const first = await enqueue(t.admin, 'test.dedupe', {}, { dedupeKey: key });
    expect(first).not.toBeNull();
    expect(await enqueue(t.admin, 'test.dedupe', {}, { dedupeKey: key })).toBeNull();
    const [job] = await claim(t.app, 'w', ['test.dedupe'], 1, 60);
    expect(await enqueue(t.admin, 'test.dedupe', {}, { dedupeKey: key })).toBeNull(); // still Running
    await complete(t.app, job!.id, 'w');
    expect(await enqueue(t.admin, 'test.dedupe', {}, { dedupeKey: key })).not.toBeNull();
  });

  it('retries with exponential backoff, then buries the job', async () => {
    const id = (await enqueue(t.admin, 'test.retry', {}, { maxAttempts: 3 }))!;
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      await t.admin
        .updateTable('platform.job')
        .set({ run_at: sql`now()` })
        .where('id', '=', id)
        .execute();
      const [job] = await claim(t.app, 'w', ['test.retry'], 1, 60);
      expect(job).toMatchObject({ id, attempts: attempt, maxAttempts: 3 });
      const outcome = await fail(t.app, id, 'w', `boom ${attempt}`);
      expect(outcome).toBe(attempt < 3 ? 'Failed' : 'Dead');
      const row = await status(id);
      if (attempt < 3) delays.push(Math.round((row.run_at.getTime() - Date.now()) / 1000));
    }
    // 5s then 10s (± scheduling noise)
    expect(delays[0]).toBeGreaterThanOrEqual(3);
    expect(delays[0]).toBeLessThanOrEqual(5);
    expect(delays[1]).toBeGreaterThanOrEqual(8);
    expect(delays[1]).toBeLessThanOrEqual(10);
    expect(await status(id)).toMatchObject({
      status: 'Dead',
      last_error: 'boom 3',
      locked_by: null,
    });
    expect(await claim(t.app, 'w', ['test.retry'], 1, 60)).toEqual([]);
  });

  it('hands a job to another worker when its lease expires, and rejects the stale worker', async () => {
    const id = (await enqueue(t.admin, 'test.lease', {}))!;
    const [first] = await claim(t.app, 'slow', ['test.lease'], 1, 60);
    expect(first?.id).toBe(id);
    expect(await claim(t.app, 'other', ['test.lease'], 1, 60)).toEqual([]); // lease still held

    await t.admin
      .updateTable('platform.job')
      .set({ locked_until: sql`now() - interval '1 minute'` })
      .where('id', '=', id)
      .execute();
    const [second] = await claim(t.app, 'other', ['test.lease'], 1, 60);
    expect(second).toMatchObject({ id, attempts: 2 });

    expect(await complete(t.app, id, 'slow')).toBe(false);
    expect(await fail(t.app, id, 'slow', 'late')).toBeNull();
    expect(await complete(t.app, id, 'other')).toBe(true);
  });

  it('buries a job whose lease expired with no attempts left', async () => {
    const id = (await enqueue(t.admin, 'test.exhausted', {}, { maxAttempts: 1 }))!;
    await claim(t.app, 'w', ['test.exhausted'], 1, 60);
    await t.admin
      .updateTable('platform.job')
      .set({ locked_until: sql`now() - interval '1 minute'` })
      .where('id', '=', id)
      .execute();
    expect(await claim(t.app, 'w2', ['test.exhausted'], 1, 60)).toEqual([]);
    expect(await status(id)).toMatchObject({ status: 'Dead' });
  });

  it('is atomic with the caller’s transaction', async () => {
    await t.admin
      .transaction()
      .execute(async (trx) => {
        await enqueue(trx, 'test.atomic', {});
        throw new Error('rollback');
      })
      .catch(() => undefined);
    expect(await claim(t.app, 'w', ['test.atomic'], 10, 60)).toEqual([]);
  });
});
