import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures } from '@aidooi/db/testing';
import { sha256Hex } from '../src/modules/auth/crypto.ts';
import { bearer, call, guestAuth, onboardStaff, signInBuyer } from './support/auth-helpers.ts';
import { startHarness, type Harness } from './support/harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const as = (token: string) => ({ headers: bearer(token) });

describe('profile', () => {
  it('reads and updates my own profile; locale is en or ar only', async () => {
    const b = await signInBuyer(h);
    const patched = await call(h, 'PATCH', '/v1/me', {
      ...as(b.accessToken),
      body: { fullName: 'Layla Haddad', locale: 'ar', email: 'Layla@Example.com' },
    });
    expect(patched.status).toBe(200);
    expect(patched.json).toMatchObject({
      fullName: 'Layla Haddad',
      locale: 'ar',
      email: 'layla@example.com',
      phone: b.phone,
    });
    expect(
      (await call(h, 'PATCH', '/v1/me', { ...as(b.accessToken), body: { locale: 'fr' } })).status,
    ).toBe(400);
    expect((await call(h, 'PATCH', '/v1/me', { ...as(b.accessToken), body: {} })).status).toBe(400);
  });

  it('an email already in use is a 409, and a guest cannot edit a profile', async () => {
    const a = await signInBuyer(h);
    const b = await signInBuyer(h);
    await call(h, 'PATCH', '/v1/me', {
      ...as(a.accessToken),
      body: { email: 'taken@example.com' },
    });
    const clash = await call(h, 'PATCH', '/v1/me', {
      ...as(b.accessToken),
      body: { email: 'taken@example.com' },
    });
    expect(clash.status).toBe(409);
    const { guestToken } = (await call(h, 'POST', '/v1/auth/guest')).json;
    const asGuest = await call(h, 'PATCH', '/v1/me', {
      headers: guestAuth(guestToken),
      body: { fullName: 'x' },
    });
    expect(asGuest.status).toBe(403);
    expect(asGuest.json.code).toBe('registration_required');
  });
});

describe('devices', () => {
  const token = 'push-token-abcdef-0123456789';
  const put = (t: string, body: object) => call(h, 'PUT', '/v1/me/devices', { ...as(t), body });

  it('registers, updates and removes a push token, for buyers and staff alike', async () => {
    const b = await signInBuyer(h);
    expect(
      (await put(b.accessToken, { platform: 'ios', pushToken: token, appVersion: '1.0.0' })).status,
    ).toBe(204);
    expect(
      (await put(b.accessToken, { platform: 'ios', pushToken: token, appVersion: '1.0.1' })).status,
    ).toBe(204);
    let rows = await h.admin
      .selectFrom('identity.device_token')
      .selectAll()
      .where('push_token', '=', token)
      .execute();
    expect(rows).toMatchObject([{ customer_id: b.customerId, app_version: '1.0.1' }]);

    expect(
      (
        await call(h, 'DELETE', '/v1/me/devices', {
          ...as(b.accessToken),
          body: { pushToken: token },
        })
      ).status,
    ).toBe(204);
    rows = await h.admin
      .selectFrom('identity.device_token')
      .selectAll()
      .where('push_token', '=', token)
      .execute();
    expect(rows).toEqual([]);

    const seller = await onboardStaff(h, 'seller');
    expect(
      (await put(seller.accessToken, { platform: 'android', pushToken: `${token}-seller` })).status,
    ).toBe(204);
    const row = await h.admin
      .selectFrom('identity.device_token')
      .select('seller_user_id')
      .where('push_token', '=', `${token}-seller`)
      .executeTakeFirstOrThrow();
    expect(row.seller_user_id).toBe(seller.userId);
  });

  it('a token that moves to another account moves with the device; nobody can delete someone else’s', async () => {
    const a = await signInBuyer(h);
    const b = await signInBuyer(h);
    await put(a.accessToken, { platform: 'ios', pushToken: `${token}-shared` });
    await call(h, 'DELETE', '/v1/me/devices', {
      ...as(b.accessToken),
      body: { pushToken: `${token}-shared` },
    });
    expect(
      await h.admin
        .selectFrom('identity.device_token')
        .select('customer_id')
        .where('push_token', '=', `${token}-shared`)
        .execute(),
    ).toHaveLength(1);
    await put(b.accessToken, { platform: 'ios', pushToken: `${token}-shared` });
    const row = await h.admin
      .selectFrom('identity.device_token')
      .select('customer_id')
      .where('push_token', '=', `${token}-shared`)
      .executeTakeFirstOrThrow();
    expect(row.customer_id).toBe(b.customerId);
  });

  it('guests have no devices to register', async () => {
    const { guestToken } = (await call(h, 'POST', '/v1/auth/guest')).json;
    expect(
      (
        await call(h, 'PUT', '/v1/me/devices', {
          headers: guestAuth(guestToken),
          body: { platform: 'ios', pushToken: 'x'.repeat(20) },
        })
      ).status,
    ).toBe(403);
  });
});

describe('consent', () => {
  it('grants optional consent, replaces it on a new policy version (history kept) and withdraws it', async () => {
    const b = await signInBuyer(h);
    const url = '/v1/me/consent/marketing';
    expect(
      (await call(h, 'PUT', url, { ...as(b.accessToken), body: { policyVersion: '2026-01' } }))
        .json,
    ).toMatchObject({ purpose: 'marketing', policyVersion: '2026-01' });
    await call(h, 'PUT', url, { ...as(b.accessToken), body: { policyVersion: '2026-01' } }); // idempotent
    await call(h, 'PUT', url, { ...as(b.accessToken), body: { policyVersion: '2026-06' } });
    const rows = await h.admin
      .selectFrom('identity.consent')
      .select(['policy_version', 'withdrawn_at'])
      .where('customer_id', '=', b.customerId)
      .where('purpose', '=', 'marketing')
      .orderBy('granted_at')
      .execute();
    expect(rows.map((r) => [r.policy_version, r.withdrawn_at !== null])).toEqual([
      ['2026-01', true],
      ['2026-06', false],
    ]);

    expect((await call(h, 'DELETE', url, as(b.accessToken))).status).toBe(204);
    const active = await h.admin
      .selectFrom('identity.consent')
      .select('id')
      .where('customer_id', '=', b.customerId)
      .where('purpose', '=', 'marketing')
      .where('withdrawn_at', 'is', null)
      .execute();
    expect(active).toEqual([]);
  });

  it('the terms cannot be withdrawn while the account exists', async () => {
    const b = await signInBuyer(h);
    const res = await call(h, 'DELETE', '/v1/me/consent/terms', as(b.accessToken));
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('terms_required');
  });
});

describe('addresses', () => {
  const home = {
    line1: 'Villa 12, Street 4',
    area: 'Jumeirah',
    emirate: 'Dubai',
    lat: 25.2,
    lng: 55.27,
  };

  it('the first address becomes the default; choosing another default moves the flag; ownership is enforced', async () => {
    const b = await signInBuyer(h);
    const a1 = await call(h, 'POST', '/v1/me/addresses', { ...as(b.accessToken), body: home });
    expect(a1.status).toBe(201);
    expect(a1.json.isDefault).toBe(true);
    const a2 = await call(h, 'POST', '/v1/me/addresses', {
      ...as(b.accessToken),
      body: { line1: 'Office', emirate: 'Abu Dhabi', isDefault: true },
    });
    expect(a2.json.isDefault).toBe(true);
    const list = (await call(h, 'GET', '/v1/me/addresses', as(b.accessToken))).json;
    expect(list.map((a: { isDefault: boolean }) => a.isDefault)).toEqual([false, true]);

    const updated = await call(h, 'PUT', `/v1/me/addresses/${a1.json.id}`, {
      ...as(b.accessToken),
      body: { ...home, line2: 'Gate 2' },
    });
    expect(updated.json).toMatchObject({ line2: 'Gate 2', isDefault: false });

    const other = await signInBuyer(h);
    expect(
      (
        await call(h, 'PUT', `/v1/me/addresses/${a1.json.id}`, {
          ...as(other.accessToken),
          body: home,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(h, 'DELETE', `/v1/me/addresses/${a1.json.id}`, as(other.accessToken))).status,
    ).toBe(404);
    expect((await call(h, 'GET', '/v1/me/addresses', as(other.accessToken))).json).toEqual([]);
    expect(
      (await call(h, 'DELETE', `/v1/me/addresses/${a1.json.id}`, as(b.accessToken))).status,
    ).toBe(204);
  });

  it('validates the emirate and requires latitude and longitude together', async () => {
    const b = await signInBuyer(h);
    expect(
      (
        await call(h, 'POST', '/v1/me/addresses', {
          ...as(b.accessToken),
          body: { ...home, emirate: 'Atlantis' },
        })
      ).status,
    ).toBe(400);
    const half = await call(h, 'POST', '/v1/me/addresses', {
      ...as(b.accessToken),
      body: { line1: 'x', emirate: 'Dubai', lat: 25 },
    });
    expect(half.status).toBe(422);
    expect(half.json.code).toBe('invalid_location');
  });
});

describe('erasure and export (ADR-025)', () => {
  it('erasure removes personal data and sessions but keeps the rows other records point at', async () => {
    const b = await signInBuyer(h);
    const { guestToken } = (await call(h, 'POST', '/v1/auth/guest')).json;
    await signInBuyer(h, { guestToken }); // another customer; must be unaffected below
    await call(h, 'PATCH', '/v1/me', {
      ...as(b.accessToken),
      body: { fullName: 'Layla', email: 'layla.erase@example.com' },
    });
    await call(h, 'POST', '/v1/me/addresses', {
      ...as(b.accessToken),
      body: { line1: 'Villa 1', emirate: 'Dubai' },
    });
    await call(h, 'PUT', '/v1/me/devices', {
      ...as(b.accessToken),
      body: { platform: 'ios', pushToken: 'erase-me-push-token-1' },
    });
    await call(h, 'PUT', '/v1/me/consent/marketing', {
      ...as(b.accessToken),
      body: { policyVersion: '1' },
    });
    const offer = (
      await h.admin
        .selectFrom('catalogue.seller_offer')
        .select('id')
        .limit(1)
        .executeTakeFirstOrThrow()
    ).id;
    const { purchaseRequestId } = await fixtures.reservation(h.admin, {
      customerId: b.customerId,
      offerId: offer,
      priceFils: 100_000,
    });
    const project = await fixtures.project(h.admin, b.customerId);
    await h.admin
      .updateTable('recommendation.project')
      .set({ media_keys: JSON.stringify(['photos/room.jpg']) })
      .where('id', '=', project)
      .execute();

    const res = await call(h, 'POST', '/v1/me/erasure', as(b.accessToken));
    expect(res.json).toEqual({ status: 'erased' });

    const customer = await h.admin
      .selectFrom('identity.customer')
      .selectAll()
      .where('id', '=', b.customerId)
      .executeTakeFirstOrThrow();
    expect(customer).toMatchObject({
      status: 'Erased',
      phone_e164: null,
      email: null,
      full_name: null,
    });
    expect(customer.erased_at).not.toBeNull();
    expect(
      await h.admin
        .selectFrom('identity.customer_address')
        .select('id')
        .where('customer_id', '=', b.customerId)
        .execute(),
    ).toEqual([]);
    expect(
      await h.admin
        .selectFrom('identity.device_token')
        .select('id')
        .where('customer_id', '=', b.customerId)
        .execute(),
    ).toEqual([]);
    expect(
      (await call(h, 'POST', '/v1/auth/refresh', { body: { refreshToken: b.refreshToken } }))
        .status,
    ).toBe(401);

    // Records other modules reference survive, now pointing at an anonymous customer.
    const pr = await h.admin
      .selectFrom('commerce.purchase_request')
      .select('customer_id')
      .where('id', '=', purchaseRequestId)
      .executeTakeFirstOrThrow();
    expect(pr.customer_id).toBe(b.customerId);
    const kept = await h.admin
      .selectFrom('recommendation.project')
      .select('media_keys')
      .where('id', '=', project)
      .executeTakeFirstOrThrow();
    expect(kept.media_keys).toEqual([]);

    const audit = await h.admin
      .selectFrom('audit.event')
      .select(['from_state', 'to_state'])
      .where('entity_id', '=', b.customerId)
      .where('to_state', '=', 'Erased')
      .execute();
    expect(audit).toHaveLength(1);
    // And the personal data is not in the audit trail either.
    expect(
      JSON.stringify(
        await h.admin
          .selectFrom('audit.event')
          .selectAll()
          .where('entity_id', '=', b.customerId)
          .execute(),
      ),
    ).not.toContain(b.phone);
  });

  it('after erasure the same phone number can register afresh as a new customer; erasing twice is harmless', async () => {
    const b = await signInBuyer(h);
    await call(h, 'POST', '/v1/me/erasure', as(b.accessToken));
    expect((await call(h, 'POST', '/v1/me/erasure', as(b.accessToken))).status).toBe(401); // token no longer valid
    await call(h, 'POST', '/v1/auth/otp/request', { body: { phone: b.phone } });
    const again = await call(h, 'POST', '/v1/auth/otp/verify', {
      body: { phone: b.phone, code: h.otp.last(b.phone), policyVersion: 'v' },
    });
    expect(again.json.customer.isNew).toBe(true);
    expect(again.json.customer.id).not.toBe(b.customerId);
  });

  it('export returns everything held about me — and nothing about anyone else', async () => {
    const b = await signInBuyer(h);
    const other = await signInBuyer(h);
    await call(h, 'PATCH', '/v1/me', { ...as(b.accessToken), body: { fullName: 'Export Me' } });
    await call(h, 'POST', '/v1/me/addresses', {
      ...as(b.accessToken),
      body: { line1: 'Mine', emirate: 'Sharjah' },
    });
    await call(h, 'POST', '/v1/me/addresses', {
      ...as(other.accessToken),
      body: { line1: 'Theirs', emirate: 'Dubai' },
    });
    await fixtures.project(h.admin, b.customerId);
    await fixtures.project(h.admin, other.customerId);

    const res = await call(h, 'GET', '/v1/me/export', as(b.accessToken));
    expect(res.status).toBe(200);
    expect(res.json.customer).toMatchObject({
      id: b.customerId,
      fullName: 'Export Me',
      phone: b.phone,
    });
    expect(res.json.addresses.map((a: { line1: string }) => a.line1)).toEqual(['Mine']);
    expect(res.json.projects).toHaveLength(1);
    expect(res.json.consents.map((c: { purpose: string }) => c.purpose)).toEqual(['terms']);
    expect(JSON.stringify(res.json)).not.toContain(other.phone);
    expect(JSON.stringify(res.json)).not.toContain(sha256Hex(b.refreshToken));
  });

  it('export and erasure are for registered buyers only', async () => {
    const { guestToken } = (await call(h, 'POST', '/v1/auth/guest')).json;
    expect((await call(h, 'GET', '/v1/me/export', { headers: guestAuth(guestToken) })).status).toBe(
      403,
    );
    expect(
      (await call(h, 'POST', '/v1/me/erasure', { headers: guestAuth(guestToken) })).status,
    ).toBe(403);
    expect((await call(h, 'GET', '/v1/me/export')).status).toBe(401);
  });
});
