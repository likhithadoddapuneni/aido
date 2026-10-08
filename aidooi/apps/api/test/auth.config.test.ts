import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { AuthRuntime } from '../src/modules/auth/tokens.ts';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://x',
  PAYMENT_WEBHOOK_SECRET: 'w'.repeat(20),
  VIEWING_PASS_SECRET: 'v'.repeat(32),
  ALLOW_MOCK_PAYMENTS: 'true', // these tests are about auth, not payments
};
const pem = () =>
  generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('auth configuration', () => {
  it('production refuses to start without a signing key or a root secret', () => {
    expect(() => loadConfig({ ...production, AUTH_SECRET: 'a'.repeat(32) })).toThrowError(
      /JWT_PRIVATE_KEY_PEM/,
    );
    expect(() => loadConfig({ ...production, JWT_PRIVATE_KEY_PEM: pem() })).toThrowError(
      /AUTH_SECRET/,
    );
    expect(() =>
      loadConfig({ ...production, JWT_PRIVATE_KEY_PEM: pem(), AUTH_SECRET: 'short' }),
    ).toThrowError(/AUTH_SECRET/);
  });

  it('a configured key makes tokens verifiable across processes; PEM may arrive with \\n escapes', async () => {
    const key = pem();
    const escaped = key.replaceAll('\n', '\\n');
    const a = new AuthRuntime(loadConfig({ NODE_ENV: 'test', JWT_PRIVATE_KEY_PEM: key }));
    const b = new AuthRuntime(loadConfig({ NODE_ENV: 'test', JWT_PRIVATE_KEY_PEM: escaped }));
    const t = await a.signAccess({ kind: 'ops', sub: 'u1' }, 1_800_000_000_000);
    await expect(b.verifyAccess(t.token, 1_800_000_000_000)).resolves.toEqual({
      kind: 'ops',
      sub: 'u1',
    });
  });

  it('without a configured key (development) each process gets its own, so tokens do not cross', async () => {
    const a = new AuthRuntime(loadConfig({ NODE_ENV: 'test' }));
    const b = new AuthRuntime(loadConfig({ NODE_ENV: 'test' }));
    const t = await a.signAccess({ kind: 'buyer', sub: 'u' }, 1_800_000_000_000);
    await expect(b.verifyAccess(t.token, 1_800_000_000_000)).rejects.toThrow();
  });

  it('secrets are independent: a keyed hash of a phone is not the keyed hash of an OTP', () => {
    const r = new AuthRuntime(loadConfig({ NODE_ENV: 'test', AUTH_SECRET: 's'.repeat(40) }));
    expect(r.secrets.mac('phone', 'x')).not.toBe(r.secrets.mac('otp', 'x'));
    const sealed = r.secrets.encrypt('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY');
    expect(r.secrets.decrypt(sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => r.secrets.decrypt(sealed.slice(0, -4) + 'AAAA')).toThrow(); // authenticated: tampering is detected
  });
});
