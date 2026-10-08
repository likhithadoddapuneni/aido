import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueue } from '@aidooi/db';
import { RECURRING, allJobHandlers } from '../src/jobs/registry.ts';
import { ensureRecurring, runOnce } from '../src/jobs/runner.ts';
import type { JobHandlers } from '../src/jobs/types.ts';
import { startHarness, type Harness } from './support/harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ seed: false });
});
afterAll(() => h.close());

describe('job runner', () => {
  it('runs a due job exactly once and records success', async () => {
    const seen: string[] = [];
    const handlers: JobHandlers = { 'test.ok': async (_c, job) => void seen.push(job.id) };
    const id = await enqueue(h.admin, 'test.ok', { n: 1 });
    expect(await runOnce(h.ctx, handlers)).toMatchObject({ succeeded: 1, failed: 0 });
    expect(await runOnce(h.ctx, handlers)).toMatchObject({ succeeded: 0 });
    expect(seen).toEqual([id]);
    const row = await h.admin
      .selectFrom('platform.job')
      .select('status')
      .where('id', '=', id!)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('Succeeded');
  });

  it('retries a failing job with backoff, then buries it as Dead', async () => {
    const handlers: JobHandlers = { 'test.boom': async () => Promise.reject(new Error('nope')) };
    const id = (await enqueue(h.admin, 'test.boom', {}, { maxAttempts: 2 }))!;
    expect(await runOnce(h.ctx, handlers)).toMatchObject({ failed: 1 });
    let row = await h.admin
      .selectFrom('platform.job')
      .select(['status', 'last_error'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'Failed' });
    expect(row.last_error).toMatch(/nope/);
    // Backoff: not runnable again immediately.
    expect(await runOnce(h.ctx, handlers)).toMatchObject({ succeeded: 0, failed: 0 });
    await h.admin
      .updateTable('platform.job')
      .set({ run_at: new Date(Date.now() - 1000) })
      .where('id', '=', id)
      .execute();
    expect(await runOnce(h.ctx, handlers)).toMatchObject({ failed: 1 });
    row = await h.admin
      .selectFrom('platform.job')
      .select(['status', 'last_error'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('Dead');
  });

  it('a kind with no handler is an error, not a silent skip', async () => {
    const id = (await enqueue(h.admin, 'test.orphan', {}))!;
    const r = await runOnce(h.ctx, { 'test.orphan': undefined as never });
    expect(r.failed).toBe(1);
    const row = await h.admin
      .selectFrom('platform.job')
      .select('last_error')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.last_error).toMatch(/No handler/);
  });

  it('platform housekeeping handlers are registered and run', async () => {
    const handlers = allJobHandlers();
    expect(Object.keys(handlers)).toEqual(
      expect.arrayContaining(['platform.ensure_audit_partitions', 'platform.purge_expired']),
    );
    await enqueue(h.admin, 'platform.ensure_audit_partitions', {});
    await enqueue(h.admin, 'platform.purge_expired', {});
    expect(await runOnce(h.ctx, handlers)).toMatchObject({ succeeded: 2, failed: 0 });
  });
});

describe('recurring jobs', () => {
  it('every recurring kind has a handler', () => {
    const handlers = allJobHandlers();
    for (const r of RECURRING) expect(handlers[r.kind], r.kind).toBeTypeOf('function');
  });

  it('seeding is idempotent, and a run schedules exactly one successor', async () => {
    const recurring = [{ kind: 'test.tick', everySeconds: 60 }];
    let runs = 0;
    const handlers: JobHandlers = { 'test.tick': async () => void runs++ };
    await ensureRecurring(h.ctx, recurring);
    await ensureRecurring(h.ctx, recurring);
    expect(await runOnce(h.ctx, handlers, { recurring })).toMatchObject({ succeeded: 1 });
    expect(runs).toBe(1);
    const pending = await h.admin
      .selectFrom('platform.job')
      .select(['status', 'run_at'])
      .where('kind', '=', 'test.tick')
      .where('status', '=', 'Pending')
      .execute();
    expect(pending).toHaveLength(1);
    expect(new Date(pending[0]!.run_at).getTime()).toBeGreaterThan(Date.now() + 30_000);
    // Not due yet, so nothing more runs now.
    expect(await runOnce(h.ctx, handlers, { recurring })).toMatchObject({ succeeded: 0 });
  });

  it('a recurring job that dies still gets rescheduled', async () => {
    const recurring = [{ kind: 'test.fragile', everySeconds: 60 }];
    const handlers: JobHandlers = { 'test.fragile': async () => Promise.reject(new Error('boom')) };
    await enqueue(
      h.admin,
      'test.fragile',
      {},
      { dedupeKey: 'recurring:test.fragile', maxAttempts: 1 },
    );
    expect(await runOnce(h.ctx, handlers, { recurring })).toMatchObject({ failed: 1 });
    const live = await h.admin
      .selectFrom('platform.job')
      .select('status')
      .where('kind', '=', 'test.fragile')
      .where('status', 'in', ['Pending', 'Failed'])
      .execute();
    expect(live).toHaveLength(1);
  });
});
