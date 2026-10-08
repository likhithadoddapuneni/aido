import { afterEach, describe, expect, it } from 'vitest';
import { NO_DEPOSIT_CREDIT } from '../src/modules/commerce/no-deposit-credit.ts';
import type { Kysely } from 'kysely';
import type { DB } from '@aidooi/db';
import { fixedClock } from '@aidooi/domain';
import { unconfiguredMedia } from '../src/adapters/unconfigured-media.ts';
import { buildApp, type App } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { uuidV7Generator } from '../src/ids.ts';
import { anonymousAuthenticator } from '../src/modules/auth/authenticator.ts';
import { MockGateway } from '../src/payments/mock-gateway.ts';

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const make = async (
  env: Record<string, string> = {},
  checks: Parameters<typeof buildApp>[0]['checks'] = [],
) => {
  const clock = fixedClock(0);
  app = await buildApp({
    ctx: {
      config: loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...env }),
      clock,
      // These tests exercise HTTP conventions only; any database use is a bug.
      db: new Proxy(
        {},
        { get: () => () => Promise.reject(new Error('unexpected database access')) },
      ) as unknown as Kysely<DB>,
      ids: uuidV7Generator,
      gateway: new MockGateway({ clock }),
      notifier: { send: async () => undefined },
      otp: { send: async () => undefined },
      depositCredit: NO_DEPOSIT_CREDIT,
      media: unconfiguredMedia,
      authenticator: anonymousAuthenticator,
    },
    checks,
  });
  return app;
};

describe('config', () => {
  it('fails fast on invalid values', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrowError(/PORT/);
  });
  it('production requires its secrets and forbids wildcard CORS', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrowError(/DATABASE_URL/);
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      PAYMENT_WEBHOOK_SECRET: 'x'.repeat(20),
      JWT_PRIVATE_KEY_PEM: 'pem',
      AUTH_SECRET: 'y'.repeat(32),
      VIEWING_PASS_SECRET: 'z'.repeat(32),
    };
    const mockOk = { ...base, ALLOW_MOCK_PAYMENTS: 'true' };
    expect(() => loadConfig({ ...mockOk, CORS_ORIGINS: '*' })).toThrowError(/wildcard/);
    expect(
      loadConfig({ ...mockOk, CORS_ORIGINS: 'https://a.example, https://b.example' }).CORS_ORIGINS,
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  it('GATE: production refuses to start on the mock payment gateway, which would let anyone order for free', () => {
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      PAYMENT_WEBHOOK_SECRET: 'x'.repeat(20),
      JWT_PRIVATE_KEY_PEM: 'pem',
      AUTH_SECRET: 'y'.repeat(32),
      VIEWING_PASS_SECRET: 'z'.repeat(32),
    };
    expect(() => loadConfig(prod)).toThrowError(/mock would let anyone order for free/);
    // A staging environment with no real stock or money may opt in, explicitly.
    expect(loadConfig({ ...prod, ALLOW_MOCK_PAYMENTS: 'true' }).PAYMENT_GATEWAY).toBe('mock');
    expect(() =>
      loadConfig({ ...prod, ALLOW_MOCK_PAYMENTS: 'true', DEMO_REVEAL_OTP: 'true' }),
    ).toThrowError(/DEMO_REVEAL_OTP/);
    // Development and tests are unaffected.
    expect(loadConfig({ NODE_ENV: 'development' }).PAYMENT_GATEWAY).toBe('mock');
  });
});

describe('http conventions', () => {
  it('liveness never depends on a downstream', async () => {
    const a = await make({}, [
      { name: 'database', run: async () => Promise.reject(new Error('down')) },
    ]);
    expect((await a.inject('/health/live')).statusCode).toBe(200);
  });

  it('readiness reports failing dependencies with 503', async () => {
    const a = await make({}, [
      { name: 'database', run: async () => Promise.reject(new Error('down')) },
      { name: 'queue', run: async () => undefined },
    ]);
    const res = await a.inject('/health/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'degraded',
      checks: { database: 'fail', queue: 'ok' },
    });
  });

  it('echoes a client correlation id and generates one otherwise', async () => {
    const a = await make();
    const given = await a.inject({
      url: '/health/live',
      headers: { 'x-correlation-id': 'client-corr-0001' },
    });
    expect(given.headers['x-correlation-id']).toBe('client-corr-0001');
    const made = await a.inject('/health/live');
    expect(String(made.headers['x-correlation-id'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('unknown routes return problem+json with the correlation id', async () => {
    const a = await make();
    const res = await a.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      status: 404,
      code: 'route_not_found',
      correlationId: res.headers['x-correlation-id'],
    });
  });

  it('security headers are set', async () => {
    const a = await make();
    const res = await a.inject('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeTruthy();
  });

  it('refuses app builds older than the minimum supported version', async () => {
    const a = await make({ MIN_APP_VERSION: '1.4.0' });
    const old = await a.inject({ url: '/health/live', headers: { 'x-app-version': '1.3.9' } });
    expect(old.statusCode).toBe(426);
    expect(old.json().code).toBe('app_version_unsupported');
    expect(
      (await a.inject({ url: '/health/live', headers: { 'x-app-version': '1.10.0' } })).statusCode,
    ).toBe(200);
    expect((await a.inject('/health/live')).statusCode).toBe(200); // web and server callers send no version
  });

  it('serves a valid OpenAPI document that lists the routes', async () => {
    const a = await make();
    await a.ready();
    const doc = a.swagger() as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toContain('/health/live');
  });
});

describe('money endpoints are rate limited', () => {
  it('refuses a burst beyond the configured ceiling with a problem+json 429', async () => {
    const a = await make({ RATE_LIMIT_MONEY_PER_MIN: '3' });
    const hit = () =>
      a.inject({
        method: 'POST',
        url: '/v1/checkout',
        payload: {},
        headers: { 'idempotency-key': 'k'.repeat(20) },
      });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await hit()).statusCode);
    expect(codes.slice(0, 3)).not.toContain(429);
    expect(codes.slice(3)).toEqual([429, 429, 429]);
    const limited = await hit();
    expect(limited.json()).toMatchObject({ status: 429, code: 'rate_limited' });
  });
});
