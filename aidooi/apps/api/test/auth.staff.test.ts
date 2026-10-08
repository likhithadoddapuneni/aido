import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withActor } from '@aidooi/db';
import { runAsSystem } from '../src/context.ts';
import { toDbActor } from '../src/http/actor.ts';
import { JwtAuthenticator } from '../src/modules/auth/authenticator.ts';
import { sha256Hex } from '../src/modules/auth/crypto.ts';
import { acceptInvite, inviteOpsUser, inviteSellerUser } from '../src/modules/auth/staff.ts';
import { PASSWORD, bearer, call, nextStep, onboardStaff, totpNow } from './support/auth-helpers.ts';
import { startHarness, type Harness } from './support/harness.ts';

let h: Harness;
let partnerA: string;
let partnerB: string;
beforeAll(async () => {
  h = await startHarness();
  [partnerA, partnerB] = [...(h.seeded as NonNullable<typeof h.seeded>).partners.values()] as [
    string,
    string,
  ];
});
afterAll(() => h.close());

const deps = () => ({ clock: h.ctx.clock, ids: h.ctx.ids });
const login = (email: string, password: string, totpCode: string) =>
  call(h, 'POST', '/v1/auth/staff/login', { body: { email, password, totpCode } });

describe('invitations', () => {
  const invite = (email: string) =>
    runAsSystem(h.ctx, (trx) =>
      inviteSellerUser(trx, deps(), {
        partnerId: partnerA,
        email,
        fullName: 'New Hire',
        role: 'seller_staff',
      }),
    );

  it('creates an Invited user and a token whose hash alone is stored', async () => {
    const inv = await invite('hire1@partner.test');
    const user = await h.admin
      .selectFrom('identity.seller_user')
      .selectAll()
      .where('id', '=', inv.userId)
      .executeTakeFirstOrThrow();
    expect(user).toMatchObject({ status: 'Invited', role: 'seller_staff', partner_id: partnerA });
    const rows = JSON.stringify(
      await h.admin.selectFrom('identity.staff_invite').selectAll().execute(),
    );
    expect(rows).toContain(sha256Hex(inv.inviteToken));
    expect(rows).not.toContain(inv.inviteToken);
  });

  it('is single use', async () => {
    const inv = await invite('hire2@partner.test');
    await acceptInvite(h.ctx, { token: inv.inviteToken, password: PASSWORD });
    await expect(
      acceptInvite(h.ctx, { token: inv.inviteToken, password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'invalid_invite' });
  });

  it('expires after 72 hours', async () => {
    const inv = await invite('hire3@partner.test');
    h.clock.advanceHours(72.1);
    await expect(
      acceptInvite(h.ctx, { token: inv.inviteToken, password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'invalid_invite' });
    h.clock.advanceHours(-72.1);
  });

  it('re-inviting supersedes the earlier link: only the newest token works', async () => {
    const first = await invite('hire4@partner.test');
    const second = await invite('hire4@partner.test');
    expect(second.userId).toBe(first.userId);
    await expect(
      acceptInvite(h.ctx, { token: first.inviteToken, password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'invalid_invite' });
    await expect(
      acceptInvite(h.ctx, { token: second.inviteToken, password: PASSWORD }),
    ).resolves.toEqual({ email: 'hire4@partner.test' });
  });

  it('an active user’s email, or another partner’s pending invite, cannot be re-invited', async () => {
    const staff = await onboardStaff(h, 'seller', { partnerId: partnerA });
    await expect(invite(staff.email)).rejects.toMatchObject({ status: 409, code: 'email_in_use' });
    await invite('hire5@partner.test');
    await expect(
      runAsSystem(h.ctx, (trx) =>
        inviteSellerUser(trx, deps(), {
          partnerId: partnerB,
          email: 'hire5@partner.test',
          fullName: 'x',
          role: 'seller_staff',
        }),
      ),
    ).rejects.toMatchObject({ code: 'email_in_use' });
  });

  it('rejects a weak password and never reveals whether a token exists', async () => {
    const inv = await invite('hire6@partner.test');
    await expect(
      acceptInvite(h.ctx, { token: inv.inviteToken, password: 'short' }),
    ).rejects.toMatchObject({ status: 422, code: 'weak_password' });
    await expect(
      acceptInvite(h.ctx, { token: 'unknown-token-unknown-token-0000', password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'invalid_invite' });
  });

  it('the password is stored as an argon2id hash', async () => {
    const staff = await onboardStaff(h, 'seller', { partnerId: partnerA });
    const cred = await h.admin
      .selectFrom('identity.staff_credential')
      .select('password_hash')
      .where('seller_user_id', '=', staff.userId)
      .executeTakeFirstOrThrow();
    expect(cred.password_hash).toMatch(/^\$argon2id\$/);
    expect(cred.password_hash).not.toContain(PASSWORD);
  });

  it('ops users are invited the same way', async () => {
    const inv = await runAsSystem(h.ctx, (trx) =>
      inviteOpsUser(trx, deps(), {
        email: 'finance@aidooi.test',
        fullName: 'Fin',
        role: 'ops_finance',
      }),
    );
    await expect(
      acceptInvite(h.ctx, { token: inv.inviteToken, password: PASSWORD }),
    ).resolves.toEqual({ email: 'finance@aidooi.test' });
  });
});

describe('MFA enrolment', () => {
  const acceptedUser = async (email: string) => {
    const inv = await runAsSystem(h.ctx, (trx) =>
      inviteSellerUser(trx, deps(), {
        partnerId: partnerA,
        email,
        fullName: 'M',
        role: 'seller_owner',
      }),
    );
    await acceptInvite(h.ctx, { token: inv.inviteToken, password: PASSWORD });
  };

  it('login is refused until MFA is confirmed, with a distinct, actionable answer', async () => {
    await acceptedUser('mfa1@partner.test');
    const res = await login('mfa1@partner.test', PASSWORD, '123456');
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('mfa_enrolment_required');
  });

  it('enrol returns a seed, which is stored encrypted; confirming needs a real code', async () => {
    await acceptedUser('mfa2@partner.test');
    const enrol = await call(h, 'POST', '/v1/auth/staff/mfa/enroll', {
      body: { email: 'mfa2@partner.test', password: PASSWORD },
    });
    expect(enrol.status).toBe(200);
    expect(enrol.json.otpauthUri).toContain('otpauth://totp/AIDOOi:mfa2%40partner.test');
    const stored = await h.admin
      .selectFrom('identity.staff_credential')
      .select('totp_secret_ciphertext')
      .where('totp_secret_ciphertext', 'is not', null)
      .execute();
    expect(JSON.stringify(stored)).not.toContain(enrol.json.seed);

    const bad = await call(h, 'POST', '/v1/auth/staff/mfa/verify', {
      body: { email: 'mfa2@partner.test', password: PASSWORD, totpCode: '000000' },
    });
    expect(bad.status).toBe(401);
    const good = await call(h, 'POST', '/v1/auth/staff/mfa/verify', {
      body: {
        email: 'mfa2@partner.test',
        password: PASSWORD,
        totpCode: totpNow(h, enrol.json.seed),
      },
    });
    expect(good.status).toBe(200);
    expect(good.json.staff).toMatchObject({
      kind: 'seller',
      role: 'seller_owner',
      partnerId: partnerA,
    });
  });

  it('enrolment needs the password, and cannot be silently replaced once confirmed', async () => {
    const staff = await onboardStaff(h, 'seller', { partnerId: partnerA });
    expect(
      (
        await call(h, 'POST', '/v1/auth/staff/mfa/enroll', {
          body: { email: staff.email, password: 'wrong password here' },
        })
      ).status,
    ).toBe(401);
    const again = await call(h, 'POST', '/v1/auth/staff/mfa/enroll', {
      body: { email: staff.email, password: PASSWORD },
    });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('mfa_already_enrolled');
  });
});

describe('login', () => {
  it('seller and ops sign in with password + TOTP and receive a working session', async () => {
    const seller = await onboardStaff(h, 'seller', { partnerId: partnerA });
    const ops = await onboardStaff(h, 'ops');
    const s = await login(seller.email, PASSWORD, totpNow(h, seller.seed));
    expect(s.status).toBe(200);
    expect(s.json.staff).toMatchObject({ kind: 'seller', partnerId: partnerA });
    const me = await call(h, 'GET', '/v1/me', { headers: bearer(s.json.accessToken) });
    expect(me.json).toMatchObject({
      kind: 'seller',
      email: seller.email,
      partnerId: partnerA,
      role: 'seller_owner',
    });

    const o = await login(ops.email, PASSWORD, totpNow(h, ops.seed));
    expect(o.json.staff).toMatchObject({ kind: 'ops', role: 'ops_admin' });
    expect(
      (await call(h, 'GET', '/v1/me', { headers: bearer(o.json.accessToken) })).json.kind,
    ).toBe('ops');
  });

  it('every failure has the same status, code and shape (no account enumeration)', async () => {
    const staff = await onboardStaff(h, 'seller', { partnerId: partnerA });
    const wrongPassword = await login(
      staff.email,
      'not the password at all',
      totpNow(h, staff.seed),
    );
    nextStep(h);
    const wrongCode = await login(staff.email, PASSWORD, '000000');
    const unknown = await login('nobody@partner.test', PASSWORD, '000000');
    const shapes = [wrongPassword, wrongCode, unknown].map((r) => [
      r.status,
      r.json.code,
      r.json.title,
      r.json.detail,
    ]);
    expect(new Set(shapes.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(shapes[0]![0]).toBe(401);
  });

  it('a TOTP code cannot be used twice, even inside its validity window', async () => {
    const staff = await onboardStaff(h, 'seller', { partnerId: partnerA });
    const code = totpNow(h, staff.seed);
    expect((await login(staff.email, PASSWORD, code)).status).toBe(200);
    expect((await login(staff.email, PASSWORD, code)).status).toBe(401);
    nextStep(h);
    expect((await login(staff.email, PASSWORD, totpNow(h, staff.seed))).status).toBe(200);
  });

  it('LOCKOUT: five failures lock the account — even the right password and code are refused until it expires', async () => {
    const staff = await onboardStaff(h, 'seller', { partnerId: partnerA });
    for (let i = 0; i < 5; i++)
      expect((await login(staff.email, 'wrong wrong wrong wrong', '000000')).status).toBe(401);
    nextStep(h);
    const locked = await login(staff.email, PASSWORD, totpNow(h, staff.seed));
    expect(locked.status).toBe(401);
    expect(locked.json.code).toBe('invalid_credentials');

    h.clock.advanceHours(1.1 / 60); // first lock is one minute
    const ok = await login(staff.email, PASSWORD, totpNow(h, staff.seed));
    expect(ok.status).toBe(200);
    const cred = await h.admin
      .selectFrom('identity.staff_credential')
      .select('failed_attempts')
      .where('seller_user_id', '=', staff.userId)
      .executeTakeFirstOrThrow();
    expect(cred.failed_attempts).toBe(0);
  });

  it('lockout grows with continued failure (1, 2, 4 … minutes)', async () => {
    const staff = await onboardStaff(h, 'seller', { partnerId: partnerA });
    for (let i = 0; i < 5; i++) await login(staff.email, 'bad bad bad bad bad', '000000');
    h.clock.advanceHours(1.1 / 60);
    await login(staff.email, 'bad bad bad bad bad', '000000'); // 6th failure → 2 minute lock
    const cred = await h.admin
      .selectFrom('identity.staff_credential')
      .select(['failed_attempts', 'locked_until'])
      .where('seller_user_id', '=', staff.userId)
      .executeTakeFirstOrThrow();
    expect(cred.failed_attempts).toBe(6);
    const lockMs = new Date(cred.locked_until as Date).getTime() - h.clock.now();
    expect(lockMs).toBeGreaterThan(110_000);
    expect(lockMs).toBeLessThanOrEqual(120_000);
  });

  it('a correct password with a wrong code still counts against the account (TOTP cannot be brute-forced for free)', async () => {
    const staff = await onboardStaff(h, 'seller', { partnerId: partnerA });
    for (let i = 0; i < 5; i++) await login(staff.email, PASSWORD, '000000');
    const cred = await h.admin
      .selectFrom('identity.staff_credential')
      .select('locked_until')
      .where('seller_user_id', '=', staff.userId)
      .executeTakeFirstOrThrow();
    expect(cred.locked_until).not.toBeNull();
  });

  it('login is rate limited per client address', async () => {
    const ip = '203.0.113.9';
    let last;
    for (let i = 0; i < 12; i++)
      last = await call(h, 'POST', '/v1/auth/staff/login', {
        body: { email: 'x@y.test', password: 'p', totpCode: '000000' },
        ip,
      });
    expect(last?.status).toBe(429);
  });
});

describe('disabled and deactivated principals lose access immediately', () => {
  it('disabling a seller user kills their access token and their refresh token', async () => {
    const staff = await onboardStaff(h, 'seller', { partnerId: partnerA });
    expect((await call(h, 'GET', '/v1/me', { headers: bearer(staff.accessToken) })).status).toBe(
      200,
    );
    await h.admin
      .updateTable('identity.seller_user')
      .set({ status: 'Disabled' })
      .where('id', '=', staff.userId)
      .execute();
    expect((await call(h, 'GET', '/v1/me', { headers: bearer(staff.accessToken) })).status).toBe(
      401,
    );
    const refresh = await call(h, 'POST', '/v1/auth/refresh', {
      body: { refreshToken: staff.refreshToken },
    });
    expect(refresh.status).toBe(401);
    nextStep(h);
    expect((await login(staff.email, PASSWORD, totpNow(h, staff.seed))).status).toBe(401);
  });

  it('deactivating the partner locks out all of its staff', async () => {
    const [partner] = await h.admin
      .insertInto('catalogue.partner')
      .values({
        code: 'PRT-9001',
        legal_name: 'Temp LLC',
        trade_name: 'Temp',
        status: 'Active',
        commission_rate: 0.1,
        activated_at: new Date(),
      })
      .returning('id')
      .execute();
    const staff = await onboardStaff(h, 'seller', { partnerId: partner!.id });
    expect((await call(h, 'GET', '/v1/me', { headers: bearer(staff.accessToken) })).status).toBe(
      200,
    );
    await h.admin
      .updateTable('catalogue.partner')
      .set({ status: 'Inactive' })
      .where('id', '=', partner!.id)
      .execute();
    expect((await call(h, 'GET', '/v1/me', { headers: bearer(staff.accessToken) })).status).toBe(
      401,
    );
  });

  it('disabling an ops user kills their access', async () => {
    const ops = await onboardStaff(h, 'ops');
    await h.admin
      .updateTable('identity.ops_user')
      .set({ status: 'Disabled' })
      .where('id', '=', ops.userId)
      .execute();
    expect((await call(h, 'GET', '/v1/me', { headers: bearer(ops.accessToken) })).status).toBe(401);
  });
});

describe('what a seller token can and cannot be', () => {
  it('authenticates as a seller of exactly their own partner — never ops, never another partner', async () => {
    const seller = await onboardStaff(h, 'seller', { partnerId: partnerA });
    const authn = new JwtAuthenticator({ db: h.ctx.db, config: h.ctx.config, clock: h.ctx.clock });
    const actor = await authn.authenticate({
      headers: { authorization: `Bearer ${seller.accessToken}` },
    } as never);
    expect(actor).toMatchObject({
      kind: 'seller',
      partnerId: partnerA,
      sellerUserId: seller.userId,
    });
    expect(actor?.kind).not.toBe('ops');

    // Row-level security under that identity: own offers visible, the other partner's are not.
    const offers = await withActor(h.ctx.db, toDbActor(actor!), (trx) =>
      trx.selectFrom('catalogue.seller_offer').select('partner_id').groupBy('partner_id').execute(),
    );
    expect(offers.map((o) => o.partner_id)).toEqual([partnerA]);
    expect(offers.some((o) => o.partner_id === partnerB)).toBe(false);
  });

  it('cannot read credentials or other users through the application role', async () => {
    const seller = await onboardStaff(h, 'seller', { partnerId: partnerA });
    const authn = new JwtAuthenticator({ db: h.ctx.db, config: h.ctx.config, clock: h.ctx.clock });
    const actor = await authn.authenticate({
      headers: { authorization: `Bearer ${seller.accessToken}` },
    } as never);
    const creds = await withActor(h.ctx.db, toDbActor(actor!), (trx) =>
      trx.selectFrom('identity.staff_credential').selectAll().execute(),
    );
    expect(creds).toEqual([]);
    const users = await withActor(h.ctx.db, toDbActor(actor!), (trx) =>
      trx.selectFrom('identity.seller_user').select('partner_id').execute(),
    );
    expect(users.every((u) => u.partner_id === partnerA)).toBe(true);
  });
});
