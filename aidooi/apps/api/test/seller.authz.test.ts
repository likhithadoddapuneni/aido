import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './support/harness.ts';
import { aBuyer, anOffer, anOps, api, sellerOf, type TestSeller } from './support/seller.ts';

let h: Harness;
let owner: TestSeller;
let manager: TestSeller;
let staff: TestSeller;
let other: TestSeller;
let offerId: string;

beforeAll(async () => {
  h = await startHarness();
  owner = await sellerOf(h, 'seller_owner');
  manager = await sellerOf(h, 'seller_manager');
  staff = await sellerOf(h, 'seller_staff');
  other = await sellerOf(h, 'seller_owner', 'PRT-002');
  offerId = (await anOffer(h, owner.partnerId)).id;
});
afterAll(() => h.close());

type Call = [method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown];
const ROUTES: { name: string; call: () => Call; who: 'any' | 'manager' | 'owner' }[] = [
  { name: 'profile', call: () => ['GET', '/v1/seller/profile'], who: 'any' },
  {
    name: 'update profile',
    call: () => ['PATCH', '/v1/seller/profile', { tradeName: 'X Co' }],
    who: 'manager',
  },
  { name: 'locations', call: () => ['GET', '/v1/seller/locations'], who: 'any' },
  {
    name: 'create location',
    call: () => [
      'POST',
      '/v1/seller/locations',
      { name: 'N', address: 'A road', emirate: 'Dubai' },
    ],
    who: 'manager',
  },
  { name: 'offers', call: () => ['GET', '/v1/seller/offers'], who: 'any' },
  { name: 'offer', call: () => ['GET', `/v1/seller/offers/${offerId}`], who: 'any' },
  { name: 'products', call: () => ['GET', '/v1/seller/products'], who: 'manager' },
  { name: 'imports', call: () => ['GET', '/v1/seller/imports'], who: 'manager' },
  { name: 'template', call: () => ['GET', '/v1/seller/imports/template.csv'], who: 'any' },
  { name: 'team', call: () => ['GET', '/v1/seller/team'], who: 'owner' },
  {
    name: 'invite',
    call: () => [
      'POST',
      '/v1/seller/team/invitations',
      { email: 'a@b.co', fullName: 'Ab', role: 'seller_staff' },
    ],
    who: 'owner',
  },
  { name: 'performance', call: () => ['GET', '/v1/seller/performance'], who: 'manager' },
];

describe('who may call what', () => {
  it.each(ROUTES)('$name: anonymous → 401; buyer and ops → 403', async ({ call }) => {
    const [m, u, b] = call();
    expect((await api(h, m, u, null, b)).status).toBe(401);
    expect((await api(h, m, u, aBuyer(), b)).status).toBe(403);
    expect((await api(h, m, u, anOps(), b)).status).toBe(403);
  });

  it.each(ROUTES)('$name: role gate', async ({ call, who }) => {
    const [m, u, b] = call();
    const allowed = { any: [owner, manager, staff], manager: [owner, manager], owner: [owner] }[
      who
    ];
    const denied = [owner, manager, staff].filter((s) => !allowed.includes(s));
    for (const s of denied)
      expect(
        (await api(h, m, u, s.actor, b)).status,
        `${s.actor.kind === 'seller' ? s.actor.role : ''}`,
      ).toBe(403);
    // Every allowed role gets past authorisation (anything but 401/403).
    for (const s of allowed)
      expect([401, 403]).not.toContain((await api(h, m, u, s.actor, b)).status);
  });

  it("another partner's offer, location, import and team member do not exist for you", async () => {
    expect((await api(h, 'GET', `/v1/seller/offers/${offerId}`, other.actor)).status).toBe(404);
    expect(
      (
        await api(h, 'PATCH', `/v1/seller/locations/${owner.locationId}`, other.actor, {
          name: 'Hijack',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(h, 'PATCH', `/v1/seller/team/${owner.userId}`, other.actor, {
          status: 'Disabled',
        })
      ).status,
    ).toBe(404);
    expect((await api(h, 'GET', `/v1/seller/imports/${owner.userId}`, other.actor)).status).toBe(
      404,
    );
    const list = await api(h, 'GET', '/v1/seller/offers?limit=100', other.actor);
    expect(list.json.items.every((o: { id: string }) => o.id !== offerId)).toBe(true);
  });
});
