import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptInvite } from '../src/modules/auth/staff.ts';
import { bearer, call, onboardStaff } from './support/auth-helpers.ts';
import { startHarness, type Harness } from './support/harness.ts';
import { api, sellerOf } from './support/seller.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const members = async (who: Awaited<ReturnType<typeof sellerOf>>) =>
  (await api(h, 'GET', '/v1/seller/team', who.actor)).json.members as {
    id: string;
    role: string;
    status: string;
    email: string;
    locationId: string | null;
  }[];

describe('inviting', () => {
  it('creates an Invited member; the invitation goes to the invitee through the notifier, never back to the inviter', async () => {
    const owner = await sellerOf(h, 'seller_owner', 'PRT-005');
    const r = await api(h, 'POST', '/v1/seller/team/invitations', owner.actor, {
      email: 'New.Hire@Marina.test',
      fullName: 'New Hire',
      role: 'seller_staff',
      locationId: owner.locationId,
    });
    expect(r.status, r.text).toBe(201);
    expect(r.json).toMatchObject({
      email: 'new.hire@marina.test',
      status: 'Invited',
      role: 'seller_staff',
      locationId: owner.locationId,
    });
    expect(r.text).not.toMatch(/token/i);
    const sent = h.notifier.ofTemplate('seller.team_invitation');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.data).toMatchObject({ email: 'new.hire@marina.test' });
    const token = sent[0]!.data['inviteToken'] as string;
    expect(token.length).toBeGreaterThan(20);

    await acceptInvite(h.ctx, { token, password: 'correct horse battery staple' });
    expect((await members(owner)).find((m) => m.email === 'new.hire@marina.test')!.status).toBe(
      'Active',
    );
    const audit = await h.admin
      .selectFrom('audit.event')
      .select('to_state')
      .where('entity_id', '=', r.json.id)
      .execute();
    expect(audit.map((a) => a.to_state)).toContain('Invited');
  });

  it('refuses a duplicate email, a foreign showroom, and invalid bodies', async () => {
    const owner = await sellerOf(h, 'seller_owner', 'PRT-005');
    const body = { email: 'dup@marina.test', fullName: 'Dup', role: 'seller_staff' };
    expect((await api(h, 'POST', '/v1/seller/team/invitations', owner.actor, body)).status).toBe(
      201,
    );
    const second = await api(h, 'POST', '/v1/seller/team/invitations', owner.actor, {
      ...body,
      role: 'seller_manager',
    });
    expect(second.status).toBe(201); // an outstanding invitation for the same partner is re-issued, not duplicated
    expect((await members(owner)).filter((m) => m.email === 'dup@marina.test')).toHaveLength(1);
    const elsewhere = await sellerOf(h, 'seller_owner', 'PRT-006');
    expect(
      (await api(h, 'POST', '/v1/seller/team/invitations', elsewhere.actor, body)).json.code,
    ).toBe('email_in_use');
    const foreign = await api(h, 'POST', '/v1/seller/team/invitations', owner.actor, {
      ...body,
      email: 'x@y.test',
      locationId: elsewhere.locationId,
    });
    expect(foreign.status).toBe(404);
    expect(
      (
        await api(h, 'POST', '/v1/seller/team/invitations', owner.actor, {
          ...body,
          email: 'not-an-email',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(h, 'POST', '/v1/seller/team/invitations', owner.actor, {
          ...body,
          email: 'z@y.test',
          role: 'seller_god',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(h, 'POST', '/v1/seller/team/invitations', owner.actor, {
          ...body,
          email: 'w@y.test',
          partnerId: elsewhere.partnerId,
        })
      ).status,
    ).toBe(400);
  });
});

describe('the last owner invariant', () => {
  it('a partner can never be left without an active owner, by demotion or disabling, by anyone', async () => {
    const a = await sellerOf(h, 'seller_owner', 'PRT-003');
    const only = (await members(a)).filter(
      (m) => m.role === 'seller_owner' && m.status === 'Active',
    );
    expect(only).toHaveLength(1);
    for (const change of [
      { role: 'seller_manager' },
      { role: 'seller_staff' },
      { status: 'Disabled' },
    ]) {
      const r = await api(h, 'PATCH', `/v1/seller/team/${a.userId}`, a.actor, change);
      expect(r.status, JSON.stringify(change)).toBe(409);
      expect(r.json.code).toBe('last_owner');
    }
    const b = await sellerOf(h, 'seller_owner', 'PRT-003');
    expect(
      (await api(h, 'PATCH', `/v1/seller/team/${a.userId}`, b.actor, { role: 'seller_manager' }))
        .status,
    ).toBe(200);
    // b is now the last one, and cannot step down or be disabled — not even by themselves.
    expect(
      (await api(h, 'PATCH', `/v1/seller/team/${b.userId}`, b.actor, { status: 'Disabled' })).json
        .code,
    ).toBe('last_owner');
    const c = await sellerOf(h, 'seller_owner', 'PRT-003');
    expect(
      (await api(h, 'PATCH', `/v1/seller/team/${b.userId}`, c.actor, { status: 'Disabled' }))
        .status,
    ).toBe(200);
  });

  it('only owners manage the team; an invited person cannot be switched on by hand; other changes work', async () => {
    const owner = await sellerOf(h, 'seller_owner', 'PRT-004');
    const manager = await sellerOf(h, 'seller_manager', 'PRT-004');
    const invited = (
      await api(h, 'POST', '/v1/seller/team/invitations', owner.actor, {
        email: 'pending@marina.test',
        fullName: 'Pending',
        role: 'seller_staff',
      })
    ).json;
    expect(
      (
        await api(h, 'PATCH', `/v1/seller/team/${invited.id}`, manager.actor, {
          role: 'seller_owner',
        })
      ).status,
    ).toBe(403);
    expect(
      (await api(h, 'PATCH', `/v1/seller/team/${invited.id}`, owner.actor, { status: 'Active' }))
        .json.code,
    ).toBe('invitation_pending');
    const moved = await api(h, 'PATCH', `/v1/seller/team/${manager.userId}`, owner.actor, {
      role: 'seller_staff',
      locationId: owner.locationId,
    });
    expect(moved.json).toMatchObject({ role: 'seller_staff', locationId: owner.locationId });
    expect(
      (
        await api(h, 'PATCH', `/v1/seller/team/${manager.userId}`, owner.actor, {
          email: 'x@y.test',
        })
      ).status,
    ).toBe(400);
    expect(
      (await api(h, 'PATCH', `/v1/seller/team/${manager.userId}`, owner.actor, {})).status,
    ).toBe(400);
    const audit = await h.admin
      .selectFrom('audit.event')
      .select('data')
      .where('entity_id', '=', manager.userId)
      .execute();
    expect(audit.at(-1)!.data).toMatchObject({
      before: { role: 'seller_manager' },
      after: { role: 'seller_staff' },
    });
  });
});

describe('disabling', () => {
  it('ends access immediately: the next request with the same token fails, and refresh stops working', async () => {
    const partnerId = h.seeded!.partners.get('PRT-002')!;
    const boss = await onboardStaff(h, 'seller', { partnerId, role: 'seller_owner' });
    const clerk = await onboardStaff(h, 'seller', { partnerId, role: 'seller_manager' });
    const ok = await call(h, 'GET', '/v1/seller/profile', { headers: bearer(clerk.accessToken) });
    expect(ok.status).toBe(200);

    const off = await call(h, 'PATCH', `/v1/seller/team/${clerk.userId}`, {
      headers: bearer(boss.accessToken),
      body: { status: 'Disabled' },
    });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    expect(off.json.status).toBe('Disabled');

    const after = await call(h, 'GET', '/v1/seller/profile', {
      headers: bearer(clerk.accessToken),
    });
    expect(after.status).toBe(401);
    const refresh = await call(h, 'POST', '/v1/auth/refresh', {
      body: { refreshToken: clerk.refreshToken },
    });
    expect(refresh.status).toBe(401);
    const families = await h.admin
      .selectFrom('identity.refresh_token_family')
      .select(['revoked_at', 'revoked_reason'])
      .where('seller_user_id', '=', clerk.userId)
      .execute();
    expect(families.every((f) => f.revoked_at && f.revoked_reason === 'admin')).toBe(true);
    // The colleague who disabled them is unaffected.
    expect(
      (await call(h, 'GET', '/v1/seller/profile', { headers: bearer(boss.accessToken) })).status,
    ).toBe(200);
  });
});
