import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPAT_MAP_VERSION } from '@aidooi/domain';
import { call, nextStep, onboardStaff, totpNow } from './support/auth-helpers.ts';
import { guest, startHarness, type Harness } from './support/harness.ts';
import { as, opsActor } from './support/ops.ts';
import { createOrder } from './support/orders.ts';
import { isEnabled, bucketOf } from '../src/feature-flags.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const reviewNote = 'Reviewed against the merchandising brief.';

describe('compatibility-map governance (gap 5), end to end', () => {
  const living = {
    pathId: 'livingRoom',
    lengthM: 5,
    widthM: 4,
    style: 'modern',
    colour: 'grey',
    tier: 'Standard',
  };
  const session = '9d000000-0000-4000-8000-000000000001';

  it('unapproved → the engine refuses; approve through the API → it runs; retire → it refuses again', async () => {
    await h.admin
      .insertInto('identity.guest_session')
      .values({
        id: session,
        token_hash: 'gov-hash',
        expires_at: new Date(Date.now() + 86_400_000),
      })
      .execute();
    const buyerApi = as(h, guest(session));
    const admin = as(h, await opsActor(h, 'ops_admin'));
    const cat = as(h, await opsActor(h, 'ops_catalogue'));
    const project = (await buyerApi.post('/v1/projects', { input: living })).json;

    // Seeded as approved: shows as such, with matching hashes.
    const before = (await cat.get('/v1/ops/compat-maps')).json.maps;
    expect(before.map((m: { state: string }) => m.state)).toEqual([
      'approved',
      'approved',
      'approved',
    ]);
    expect(before[0].versions[0]).toMatchObject({
      version: COMPAT_MAP_VERSION,
      matchesDeployedCode: true,
    });

    // Un-approve all three (as if the deployed version had never been signed off).
    await h.admin.updateTable('catalogue.compat_map_version').set({ activated_at: null }).execute();
    const refused = await buyerApi.post(`/v1/projects/${project.id}/recommend`);
    expect(refused.status).toBe(422);
    expect(refused.json.code).toBe('compat_map_not_approved');
    expect(
      (await cat.get('/v1/ops/compat-maps')).json.maps.map((m: { state: string }) => m.state),
    ).toEqual(['unapproved', 'unapproved', 'unapproved']);

    // The catalogue desk cannot approve; an administrator can.
    expect(
      (
        await cat.post('/v1/ops/compat-maps/style/approve', {
          version: COMPAT_MAP_VERSION,
          reviewNote,
        })
      ).status,
    ).toBe(403);
    for (const kind of ['style', 'colour', 'material']) {
      const r = await admin.post(`/v1/ops/compat-maps/${kind}/approve`, {
        version: COMPAT_MAP_VERSION,
        reviewNote,
      });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.state).toBe('approved');
    }
    const ok = await buyerApi.post(`/v1/projects/${project.id}/recommend`);
    expect(ok.status).toBe(200);
    expect(ok.json.runs[0].status).toBe('Completed');

    // Approval is idempotent and audited with the reviewer's note.
    expect(
      (
        await admin.post('/v1/ops/compat-maps/style/approve', {
          version: COMPAT_MAP_VERSION,
          reviewNote,
        })
      ).status,
    ).toBe(200);
    const ev = await h.admin
      .selectFrom('audit.event')
      .select(['reason', 'actor_type'])
      .where('entity_type', '=', 'compat_map')
      .where('entity_id', '=', `style:${COMPAT_MAP_VERSION}`)
      .executeTakeFirstOrThrow();
    expect(ev).toMatchObject({ reason: reviewNote, actor_type: 'ops_user' });

    // Retire: the engine stops again, and the version cannot simply be re-approved.
    expect(
      (
        await admin.post('/v1/ops/compat-maps/colour/retire', {
          version: COMPAT_MAP_VERSION,
          reason: 'taxonomy review',
        })
      ).json.state,
    ).toBe('retired');
    expect((await buyerApi.post(`/v1/projects/${project.id}/recommend`)).json.code).toBe(
      'compat_map_not_approved',
    );
    const again = await admin.post('/v1/ops/compat-maps/colour/approve', {
      version: COMPAT_MAP_VERSION,
      reviewNote,
    });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('version_retired');
  });

  it('only the deployed version can be approved, and differing approved content is refused', async () => {
    const admin = as(h, await opsActor(h, 'ops_admin'));
    const wrong = await admin.post('/v1/ops/compat-maps/material/approve', {
      version: '1999.1',
      reviewNote,
    });
    expect(wrong.status).toBe(422);
    expect(wrong.json.code).toBe('version_not_deployed');
    // Someone approved different text under the same version label: the API must not paper over it.
    await h.admin
      .updateTable('catalogue.compat_map_version')
      .set({ activated_at: null })
      .where('kind', '=', 'material')
      .execute();
    await h.admin
      .insertInto('catalogue.compat_map_version')
      .values({
        kind: 'material',
        version: 'x',
        content: '{}',
        approved_by: (await opsActor(h)).opsUserId,
        activated_at: new Date(),
      })
      .execute();
    const listing = (await admin.get('/v1/ops/compat-maps')).json.maps.find(
      (m: { kind: string }) => m.kind === 'material',
    );
    expect(
      listing.versions.find((v: { version: string }) => v.version === 'x').matchesDeployedCode,
    ).toBe(false);
  });
});

describe('staff administration', () => {
  it('invites an ops user (token only by notification), lists them, changes role', async () => {
    const admin = as(h, await opsActor(h, 'ops_admin'));
    const inv = await admin.post('/v1/ops/staff', {
      email: 'New.Person@aidooi.test',
      fullName: 'New Person',
      role: 'ops_support',
    });
    expect(inv.status).toBe(201);
    expect(JSON.stringify(inv.json)).not.toMatch(/token/i);
    expect(
      h.notifier
        .ofTemplate('staff.invited')
        .some((n) => n.data['email'] === 'new.person@aidooi.test'),
    ).toBe(true);
    const row = (await admin.get('/v1/ops/staff')).json.staff.find(
      (s: { id: string }) => s.id === inv.json.userId,
    );
    expect(row).toMatchObject({
      email: 'new.person@aidooi.test',
      role: 'ops_support',
      hasCredential: false,
    });
    expect(
      (await admin.patch(`/v1/ops/staff/${inv.json.userId}`, { role: 'ops_finance' })).json.role,
    ).toBe('ops_finance');
  });

  it('the last administrator who can sign in cannot be demoted or disabled', async () => {
    // A fresh database so "the only admin" is exactly the one we make.
    const solo = await startHarness({ seed: false });
    try {
      const only = await onboardStaff(solo, 'ops', { role: 'ops_admin' });
      const actor = as(solo, { kind: 'ops', opsUserId: only.userId, role: 'ops_admin' });
      const demote = await actor.patch(`/v1/ops/staff/${only.userId}`, { role: 'ops_support' });
      expect(demote.status).toBe(409);
      expect(demote.json.code).toBe('last_admin');
      expect(
        (await actor.patch(`/v1/ops/staff/${only.userId}`, { status: 'Disabled' })).json.code,
      ).toBe('last_admin');
      // An invited-but-unaccepted admin is not a safeguard…
      const pending = (
        await actor.post('/v1/ops/staff', {
          email: 'pending@aidooi.test',
          fullName: 'Pending Admin',
          role: 'ops_admin',
        })
      ).json;
      expect(
        (await actor.patch(`/v1/ops/staff/${only.userId}`, { role: 'ops_support' })).status,
      ).toBe(409);
      // …but a second admin who can sign in is.
      const second = await onboardStaff(solo, 'ops', { role: 'ops_admin' });
      expect(
        (await actor.patch(`/v1/ops/staff/${only.userId}`, { role: 'ops_support' })).status,
      ).toBe(200);
      // And now the second is the last one.
      const secondActor = as(solo, { kind: 'ops', opsUserId: second.userId, role: 'ops_admin' });
      expect(
        (await secondActor.patch(`/v1/ops/staff/${second.userId}`, { status: 'Disabled' })).json
          .code,
      ).toBe('last_admin');
      void pending;
    } finally {
      await solo.close();
    }
  });

  it('disabling a user ends their sessions', async () => {
    const admin = as(h, await opsActor(h, 'ops_admin'));
    const victim = await onboardStaff(h, 'ops', { role: 'ops_support' });
    expect(
      (await admin.patch(`/v1/ops/staff/${victim.userId}`, { status: 'Disabled' })).json.status,
    ).toBe('Disabled');
    const refresh = await call(h, 'POST', '/v1/auth/refresh', {
      body: { refreshToken: victim.refreshToken },
    });
    expect(refresh.status).toBe(401);
  });

  it('MFA reset revokes sessions, kills the old authenticator, and allows re-enrolment', async () => {
    const admin = as(h, await opsActor(h, 'ops_admin'));
    const staff = await onboardStaff(h, 'ops', { role: 'ops_support' });
    const login = (code: string) =>
      call(h, 'POST', '/v1/auth/staff/login', {
        body: { email: staff.email, password: staff.password, totpCode: code },
      });
    nextStep(h);
    expect((await login(totpNow(h, staff.seed))).status).toBe(200);

    const res = await admin.post(`/v1/ops/staff/${staff.userId}/mfa-reset`, {
      reason: 'Lost phone, identity checked by phone.',
    });
    expect(res.status).toBe(200);
    expect(res.json.revokedSessions).toBeGreaterThanOrEqual(2);

    expect(
      (await call(h, 'POST', '/v1/auth/refresh', { body: { refreshToken: staff.refreshToken } }))
        .status,
    ).toBe(401);
    nextStep(h);
    const old = await login(totpNow(h, staff.seed));
    expect(old.status).toBe(403);
    expect(old.json.code).toBe('mfa_enrolment_required');

    const enrol = await call(h, 'POST', '/v1/auth/staff/mfa/enroll', {
      body: { email: staff.email, password: staff.password },
    });
    expect(enrol.status).toBe(200);
    expect(enrol.json.seed).not.toBe(staff.seed);
    const confirm = await call(h, 'POST', '/v1/auth/staff/mfa/verify', {
      body: { email: staff.email, password: staff.password, totpCode: totpNow(h, enrol.json.seed) },
    });
    expect(confirm.status).toBe(200);
    nextStep(h);
    expect((await login(totpNow(h, staff.seed))).status).toBe(401); // the old seed no longer works
    nextStep(h);
    expect((await login(totpNow(h, enrol.json.seed))).status).toBe(200);

    const ev = await h.admin
      .selectFrom('audit.event')
      .select(['reason', 'actor_type'])
      .where('entity_type', '=', 'ops_user')
      .where('entity_id', '=', staff.userId)
      .where('to_state', '=', 'mfa_reset')
      .executeTakeFirstOrThrow();
    expect(ev).toMatchObject({
      reason: 'Lost phone, identity checked by phone.',
      actor_type: 'ops_user',
    });
  });

  it('works for seller users too, and refuses a user who never accepted their invitation', async () => {
    const admin = as(h, await opsActor(h, 'ops_admin'));
    const seller = await onboardStaff(h, 'seller');
    expect(
      (
        await admin.post(`/v1/ops/seller-users/${seller.userId}/mfa-reset`, {
          reason: 'Lost phone, verified.',
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(h, 'POST', '/v1/auth/refresh', { body: { refreshToken: seller.refreshToken } }))
        .status,
    ).toBe(401);
    const invited = (
      await admin.post('/v1/ops/staff', {
        email: 'never@aidooi.test',
        fullName: 'Never Accepted',
        role: 'ops_support',
      })
    ).json;
    const refused = await admin.post(`/v1/ops/staff/${invited.userId}/mfa-reset`, {
      reason: 'Just in case.',
    });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('no_credential');
  });
});

describe('audit viewer', () => {
  it('filters and paginates newest-first without repeating or skipping events', async () => {
    const support = as(h, await opsActor(h, 'ops_support'));
    const admin = as(h, await opsActor(h, 'ops_admin'));
    for (let i = 0; i < 7; i++)
      await admin.put('/v1/ops/feature-flags/audit.probe', { enabled: i % 2 === 0 });
    const all: { id: string; at: string }[] = [];
    let cursor: string | null = null;
    do {
      const page: { json: { items: { id: string; at: string }[]; nextCursor: string | null } } =
        await support.get(
          `/v1/ops/audit?entityType=feature_flag&entityId=audit.probe&limit=3${cursor ? `&cursor=${cursor}` : ''}`,
        );
      all.push(...page.json.items);
      cursor = page.json.nextCursor;
    } while (cursor);
    expect(all).toHaveLength(7);
    expect(new Set(all.map((e) => e.id)).size).toBe(7);
    expect(all.map((e) => e.at)).toEqual([...all.map((e) => e.at)].sort().reverse());
    const none = await support.get(
      `/v1/ops/audit?entityType=feature_flag&entityId=audit.probe&to=2000-01-01T00:00:00.000Z`,
    );
    expect(none.json.items).toEqual([]);
    expect((await support.get('/v1/ops/audit?from=not-a-date')).status).toBe(400);
  });
});

describe('feature flags', () => {
  it('creates, changes and reads a flag, auditing each change; isEnabled honours rollout deterministically', async () => {
    const admin = as(h, await opsActor(h, 'ops_admin'));
    expect((await admin.get('/v1/ops/feature-flags/new.thing')).status).toBe(404);
    expect(await isEnabled(h.ctx, 'new.thing', 'c1')).toBe(false);
    const put = await admin.put('/v1/ops/feature-flags/new.thing', {
      enabled: true,
      rolloutPct: 100,
      description: 'New thing',
    });
    expect(put.status).toBe(200);
    expect(await isEnabled(h.ctx, 'new.thing')).toBe(true);
    await admin.put('/v1/ops/feature-flags/new.thing', { enabled: true, rolloutPct: 30 });
    expect(await isEnabled(h.ctx, 'new.thing')).toBe(false); // partial rollout needs a subject
    const subjects = Array.from({ length: 400 }, (_, i) => `customer-${i}`);
    const on = (await Promise.all(subjects.map((s) => isEnabled(h.ctx, 'new.thing', s)))).filter(
      Boolean,
    ).length;
    expect(on).toBeGreaterThan(80);
    expect(on).toBeLessThan(160); // ≈30% of 400
    expect(bucketOf('new.thing', 'customer-1')).toBe(bucketOf('new.thing', 'customer-1'));
    await admin.put('/v1/ops/feature-flags/new.thing', { enabled: false });
    expect(await isEnabled(h.ctx, 'new.thing', 'customer-1')).toBe(false);
    const trail = await h.admin
      .selectFrom('audit.event')
      .select(['from_state', 'to_state'])
      .where('entity_type', '=', 'feature_flag')
      .where('entity_id', '=', 'new.thing')
      .orderBy('at')
      .execute();
    expect(trail.map((t) => t.to_state)).toEqual(['on 100%', 'on 30%', 'off']);
    expect((await admin.put('/v1/ops/feature-flags/Bad Key', { enabled: true })).status).toBe(400);
    expect(
      (await admin.get('/v1/ops/feature-flags')).json.flags.some(
        (f: { key: string }) => f.key === 'new.thing',
      ),
    ).toBe(true);
  });
});

describe('overview', () => {
  it('counts match a constructed fixture', async () => {
    const solo = await startHarness();
    try {
      const api = as(solo, await opsActor(solo, 'ops_finance'));
      const zero = (await api.get('/v1/ops/overview')).json;
      expect(zero).toMatchObject({
        verificationQueue: 0,
        openIssues: 0,
        confirmationsPastHalfSla: 0,
        paymentsStuckAuthorized: 0,
        settlementRunsAwaitingApproval: 0,
      });

      // 2 products awaiting review.
      const opsId = (await opsActor(solo)).opsUserId;
      const { fixtures } = await import('@aidooi/db/testing');
      await fixtures.product(solo.admin, opsId, { data_status: 'Ready for Review' });
      await fixtures.product(solo.admin, opsId, { data_status: 'Ready for Review' });

      // 1 open issue, via a real order line.
      const order = await createOrder(solo, { lines: [{ partner: 'PRT-001' }] });
      await solo.admin
        .insertInto('fulfilment.issue')
        .values({
          order_line_id: order.lineIds[0]!,
          partner_id: order.partnerIds[0]!,
          customer_id: order.customerId,
          flag: 'Delayed',
        })
        .execute();

      // 1 confirmation task past half its SLA, 1 not yet.
      const pr = await solo.admin
        .insertInto('commerce.purchase_request')
        .values({ customer_id: order.customerId, total_fils: 100 })
        .returning('id')
        .executeTakeFirstOrThrow();
      const res = await solo.admin
        .insertInto('commerce.reservation')
        .values({ purchase_request_id: pr.id, expires_at: new Date(Date.now() + 86_400_000) })
        .returning('id')
        .executeTakeFirstOrThrow();
      const mk = (createdMsAgo: number, dueInMs: number) =>
        solo.admin
          .insertInto('commerce.confirmation_task')
          .values({
            task_type: 'purchase',
            partner_id: order.partnerIds[0]!,
            reservation_id: res.id,
            due_at: new Date(solo.clock.now() + dueInMs),
            created_at: new Date(solo.clock.now() - createdMsAgo),
          })
          .execute();
      await mk(3 * 3_600_000, 3_600_000); // 3h in of a 4h SLA → past half
      await mk(60_000, 4 * 3_600_000 - 60_000); // just created

      // 1 payment authorised for over five minutes (stuck), 1 fresh; 2 settlement runs, only the Draft one awaits approval.
      const pay = async (ageMs: number) => {
        // One live order payment per purchase request, so each gets its own.
        const own = await solo.admin
          .insertInto('commerce.purchase_request')
          .values({ customer_id: order.customerId, total_fils: 100 })
          .returning('id')
          .executeTakeFirstOrThrow();
        await solo.admin
          .insertInto('commerce.payment')
          .values({
            purpose: 'Order',
            customer_id: order.customerId,
            purchase_request_id: own.id,
            state: 'Authorized',
            amount_fils: 100,
            idempotency_key: `ovw-${ageMs}`,
            authorized_at: new Date(solo.clock.now() - ageMs),
          })
          .execute();
      };
      await pay(10 * 60_000);
      await pay(60_000);
      const approver = (await opsActor(solo)).opsUserId;
      await solo.admin
        .insertInto('settlement.settlement_run')
        .values([
          { partner_id: order.partnerIds[0]!, period: '2026-08' },
          {
            partner_id: order.partnerIds[0]!,
            period: '2026-07',
            state: 'Approved',
            approved_by: approver,
            approved_at: new Date(),
          },
        ])
        .execute();

      const o = (await api.get('/v1/ops/overview')).json;
      expect(o.verificationQueue).toBe(2);
      expect(o.openIssues).toBe(1);
      expect(o.confirmationsPastHalfSla).toBe(1);
      expect(o.paymentsStuckAuthorized).toBe(1);
      expect(o.settlementRunsAwaitingApproval).toBe(1);
    } finally {
      await solo.close();
    }
  });
});
