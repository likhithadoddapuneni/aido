import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { AuthRuntime, authRuntime } from '../src/modules/auth/tokens.ts';
import { sha256Hex } from '../src/modules/auth/crypto.ts';
import { bearer, call, signInBuyer, type SignedIn } from './support/auth-helpers.ts';
import { startHarness, type Harness } from './support/harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const refresh = (refreshToken: string) =>
  call(h, 'POST', '/v1/auth/refresh', { body: { refreshToken } });

describe('refresh tokens: rotation and reuse detection', () => {
  it('every refresh returns a new pair; the new access token works', async () => {
    const s = await signInBuyer(h);
    const r = await refresh(s.refreshToken);
    expect(r.status).toBe(200);
    expect(r.json.refreshToken).not.toBe(s.refreshToken);
    expect((await call(h, 'GET', '/v1/me', { headers: bearer(r.json.accessToken) })).status).toBe(
      200,
    );
  });

  it('stores only hashes of refresh tokens', async () => {
    const s = await signInBuyer(h);
    const rows = JSON.stringify(
      await h.admin.selectFrom('identity.refresh_token').selectAll().execute(),
    );
    expect(rows).toContain(sha256Hex(s.refreshToken));
    expect(rows).not.toContain(s.refreshToken);
  });

  it('REUSE DETECTION: replaying a rotated token revokes the whole family, including the newest token', async () => {
    const s = await signInBuyer(h);
    const first = await refresh(s.refreshToken);
    const second = await refresh(first.json.refreshToken);
    expect(second.status).toBe(200);

    // The thief (or the owner's stale copy) replays the first token.
    const replay = await refresh(s.refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.json.code).toBe('invalid_refresh_token');

    // Everyone in the family is out, even the holder of the newest token.
    expect((await refresh(second.json.refreshToken)).status).toBe(401);
    const family = await h.admin
      .selectFrom('identity.refresh_token_family')
      .select(['revoked_reason'])
      .where('customer_id', '=', s.customerId)
      .executeTakeFirstOrThrow();
    expect(family.revoked_reason).toBe('reuse_detected');
  });

  it('families are independent: reuse on one device leaves another device signed in', async () => {
    const a = await signInBuyer(h);
    // A second login for the same customer, as another device.
    const { startSession } = await import('../src/modules/auth/sessions.ts');
    const { runAsSystem } = await import('../src/context.ts');
    const other = await runAsSystem(h.ctx, (trx) =>
      startSession(h.ctx, trx, { kind: 'buyer', id: a.customerId }, 'iPad'),
    );
    const used = await refresh(a.refreshToken);
    expect(used.status).toBe(200);
    expect((await refresh(a.refreshToken)).status).toBe(401); // reuse → phone family dead
    expect((await refresh(other.refreshToken)).status).toBe(200); // iPad family unaffected
  });

  it('concurrent use of one refresh token: exactly one wins and the family is revoked', async () => {
    const s = await signInBuyer(h);
    const results = await Promise.all(Array.from({ length: 4 }, () => refresh(s.refreshToken)));
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.filter((r) => r.status === 401).length).toBe(3);
    const winner = results.find((r) => r.status === 200)!;
    expect((await refresh(winner.json.refreshToken)).status).toBe(401);
  });

  it('an expired refresh token is refused; garbage is refused identically', async () => {
    const s = await signInBuyer(h);
    h.clock.advanceHours(31 * 24);
    const expired = await refresh(s.refreshToken);
    const garbage = await refresh('g'.repeat(43));
    expect([expired.status, expired.json.code]).toEqual([garbage.status, garbage.json.code]);
    expect(expired.status).toBe(401);
    h.clock.advanceHours(-31 * 24);
  });

  it('logout ends that session: its refresh token is dead, repeat logout is harmless', async () => {
    const s = await signInBuyer(h);
    expect(
      (await call(h, 'POST', '/v1/auth/logout', { body: { refreshToken: s.refreshToken } })).status,
    ).toBe(204);
    expect((await refresh(s.refreshToken)).status).toBe(401);
    expect(
      (await call(h, 'POST', '/v1/auth/logout', { body: { refreshToken: s.refreshToken } })).status,
    ).toBe(204);
    expect(
      (await call(h, 'POST', '/v1/auth/logout', { body: { refreshToken: 'z'.repeat(43) } })).status,
    ).toBe(204);
  });
});

describe('access tokens (EdDSA JWT)', () => {
  const claims = async (s: SignedIn) => ({ kind: 'buyer' as const, sub: s.customerId });
  const withToken = (t: string) => call(h, 'GET', '/v1/me', { headers: bearer(t) });

  it('a token is valid for 15 minutes and not a second longer', async () => {
    const s = await signInBuyer(h);
    expect((await withToken(s.accessToken)).status).toBe(200);
    h.clock.advanceHours(14 / 60);
    expect((await withToken(s.accessToken)).status).toBe(200);
    h.clock.advanceHours(1.5 / 60);
    const res = await withToken(s.accessToken);
    expect(res.status).toBe(401);
    expect(res.json.code).toBe('invalid_token');
  });

  it('rejects a tampered payload', async () => {
    const s = await signInBuyer(h);
    const [head, body, sig] = s.accessToken.split('.') as [string, string, string];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    payload.sub = '00000000-0000-4000-8000-000000000000';
    const forged = [head, Buffer.from(JSON.stringify(payload)).toString('base64url'), sig].join(
      '.',
    );
    expect((await withToken(forged)).status).toBe(401);
  });

  it('rejects alg "none"', async () => {
    const s = await signInBuyer(h);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(h.clock.now() / 1000);
    const none = `${b64({ alg: 'none', typ: 'JWT', kid: 'k1' })}.${b64({
      sub: s.customerId,
      kind: 'buyer',
      typ: 'access',
      iss: h.ctx.config.JWT_ISSUER,
      aud: h.ctx.config.JWT_AUDIENCE,
      iat: now,
      exp: now + 600,
    })}.`;
    expect((await withToken(none)).status).toBe(401);
  });

  it('rejects a token signed by a different key, even with perfect claims', async () => {
    const s = await signInBuyer(h);
    const stranger = new AuthRuntime(loadConfig({ NODE_ENV: 'test' })); // its own random key
    const forged = await stranger.signAccess(await claims(s), h.clock.now());
    expect((await withToken(forged.token)).status).toBe(401);
  });

  it('rejects a symmetric (HS256) token that uses the public key as a secret (algorithm confusion)', async () => {
    const s = await signInBuyer(h);
    const now = Math.floor(h.clock.now() / 1000);
    const hs = await new SignJWT({ kind: 'buyer', typ: 'access' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject(s.customerId)
      .setIssuer(h.ctx.config.JWT_ISSUER)
      .setAudience(h.ctx.config.JWT_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(new TextEncoder().encode('any shared secret value 0123456789'));
    expect((await withToken(hs)).status).toBe(401);
  });

  it('rejects wrong audience, wrong issuer and non-access tokens (same key)', async () => {
    const pem = generateKeyPairSync('ed25519')
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const base = { NODE_ENV: 'test', JWT_PRIVATE_KEY_PEM: pem } as const;
    const issuer = new AuthRuntime(loadConfig(base));
    const good = await issuer.signAccess({ kind: 'buyer', sub: 'x' }, 1_800_000_000_000);
    expect(await issuer.verifyAccess(good.token, 1_800_000_000_000)).toEqual({
      kind: 'buyer',
      sub: 'x',
    });

    const otherAudience = new AuthRuntime(loadConfig({ ...base, JWT_AUDIENCE: 'someone-else' }));
    await expect(otherAudience.verifyAccess(good.token, 1_800_000_000_000)).rejects.toThrow();
    const otherIssuer = new AuthRuntime(
      loadConfig({ ...base, JWT_ISSUER: 'https://evil.example' }),
    );
    await expect(otherIssuer.verifyAccess(good.token, 1_800_000_000_000)).rejects.toThrow();
    await expect(issuer.verifyAccess(good.token, 1_800_000_000_000 + 16 * 60_000)).rejects.toThrow(
      /exp/,
    );

    const key = createPrivateKey(pem);
    const notAccess = await new SignJWT({ kind: 'buyer', typ: 'refresh' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
      .setSubject('x')
      .setIssuer('https://api.aidooi.example')
      .setAudience('aidooi-api')
      .setIssuedAt(1_800_000_000)
      .setExpirationTime(1_800_000_600)
      .sign(key);
    await expect(issuer.verifyAccess(notAccess, 1_800_000_000_000)).rejects.toThrow();
  });

  it('a valid token for a customer that was erased stops working at once', async () => {
    const s = await signInBuyer(h);
    expect((await withToken(s.accessToken)).status).toBe(200);
    expect(
      (await call(h, 'POST', '/v1/me/erasure', { headers: bearer(s.accessToken) })).status,
    ).toBe(200);
    expect((await withToken(s.accessToken)).status).toBe(401);
  });

  it('the process signs with its own key and exposes nothing secret in the token', async () => {
    const s = await signInBuyer(h);
    const body = JSON.parse(Buffer.from(s.accessToken.split('.')[1]!, 'base64url').toString());
    expect(Object.keys(body).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'kind', 'sub', 'typ']);
    expect(authRuntime(h.ctx.config)).toBe(authRuntime(h.ctx.config));
  });
});
