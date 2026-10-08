import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpsRole } from '../src/http/actor.ts';
import { startHarness, buyer, guest, seller, type Harness } from './support/harness.ts';
import { as, opsActor } from './support/ops.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const ID = randomUUID();
const ALL: OpsRole[] = ['ops_admin', 'ops_catalogue', 'ops_support', 'ops_finance'];

interface Route {
  method: 'get' | 'post' | 'patch' | 'put';
  url: string;
  body?: unknown;
  /** Roles that may call it (ops_admin always may). */
  allowed: OpsRole[];
}

const REASON = 'because the desk said so';
const ROUTES: Route[] = [
  { method: 'get', url: '/v1/ops/partners', allowed: ALL },
  {
    method: 'post',
    url: '/v1/ops/partners',
    body: { legalName: 'X LLC', tradeName: 'X Co', commissionBps: 1000 },
    allowed: ['ops_catalogue'],
  },
  {
    method: 'patch',
    url: `/v1/ops/partners/${ID}`,
    body: { tradeName: 'Y Co' },
    allowed: ['ops_catalogue'],
  },
  {
    method: 'post',
    url: `/v1/ops/partners/${ID}/transition`,
    body: { to: 'Under Review', reason: REASON },
    allowed: ['ops_catalogue'],
  },
  {
    method: 'post',
    url: `/v1/ops/partners/${ID}/transition`,
    body: { to: 'Active', reason: REASON },
    allowed: [],
  },
  {
    method: 'post',
    url: `/v1/ops/partners/${ID}/transition`,
    body: { to: 'Inactive', reason: REASON },
    allowed: [],
  },
  {
    method: 'post',
    url: `/v1/ops/partners/${ID}/owner-invitation`,
    body: { email: 'o@x.test', fullName: 'Owner Person' },
    allowed: ['ops_catalogue'],
  },
  { method: 'get', url: `/v1/ops/partners/${ID}/team`, allowed: ['ops_catalogue'] },
  { method: 'get', url: '/v1/ops/products', allowed: ['ops_catalogue'] },
  { method: 'get', url: '/v1/ops/products/stats', allowed: ['ops_catalogue'] },
  { method: 'post', url: '/v1/ops/products/AID-00000001/verify', allowed: ['ops_catalogue'] },
  {
    method: 'post',
    url: '/v1/ops/products/AID-00000001/reject',
    body: { reasons: ['blurry photos'] },
    allowed: ['ops_catalogue'],
  },
  { method: 'get', url: '/v1/ops/compat-maps', allowed: ['ops_catalogue'] },
  {
    method: 'post',
    url: '/v1/ops/compat-maps/style/approve',
    body: { version: '2026.1-draft', reviewNote: REASON },
    allowed: [],
  },
  {
    method: 'post',
    url: '/v1/ops/compat-maps/style/retire',
    body: { version: '2026.1-draft', reason: REASON },
    allowed: [],
  },
  { method: 'get', url: '/v1/ops/orders', allowed: ['ops_support', 'ops_finance'] },
  { method: 'get', url: `/v1/ops/orders/${ID}`, allowed: ['ops_support', 'ops_finance'] },
  {
    method: 'post',
    url: `/v1/ops/orders/${ID}/notes`,
    body: { body: 'called customer' },
    allowed: ['ops_support'],
  },
  { method: 'get', url: `/v1/ops/customers/${ID}`, allowed: ['ops_support', 'ops_finance'] },
  { method: 'get', url: '/v1/ops/viewings', allowed: ['ops_support', 'ops_finance'] },
  { method: 'get', url: '/v1/ops/staff', allowed: [] },
  {
    method: 'post',
    url: '/v1/ops/staff',
    body: { email: 'n@x.test', fullName: 'New Person', role: 'ops_support' },
    allowed: [],
  },
  { method: 'patch', url: `/v1/ops/staff/${ID}`, body: { role: 'ops_support' }, allowed: [] },
  { method: 'post', url: `/v1/ops/staff/${ID}/mfa-reset`, body: { reason: REASON }, allowed: [] },
  {
    method: 'post',
    url: `/v1/ops/seller-users/${ID}/mfa-reset`,
    body: { reason: REASON },
    allowed: [],
  },
  { method: 'get', url: '/v1/ops/audit', allowed: ['ops_support'] },
  { method: 'get', url: '/v1/ops/feature-flags', allowed: [] },
  { method: 'put', url: '/v1/ops/feature-flags/new.flag', body: { enabled: true }, allowed: [] },
  { method: 'get', url: '/v1/ops/overview', allowed: ALL },
];

describe('authorisation matrix', () => {
  for (const r of ROUTES) {
    const label = `${r.method.toUpperCase()} ${r.url.replace(ID, ':id')}${r.body && 'to' in (r.body as object) ? ` → ${(r.body as { to: string }).to}` : ''}`;
    it(label, async () => {
      for (const role of ALL) {
        const actor = await opsActor(h, role);
        const api = as(h, actor);
        const res = await (r.method === 'get'
          ? api.get(r.url)
          : api[r.method](r.url, r.body as never));
        const may = role === 'ops_admin' || r.allowed.includes(role);
        if (may) expect([401, 403], `${role} should pass the role check`).not.toContain(res.status);
        else {
          expect(res.status, `${role} should be refused`).toBe(403);
          expect(res.json.code).toBe('forbidden');
        }
      }
    });
  }

  it('anonymous callers get 401; buyers, guests and sellers get 403 on every route', async () => {
    const partner = [...(h.seeded?.partners.values() ?? [])][0]!;
    const others = [buyer(randomUUID()), guest(), seller(partner)];
    for (const r of ROUTES) {
      const anon = await (r.method === 'get'
        ? as(h, null).get(r.url)
        : as(h, null)[r.method](r.url, r.body as never));
      expect(anon.status, r.url).toBe(401);
      for (const who of others) {
        const api = as(h, who);
        const res = await (r.method === 'get'
          ? api.get(r.url)
          : api[r.method](r.url, r.body as never));
        expect(res.status, `${who.kind} ${r.url}`).toBe(403);
      }
    }
  });
});
