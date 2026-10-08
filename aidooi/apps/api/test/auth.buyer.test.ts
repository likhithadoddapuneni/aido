import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/modules/auth/crypto.ts';
import { bearer, call, guestAuth, nextIp, nextPhone, signInBuyer } from './support/auth-helpers.ts';
import { startHarness, type Harness } from './support/harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const minute = () => h.clock.advanceHours(1 / 60);

describe('guest sessions', () => {
  it('issues an opaque token, stores only its hash, and authenticates as a guest', async () => {
    const res = await call(h, 'POST', '/v1/auth/guest');
    expect(res.status).toBe(201);
    const { guestToken } = res.json;
    expect(guestToken.length).toBeGreaterThanOrEqual(43);
    const rows = await h.admin
      .selectFrom('identity.guest_session')
      .selectAll()
      .where('token_hash', '=', sha256Hex(guestToken))
      .execute();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(guestToken);

    const me = await call(h, 'GET', '/v1/me', { headers: guestAuth(guestToken) });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ kind: 'buyer', customer: null, guestSessionId: rows[0]!.id });
  });

  it('an unknown or expired guest token is a 401, never silently anonymous', async () => {
    expect(
      (await call(h, 'GET', '/v1/me', { headers: guestAuth('nope-nope-nope-nope-nope-nope') }))
        .status,
    ).toBe(401);
    const { guestToken } = (await call(h, 'POST', '/v1/auth/guest')).json;
    h.clock.advanceHours(31 * 24);
    const res = await call(h, 'GET', '/v1/me', { headers: guestAuth(guestToken) });
    expect(res.status).toBe(401);
    expect(res.json.code).toBe('invalid_token');
    h.clock.advanceHours(-31 * 24);
  });

  it('anonymous requests to /me are 401; malformed schemes are 401', async () => {
    expect((await call(h, 'GET', '/v1/me')).status).toBe(401);
    expect(
      (await call(h, 'GET', '/v1/me', { headers: { authorization: 'Basic abc' } })).status,
    ).toBe(401);
    expect((await call(h, 'GET', '/v1/me', { headers: { authorization: 'Bearer' } })).status).toBe(
      401,
    );
  });
});

describe('phone OTP', () => {
  it('signs a new buyer up (with consent), then signs the same buyer in', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    expect((await call(h, 'POST', '/v1/auth/otp/request', { body: { phone }, ip })).status).toBe(
      202,
    );
    const first = await call(h, 'POST', '/v1/auth/otp/verify', {
      body: { phone, code: h.otp.last(phone), policyVersion: '2026-01' },
      ip,
    });
    expect(first.status).toBe(200);
    expect(first.json.customer.isNew).toBe(true);
    expect(first.json).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });

    const consent = await h.admin
      .selectFrom('identity.consent')
      .selectAll()
      .where('customer_id', '=', first.json.customer.id)
      .execute();
    expect(consent).toMatchObject([{ purpose: 'terms', policy_version: '2026-01' }]);

    minute();
    await call(h, 'POST', '/v1/auth/otp/request', { body: { phone }, ip });
    const again = await call(h, 'POST', '/v1/auth/otp/verify', {
      body: { phone, code: h.otp.last(phone) },
      ip,
    });
    expect(again.status).toBe(200);
    expect(again.json.customer).toEqual({ id: first.json.customer.id, isNew: false });

    const me = await call(h, 'GET', '/v1/me', { headers: bearer(again.json.accessToken) });
    expect(me.json).toMatchObject({
      kind: 'buyer',
      customer: { id: first.json.customer.id, phone, locale: 'en' },
    });
  });

  it('a first sign-up without accepting the terms is refused, and the code is NOT burned', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    await call(h, 'POST', '/v1/auth/otp/request', { body: { phone }, ip });
    const code = h.otp.last(phone);
    const refused = await call(h, 'POST', '/v1/auth/otp/verify', { body: { phone, code }, ip });
    expect(refused.status).toBe(422);
    expect(refused.json.code).toBe('consent_required');
    const ok = await call(h, 'POST', '/v1/auth/otp/verify', {
      body: { phone, code, policyVersion: '2026-01' },
      ip,
    });
    expect(ok.status).toBe(200);
  });

  it('stores only hashes: neither the phone number nor the code is in the challenge row', async () => {
    const phone = nextPhone();
    await call(h, 'POST', '/v1/auth/otp/request', { body: { phone } });
    const code = h.otp.last(phone);
    const rows = JSON.stringify(
      await h.admin.selectFrom('identity.otp_challenge').selectAll().execute(),
    );
    expect(rows).not.toContain(phone);
    expect(rows).not.toContain(`"${code}"`);
  });

  it('a wrong code is rejected; five wrong guesses kill the challenge even for the right code', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    await call(h, 'POST', '/v1/auth/otp/request', { body: { phone }, ip });
    const code = h.otp.last(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await call(h, 'POST', '/v1/auth/otp/verify', {
        body: { phone, code: wrong, policyVersion: 'v' },
        ip,
      });
      expect(r.status).toBe(401);
      expect(r.json.code).toBe('invalid_code');
    }
    const late = await call(h, 'POST', '/v1/auth/otp/verify', {
      body: { phone, code, policyVersion: 'v' },
      ip,
    });
    expect(late.status).toBe(401);
  });

  it('a used code cannot be replayed', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    await call(h, 'POST', '/v1/auth/otp/request', { body: { phone }, ip });
    const code = h.otp.last(phone);
    expect(
      (
        await call(h, 'POST', '/v1/auth/otp/verify', {
          body: { phone, code, policyVersion: 'v' },
          ip,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(h, 'POST', '/v1/auth/otp/verify', {
          body: { phone, code, policyVersion: 'v' },
          ip,
        })
      ).status,
    ).toBe(401);
  });

  it('a code expires after five minutes', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    await call(h, 'POST', '/v1/auth/otp/request', { body: { phone }, ip });
    const code = h.otp.last(phone);
    h.clock.advanceHours(5.01 / 60);
    expect(
      (
        await call(h, 'POST', '/v1/auth/otp/verify', {
          body: { phone, code, policyVersion: 'v' },
          ip,
        })
      ).status,
    ).toBe(401);
  });

  it('only the newest code works: requesting again supersedes the previous one', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    await call(h, 'POST', '/v1/auth/otp/request', { body: { phone }, ip });
    const first = h.otp.last(phone);
    minute();
    await call(h, 'POST', '/v1/auth/otp/request', { body: { phone }, ip });
    const second = h.otp.last(phone);
    if (first !== second) {
      expect(
        (
          await call(h, 'POST', '/v1/auth/otp/verify', {
            body: { phone, code: first, policyVersion: 'v' },
            ip,
          })
        ).status,
      ).toBe(401);
    }
    expect(
      (
        await call(h, 'POST', '/v1/auth/otp/verify', {
          body: { phone, code: second, policyVersion: 'v' },
          ip,
        })
      ).status,
    ).toBe(200);
  });

  it('per-phone throttle: a burst sends one code (cooldown), and at most five an hour — silently', async () => {
    const phone = nextPhone();
    for (let i = 0; i < 4; i++)
      expect((await call(h, 'POST', '/v1/auth/otp/request', { body: { phone } })).status).toBe(202);
    expect(h.otp.codes.filter((c) => c.destination === phone)).toHaveLength(1);

    for (let i = 0; i < 6; i++) {
      minute();
      expect((await call(h, 'POST', '/v1/auth/otp/request', { body: { phone } })).status).toBe(202);
    }
    expect(h.otp.codes.filter((c) => c.destination === phone)).toHaveLength(5);
  });

  it('no enumeration: a known and an unknown number get identical responses', async () => {
    const known = await signInBuyer(h);
    const unknown = nextPhone();
    const a = await call(h, 'POST', '/v1/auth/otp/request', { body: { phone: known.phone } });
    const b = await call(h, 'POST', '/v1/auth/otp/request', { body: { phone: unknown } });
    expect([a.status, a.json]).toEqual([b.status, b.json]);

    const wrongKnown = await call(h, 'POST', '/v1/auth/otp/verify', {
      body: { phone: known.phone, code: '000000' },
    });
    const wrongUnknown = await call(h, 'POST', '/v1/auth/otp/verify', {
      body: { phone: nextPhone(), code: '000000' },
    });
    expect([wrongKnown.status, wrongKnown.json.code]).toEqual([
      wrongUnknown.status,
      wrongUnknown.json.code,
    ]);
  });

  it('a delivery failure is invisible to the caller (and does not leak through status)', async () => {
    const original = h.ctx.otp.send;
    (h.ctx.otp as { send: unknown }).send = async () =>
      Promise.reject(new Error('sms gateway down'));
    try {
      expect(
        (await call(h, 'POST', '/v1/auth/otp/request', { body: { phone: nextPhone() } })).status,
      ).toBe(202);
    } finally {
      (h.ctx.otp as { send: unknown }).send = original;
    }
  });

  it('validates the phone number format', async () => {
    const res = await call(h, 'POST', '/v1/auth/otp/request', { body: { phone: '0501234567' } });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('validation_failed');
  });

  it('the per-address rate limit answers 429 problem+json', async () => {
    const ip = nextIp();
    let last;
    for (let i = 0; i < 12; i++)
      last = await call(h, 'POST', '/v1/auth/otp/request', { body: { phone: nextPhone() }, ip });
    expect(last?.status).toBe(429);
    expect(last?.json.code).toBe('rate_limited');
  });
});

describe('guest → registered upgrade (gap #13): nothing restarts', () => {
  it('the guest’s project is re-owned by the new customer and the guest token stops working', async () => {
    const { guestToken } = (await call(h, 'POST', '/v1/auth/guest')).json;
    const session = await h.admin
      .selectFrom('identity.guest_session')
      .select('id')
      .where('token_hash', '=', sha256Hex(guestToken))
      .executeTakeFirstOrThrow();
    const project = await h.admin
      .insertInto('recommendation.project')
      .values({
        guest_session_id: session.id,
        path_id: 'livingRoom',
        spec: JSON.stringify({ lengthM: 5, widthM: 4 }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const buyer = await signInBuyer(h, { guestToken });

    const moved = await h.admin
      .selectFrom('recommendation.project')
      .selectAll()
      .where('id', '=', project.id)
      .executeTakeFirstOrThrow();
    expect(moved).toMatchObject({
      customer_id: buyer.customerId,
      guest_session_id: null,
      state: 'Draft',
    });
    expect(moved.spec).toEqual({ lengthM: 5, widthM: 4 });

    const sessionRow = await h.admin
      .selectFrom('identity.guest_session')
      .selectAll()
      .where('id', '=', session.id)
      .executeTakeFirstOrThrow();
    expect(sessionRow.customer_id).toBe(buyer.customerId);
    expect(sessionRow.upgraded_at).not.toBeNull();

    expect((await call(h, 'GET', '/v1/me', { headers: guestAuth(guestToken) })).status).toBe(401);
  });

  it('a stale or bogus guest token never blocks a legitimate sign-in', async () => {
    const buyer = await signInBuyer(h, { guestToken: 'x'.repeat(43) });
    expect(buyer.customerId).toBeTruthy();
  });

  it('one guest session cannot be claimed twice', async () => {
    const { guestToken } = (await call(h, 'POST', '/v1/auth/guest')).json;
    const first = await signInBuyer(h, { guestToken });
    const second = await signInBuyer(h, { guestToken });
    const row = await h.admin
      .selectFrom('identity.guest_session')
      .select('customer_id')
      .where('token_hash', '=', sha256Hex(guestToken))
      .executeTakeFirstOrThrow();
    expect(row.customer_id).toBe(first.customerId);
    expect(second.customerId).not.toBe(first.customerId);
  });
});

describe('social sign-in', () => {
  it('creates a customer from a verified provider identity, links on repeat, and upgrades the guest', async () => {
    const { guestToken } = (await call(h, 'POST', '/v1/auth/guest')).json;
    const idToken = h.idTokens.mint('google', {
      subject: 'g-123',
      email: 'Sara@Example.com',
      emailVerified: true,
    });
    const first = await call(h, 'POST', '/v1/auth/oauth/google', {
      body: { idToken, guestToken, policyVersion: '2026-01' },
    });
    expect(first.status).toBe(200);
    expect(first.json.customer.isNew).toBe(true);

    const again = await call(h, 'POST', '/v1/auth/oauth/google', { body: { idToken } });
    expect(again.json.customer).toEqual({ id: first.json.customer.id, isNew: false });

    const me = await call(h, 'GET', '/v1/me', { headers: bearer(again.json.accessToken) });
    expect(me.json.customer.email).toBe('sara@example.com');
    expect((await call(h, 'GET', '/v1/me', { headers: guestAuth(guestToken) })).status).toBe(401);
  });

  it('links to an existing account only through a VERIFIED email', async () => {
    const buyer = await signInBuyer(h);
    await call(h, 'PATCH', '/v1/me', {
      body: { email: 'owner@example.com' },
      headers: bearer(buyer.accessToken),
    });

    const unverified = h.idTokens.mint('google', {
      subject: 'attacker-1',
      email: 'owner@example.com',
      emailVerified: false,
    });
    const a = await call(h, 'POST', '/v1/auth/oauth/google', {
      body: { idToken: unverified, policyVersion: 'v' },
    });
    expect(a.status).toBe(200);
    expect(a.json.customer.id).not.toBe(buyer.customerId);

    const verified = h.idTokens.mint('apple', {
      subject: 'apple-9',
      email: 'owner@example.com',
      emailVerified: true,
    });
    const b = await call(h, 'POST', '/v1/auth/oauth/apple', { body: { idToken: verified } });
    expect(b.json.customer).toEqual({ id: buyer.customerId, isNew: false });
  });

  it('rejects a token that does not verify, and a first sign-up without consent', async () => {
    const bad = await call(h, 'POST', '/v1/auth/oauth/google', {
      body: { idToken: 'x'.repeat(40) },
    });
    expect(bad.status).toBe(401);
    expect(bad.json.code).toBe('invalid_id_token');
    const wrongProvider = h.idTokens.mint('apple', {
      subject: 's',
      email: null,
      emailVerified: false,
    });
    expect(
      (await call(h, 'POST', '/v1/auth/oauth/google', { body: { idToken: wrongProvider } })).status,
    ).toBe(401);
    const fresh = h.idTokens.mint('google', {
      subject: 'new-no-consent',
      email: null,
      emailVerified: false,
    });
    const res = await call(h, 'POST', '/v1/auth/oauth/google', { body: { idToken: fresh } });
    expect(res.status).toBe(422);
  });

  it('without configured client ids, the real verifier answers 503 rather than trusting anything', async () => {
    const { ProviderIdTokenVerifier } = await import('../src/modules/auth/id-tokens.ts');
    const v = new ProviderIdTokenVerifier({});
    await expect(v.verify('google', 'a.b.c')).rejects.toMatchObject({
      status: 503,
      code: 'oauth_not_configured',
    });
  });
});
