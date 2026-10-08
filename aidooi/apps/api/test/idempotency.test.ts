import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { canonicalJson } from '../src/modules/catalogue/compat-maps.ts';
import { withIdempotency } from '../src/http/idempotency.ts';
import { HttpError } from '../src/http/problem.ts';
import { startHarness, type Harness } from './support/harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ seed: false });
});
afterAll(() => h.close());

/** A tiny app whose single route counts how many times the underlying action really ran. */
async function appWithAction(action: (n: number) => Promise<void> = async () => undefined) {
  let runs = 0;
  const app = Fastify();
  app.decorateRequest('actor', null);
  app.addHook('onRequest', async (req) => {
    req.actor = await h.ctx.authenticator.authenticate(req);
  });
  app.setErrorHandler((e, _req, reply) => {
    const status = e instanceof HttpError ? e.status : 500;
    reply.code(status).send({ code: e instanceof HttpError ? e.code : 'internal' });
  });
  app.post('/pay', async (req, reply) => {
    const r = await withIdempotency(h.ctx, req, 'POST /pay', req.body, async () => {
      const n = ++runs;
      await action(n);
      return { status: 201, body: { charged: n } };
    });
    reply.code(r.status).header('x-replayed', String(r.replayed)).send(r.body);
  });
  await app.ready();
  return { app, runs: () => runs };
}

const KEY = (s: string) => `idem-key-${s}-0123456789`;
const guestHeaders = (key: string) =>
  h.as(
    { kind: 'buyer', customerId: null, guestSessionId: 'a0000000-0000-4000-8000-0000000000aa' },
    { 'idempotency-key': key },
  );

describe('Idempotency-Key', () => {
  it('replays the original response and acts once', async () => {
    const { app, runs } = await appWithAction();
    const first = await app.inject({
      method: 'POST',
      url: '/pay',
      payload: { amount: 5 },
      headers: guestHeaders(KEY('a')),
    });
    const again = await app.inject({
      method: 'POST',
      url: '/pay',
      payload: { amount: 5 },
      headers: guestHeaders(KEY('a')),
    });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect(again.headers['x-replayed']).toBe('true');
    expect(runs()).toBe(1);
  });

  it('refuses the same key with a different body', async () => {
    const { app } = await appWithAction();
    await app.inject({
      method: 'POST',
      url: '/pay',
      payload: { amount: 5 },
      headers: guestHeaders(KEY('b')),
    });
    const bad = await app.inject({
      method: 'POST',
      url: '/pay',
      payload: { amount: 6 },
      headers: guestHeaders(KEY('b')),
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('idempotency_key_reuse');
  });

  it('body key order does not matter (canonical hashing)', async () => {
    const { app, runs } = await appWithAction();
    await app.inject({
      method: 'POST',
      url: '/pay',
      payload: { a: 1, b: { x: 1, y: 2 } },
      headers: guestHeaders(KEY('c')),
    });
    const same = await app.inject({
      method: 'POST',
      url: '/pay',
      payload: { b: { y: 2, x: 1 }, a: 1 },
      headers: guestHeaders(KEY('c')),
    });
    expect(same.headers['x-replayed']).toBe('true');
    expect(runs()).toBe(1);
  });

  it('concurrent duplicates: exactly one runs, the other is told to retry', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, runs } = await appWithAction(() => gate);
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/pay',
        payload: { amount: 1 },
        headers: guestHeaders(KEY('d')),
      });
    const p1 = send();
    await new Promise((r) => setTimeout(r, 50));
    const p2 = await send();
    expect(p2.statusCode).toBe(409);
    expect(p2.json().code).toBe('request_in_progress');
    release();
    expect((await p1).statusCode).toBe(201);
    expect(runs()).toBe(1);
    expect((await send()).headers['x-replayed']).toBe('true');
  });

  it('a failed attempt releases the key so the retry runs again', async () => {
    let failOnce = true;
    const { app, runs } = await appWithAction(async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('boom');
      }
    });
    const first = await app.inject({
      method: 'POST',
      url: '/pay',
      payload: { amount: 1 },
      headers: guestHeaders(KEY('e')),
    });
    expect(first.statusCode).toBe(500);
    const retry = await app.inject({
      method: 'POST',
      url: '/pay',
      payload: { amount: 1 },
      headers: guestHeaders(KEY('e')),
    });
    expect(retry.statusCode).toBe(201);
    expect(runs()).toBe(2);
  });

  it('keys are scoped to the caller: another user can reuse the same key string', async () => {
    const { app, runs } = await appWithAction();
    const other = h.as(
      { kind: 'buyer', customerId: null, guestSessionId: 'a0000000-0000-4000-8000-0000000000bb' },
      { 'idempotency-key': KEY('f') },
    );
    await app.inject({ method: 'POST', url: '/pay', payload: {}, headers: guestHeaders(KEY('f')) });
    const r = await app.inject({ method: 'POST', url: '/pay', payload: {}, headers: other });
    expect(r.headers['x-replayed']).toBe('false');
    expect(runs()).toBe(2);
  });

  it('requires the header', async () => {
    const { app } = await appWithAction();
    const r = await app.inject({ method: 'POST', url: '/pay', payload: {}, headers: h.as(null) });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('idempotency_key_required');
  });

  it('takes over a key whose original attempt died, but only for the identical request', async () => {
    const { app, runs } = await appWithAction();
    const scope = 'POST /pay|guest:a0000000-0000-4000-8000-0000000000aa';
    const dead = async (key: string, body: unknown) =>
      h.admin
        .insertInto('platform.idempotency_key')
        .values({
          key,
          scope,
          request_hash: createHash('sha256').update(canonicalJson(body)).digest('hex'),
          status: 'InProgress',
          created_at: new Date(Date.now() - 10 * 60_000),
        } as never)
        .execute();

    await dead(KEY('g1'), { amount: 9 });
    const retaken = await app.inject({
      method: 'POST',
      url: '/pay',
      payload: { amount: 9 },
      headers: guestHeaders(KEY('g1')),
    });
    expect(retaken.statusCode).toBe(201);
    expect(runs()).toBe(1);

    await dead(KEY('g2'), { amount: 9 });
    const different = await app.inject({
      method: 'POST',
      url: '/pay',
      payload: { amount: 10 },
      headers: guestHeaders(KEY('g2')),
    });
    expect(different.statusCode).toBe(422);
    expect(runs()).toBe(1);
  });
});
