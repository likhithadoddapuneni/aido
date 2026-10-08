import { describe, expect, it, vi } from 'vitest';
import {
  ApiProblem,
  NetworkError,
  createApi,
  memoryStore,
  problemFrom,
  unwrap,
  withIntent,
  type Session,
} from '../src/index.ts';

type Handler = (req: Request, n: number) => Response | Promise<Response>;

/** A scripted API: records every request, answers by path. */
function fakeServer(routes: Record<string, Handler>) {
  const calls: {
    path: string;
    method: string;
    auth: string | null;
    correlation: string | null;
    version: string | null;
    body: string;
  }[] = [];
  const counts = new Map<string, number>();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const key = `${req.method} ${url.pathname}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    calls.push({
      path: key,
      method: req.method,
      auth: req.headers.get('authorization'),
      correlation: req.headers.get('x-correlation-id'),
      version: req.headers.get('x-app-version'),
      body: await req.clone().text(),
    });
    const h = routes[key];
    if (!h) return json(404, { code: 'route_not_found', status: 404, correlationId: 'c' });
    return h(req, n);
  };
  return { fetch, calls, count: (k: string) => counts.get(k) ?? 0 };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const invalidToken = () =>
  json(401, { status: 401, code: 'invalid_token', detail: 'expired', correlationId: 'c1' });
const user = (a: string, r: string): Session => ({ kind: 'user', accessToken: a, refreshToken: r });
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const setup = (
  routes: Record<string, Handler>,
  session: Session | null,
  extra: { onSignedOut?: () => void } = {},
) => {
  const server = fakeServer(routes);
  const store = memoryStore(session);
  const api = createApi({
    baseUrl: 'https://api.test',
    store,
    fetch: server.fetch,
    uuid,
    appVersion: '1.4.2',
    ...extra,
  });
  return { server, store, api };
};

describe('every request', () => {
  it('carries the session, a unique correlation id and the app version', async () => {
    const { server, api } = setup(
      { 'GET /v1/me': () => json(200, { ok: true }) },
      user('A1', 'R1'),
    );
    await api.http.GET('/v1/me' as never);
    await api.http.GET('/v1/me' as never);
    expect(server.calls.map((c) => c.auth)).toEqual(['Bearer A1', 'Bearer A1']);
    expect(server.calls.every((c) => c.version === '1.4.2')).toBe(true);
    expect(new Set(server.calls.map((c) => c.correlation)).size).toBe(2);
  });

  it('uses the Guest scheme for guest sessions', async () => {
    const { server, api } = setup(
      { 'GET /v1/projects': () => json(200, { projects: [] }) },
      { kind: 'guest', guestToken: 'G9' },
    );
    await api.http.GET('/v1/projects' as never);
    expect(server.calls[0]?.auth).toBe('Guest G9');
  });

  it('sends no authorization when signed out', async () => {
    const { server, api } = setup({ 'GET /health/live': () => json(200, { status: 'ok' }) }, null);
    await api.http.GET('/health/live' as never);
    expect(server.calls[0]?.auth).toBeNull();
  });
});

describe('expired access tokens', () => {
  it('refreshes once and replays the original request, body intact', async () => {
    let first = true;
    const { server, store, api } = setup(
      {
        'POST /v1/projects': async (req) => {
          if (first) {
            first = false;
            return invalidToken();
          }
          return json(201, { echoed: await req.json(), auth: req.headers.get('authorization') });
        },
        'POST /v1/auth/refresh': () =>
          json(200, { tokenType: 'Bearer', accessToken: 'A2', refreshToken: 'R2', expiresIn: 900 }),
      },
      user('A1', 'R1'),
    );
    const res = await api.http.POST('/v1/projects' as never, { body: { hello: 'world' } } as never);
    expect(res.response.status).toBe(201);
    expect(res.data).toMatchObject({ echoed: { hello: 'world' }, auth: 'Bearer A2' });
    expect(server.count('POST /v1/auth/refresh')).toBe(1);
    expect(JSON.parse(server.calls.find((c) => c.path === 'POST /v1/auth/refresh')!.body)).toEqual({
      refreshToken: 'R1',
    });
    expect(await store.read()).toEqual(user('A2', 'R2'));
  });

  it('GATE: five simultaneous expired requests cause exactly ONE refresh (the server revokes a login on token reuse)', async () => {
    const { server, api } = setup(
      {
        'GET /v1/me': (req) =>
          req.headers.get('authorization') === 'Bearer A2'
            ? json(200, { ok: true })
            : invalidToken(),
        'POST /v1/auth/refresh': async () => {
          await new Promise((r) => setTimeout(r, 30)); // slow enough that all five are waiting
          return json(200, {
            tokenType: 'Bearer',
            accessToken: 'A2',
            refreshToken: 'R2',
            expiresIn: 900,
          });
        },
      },
      user('A1', 'R1'),
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api.http.GET('/v1/me' as never)),
    );
    expect(results.map((r) => r.response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(server.count('POST /v1/auth/refresh')).toBe(1);
  });

  it('does not refresh again if another request already did while this one was in flight', async () => {
    let released!: () => void;
    const gate = new Promise<void>((r) => (released = r));
    const { server, store, api } = setup(
      {
        'GET /v1/slow': async (req) => {
          await gate;
          return req.headers.get('authorization') === 'Bearer A2'
            ? json(200, { ok: true })
            : invalidToken();
        },
        'POST /v1/auth/refresh': () => json(500, { code: 'internal_error' }),
      },
      user('A1', 'R1'),
    );
    const pending = api.http.GET('/v1/slow' as never);
    await new Promise((r) => setTimeout(r, 10));
    await store.write(user('A2', 'R2')); // a concurrent refresh finished
    released();
    expect((await pending).response.status).toBe(200);
    expect(server.count('POST /v1/auth/refresh')).toBe(0);
  });

  it('a refused refresh ends the login: store cleared, sign-out signalled once, the 401 surfaces', async () => {
    const onSignedOut = vi.fn();
    const { store, api } = setup(
      {
        'GET /v1/me': () => invalidToken(),
        'POST /v1/auth/refresh': () =>
          json(401, { status: 401, code: 'invalid_refresh_token', correlationId: 'c' }),
      },
      user('A1', 'R1'),
      { onSignedOut },
    );
    const results = await Promise.all([
      api.http.GET('/v1/me' as never),
      api.http.GET('/v1/me' as never),
    ]);
    expect(results.map((r) => r.response.status)).toEqual([401, 401]);
    expect(await store.read()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('a server fault during refresh keeps the session so the user is not logged out by an outage', async () => {
    const onSignedOut = vi.fn();
    const { store, api } = setup(
      {
        'GET /v1/me': () => invalidToken(),
        'POST /v1/auth/refresh': () =>
          json(503, { code: 'payment_provider_unavailable', status: 503, correlationId: 'c' }),
      },
      user('A1', 'R1'),
      { onSignedOut },
    );
    await expect(api.http.GET('/v1/me' as never)).rejects.toBeInstanceOf(ApiProblem);
    expect(await store.read()).toEqual(user('A1', 'R1'));
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('only the expired-token 401 triggers a refresh; other 401s do not', async () => {
    const { server, api } = setup(
      { 'GET /v1/me': () => json(401, { status: 401, code: 'unauthorized', correlationId: 'c' }) },
      user('A1', 'R1'),
    );
    const r = await api.http.GET('/v1/me' as never);
    expect(r.response.status).toBe(401);
    expect(server.count('POST /v1/auth/refresh')).toBe(0);
  });

  it('never loops: a request that still 401s after a successful refresh is returned, not retried forever', async () => {
    const { server, api } = setup(
      {
        'GET /v1/me': () => invalidToken(),
        'POST /v1/auth/refresh': () =>
          json(200, { tokenType: 'Bearer', accessToken: 'A2', refreshToken: 'R2', expiresIn: 900 }),
      },
      user('A1', 'R1'),
    );
    const r = await api.http.GET('/v1/me' as never);
    expect(r.response.status).toBe(401);
    expect(server.count('GET /v1/me')).toBe(2);
    expect(server.count('POST /v1/auth/refresh')).toBe(1);
  });

  it('an invalid guest token signs out (guests cannot refresh)', async () => {
    const onSignedOut = vi.fn();
    const { store, api } = setup(
      { 'GET /v1/projects': () => invalidToken() },
      { kind: 'guest', guestToken: 'G' },
      { onSignedOut },
    );
    await api.http.GET('/v1/projects' as never);
    expect(await store.read()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });
});

describe('problems and network failures', () => {
  it('turns a problem+json answer into an ApiProblem with its code and correlation id', async () => {
    const { api } = setup(
      {
        'POST /v1/checkout': () =>
          json(409, {
            status: 409,
            code: 'price_approval_required',
            detail: 'A price changed',
            correlationId: 'corr-7',
            errors: [{ path: 'x', message: 'y' }],
          }),
      },
      user('A', 'R'),
    );
    const err = await unwrap(api.http.POST('/v1/checkout' as never, {} as never)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiProblem);
    expect(err).toMatchObject({
      status: 409,
      code: 'price_approval_required',
      correlationId: 'corr-7',
      fieldErrors: [{ path: 'x', message: 'y' }],
    });
  });

  it('copes with a non-JSON error from a proxy', async () => {
    const p = await problemFrom(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(p).toMatchObject({ status: 502, code: 'internal_error' });
    expect(p.retryable).toBe(true);
  });

  it('a dropped connection is a NetworkError, distinct from any server answer', async () => {
    const api = createApi({
      baseUrl: 'https://api.test',
      store: memoryStore(user('A', 'R')),
      fetch: async () => Promise.reject(new TypeError('Network request failed')),
      uuid,
    });
    await expect(api.http.GET('/v1/me' as never)).rejects.toBeInstanceOf(NetworkError);
  });

  it('classifies which problems are worth retrying', () => {
    const p = (status: number, code = 'x') => new ApiProblem({ status, code });
    expect(p(503).retryable).toBe(true);
    expect(p(409, 'request_in_progress').retryable).toBe(true);
    expect(p(409, 'price_approval_required').retryable).toBe(false);
    expect(p(402, 'payment_declined').retryable).toBe(false);
    expect(p(422).retryable).toBe(false);
  });
});

describe('GATE: one intent, one idempotency key, however many retries', () => {
  const noWait = { sleep: async () => undefined, random: () => 0.5 };

  it('retries a 503 and a lost response with the SAME key, then succeeds', async () => {
    const keys: string[] = [];
    let n = 0;
    const result = await withIntent(
      () => 'key-1',
      async (key) => {
        keys.push(key);
        n++;
        if (n === 1) throw new NetworkError(new Error('timeout')); // outcome unknown
        if (n === 2) throw new ApiProblem({ status: 503, code: 'payment_provider_unavailable' });
        return 'paid';
      },
      noWait,
    );
    expect(result).toBe('paid');
    expect(keys).toEqual(['key-1', 'key-1', 'key-1']);
  });

  it('never retries a business refusal', async () => {
    const op = vi.fn().mockRejectedValue(new ApiProblem({ status: 402, code: 'payment_declined' }));
    await expect(withIntent(() => 'k', op, noWait)).rejects.toMatchObject({
      code: 'payment_declined',
    });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured attempts and surfaces the last error', async () => {
    const op = vi.fn().mockRejectedValue(new ApiProblem({ status: 503, code: 'x' }));
    await expect(withIntent(() => 'k', op, { ...noWait, attempts: 3 })).rejects.toBeInstanceOf(
      ApiProblem,
    );
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('backs off exponentially with jitter', async () => {
    const delays: number[] = [];
    const op = vi.fn().mockRejectedValue(new ApiProblem({ status: 503, code: 'x' }));
    await withIntent(() => 'k', op, {
      attempts: 4,
      baseDelayMs: 100,
      random: () => 1,
      sleep: async (ms) => void delays.push(ms),
    }).catch(() => undefined);
    expect(delays).toEqual([100, 200, 400]);
  });

  it('a new intent gets a new key', async () => {
    const keys = ['a', 'b'];
    const used: string[] = [];
    for (let i = 0; i < 2; i++)
      await withIntent(
        () => keys[i]!,
        async (k) => void used.push(k),
        noWait,
      );
    expect(used).toEqual(['a', 'b']);
  });
});
