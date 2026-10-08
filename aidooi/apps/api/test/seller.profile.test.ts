import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures } from '@aidooi/db/testing';
import { startHarness, type Harness } from './support/harness.ts';
import { api, sellerOf, type TestSeller } from './support/seller.ts';

let h: Harness;
let owner: TestSeller;
let staff: TestSeller;

beforeAll(async () => {
  h = await startHarness();
  owner = await sellerOf(h, 'seller_owner');
  staff = await sellerOf(h, 'seller_staff');
});
afterAll(() => h.close());

const partnerRow = () =>
  h.admin
    .selectFrom('catalogue.partner')
    .selectAll()
    .where('id', '=', owner.partnerId)
    .executeTakeFirstOrThrow();

describe('profile', () => {
  it('shows the seller their own record, including read-only facts', async () => {
    const r = await api(h, 'GET', '/v1/seller/profile', owner.actor);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      code: 'PRT-0001',
      tradeName: 'Marina Living',
      legalName: 'Marina Living LLC',
      status: 'Active',
    });
    expect(JSON.stringify(r.json)).not.toMatch(/commission/i);
  });

  it('updates the four fields a seller owns and audits before/after', async () => {
    const r = await api(h, 'PATCH', '/v1/seller/profile', owner.actor, {
      tradeName: 'Marina Living Dubai',
      contactEmail: 'hello@marina.test',
      contactPhone: '+97141234567',
      afterSalesTerms: 'Returns within 14 days.',
    });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({
      tradeName: 'Marina Living Dubai',
      contactEmail: 'hello@marina.test',
      afterSalesTerms: 'Returns within 14 days.',
    });
    const audit = await h.admin
      .selectFrom('audit.event')
      .select('data')
      .where('entity_type', '=', 'partner')
      .where('entity_id', '=', owner.partnerId)
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data).toMatchObject({
      before: { trade_name: 'Marina Living' },
      after: { trade_name: 'Marina Living Dubai' },
    });
  });

  it.each([
    ['commission_rate', { commissionRate: 0 }],
    ['commission_rate (snake)', { commission_rate: 0 }],
    ['status', { status: 'Inactive' }],
    ['code', { code: 'PRT-9999' }],
    ['legal name', { legalName: 'Evil LLC' }],
    ['tax number', { taxRegistrationNo: '123' }],
    ['partner id', { partnerId: '00000000-0000-4000-8000-000000000000' }],
  ])('refuses a request naming %s, and changes nothing', async (_label, body) => {
    const before = await partnerRow();
    const r = await api(h, 'PATCH', '/v1/seller/profile', owner.actor, {
      tradeName: 'Sneaky',
      ...body,
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('validation_failed');
    expect(await partnerRow()).toEqual(before);
  });

  it('rejects an empty update, bad contact formats and staff', async () => {
    expect((await api(h, 'PATCH', '/v1/seller/profile', owner.actor, {})).status).toBe(400);
    expect(
      (await api(h, 'PATCH', '/v1/seller/profile', owner.actor, { contactPhone: '055 123' }))
        .status,
    ).toBe(400);
    expect(
      (await api(h, 'PATCH', '/v1/seller/profile', owner.actor, { contactEmail: 'nope' })).status,
    ).toBe(400);
    expect(
      (await api(h, 'PATCH', '/v1/seller/profile', staff.actor, { tradeName: 'Staff Edit' }))
        .status,
    ).toBe(403);
  });
});

describe('showrooms', () => {
  it('lists, creates and edits my showrooms, with audit', async () => {
    const created = await api(h, 'POST', '/v1/seller/locations', owner.actor, {
      name: 'Jebel Ali Warehouse',
      address: 'Plot 12, JAFZA',
      emirate: 'Dubai',
      lat: 25.0,
      lng: 55.1,
      openingHours: { mon: [{ open: '09:00', close: '18:00' }] },
    });
    expect(created.status, created.text).toBe(201);
    expect(created.json).toMatchObject({
      name: 'Jebel Ali Warehouse',
      status: 'Active',
      lat: 25,
      lng: 55.1,
    });
    const id = created.json.id as string;
    const edited = await api(h, 'PATCH', `/v1/seller/locations/${id}`, owner.actor, {
      address: 'Plot 14, JAFZA',
      openingHours: { sat: [{ open: '10:00', close: '14:00' }] },
    });
    expect(edited.json).toMatchObject({
      address: 'Plot 14, JAFZA',
      openingHours: { sat: [{ open: '10:00', close: '14:00' }] },
    });
    const list = await api(h, 'GET', '/v1/seller/locations', owner.actor);
    expect(list.json.locations.map((l: { id: string }) => l.id)).toContain(id);
    expect(
      await h.admin.selectFrom('audit.event').select('id').where('entity_id', '=', id).execute(),
    ).toHaveLength(2);
  });

  it('needs both lat and lng or neither; refuses other fields (partner id, status on create)', async () => {
    expect(
      (
        await api(h, 'POST', '/v1/seller/locations', owner.actor, {
          name: 'N',
          address: 'A road',
          emirate: 'Dubai',
          lat: 25,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(h, 'POST', '/v1/seller/locations', owner.actor, {
          name: 'N',
          address: 'A road',
          emirate: 'Dubai',
          partnerId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(h, 'POST', '/v1/seller/locations', owner.actor, {
          name: 'N',
          address: 'A road',
          emirate: 'Narnia',
        })
      ).status,
    ).toBe(400);
  });

  it('cannot close a showroom that still has live offers', async () => {
    const r = await api(h, 'PATCH', `/v1/seller/locations/${owner.locationId}`, owner.actor, {
      status: 'Inactive',
    });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('location_has_live_offers');
  });

  it('cannot close a showroom with a booked viewing, but can once it is empty', async () => {
    const loc = (
      await api(h, 'POST', '/v1/seller/locations', owner.actor, {
        name: 'Pop-up',
        address: 'Mall of the Emirates',
        emirate: 'Dubai',
      })
    ).json.id as string;
    const customer = await fixtures.customer(h.admin);
    const project = await fixtures.project(h.admin, customer);
    const vr = await h.admin
      .insertInto('viewing.viewing_request')
      .values({ customer_id: customer, project_id: project, state: 'Awaiting Seller Confirmation' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.admin
      .insertInto('viewing.viewing_stop')
      .values({
        viewing_request_id: vr.id,
        partner_id: owner.partnerId,
        partner_location_id: loc,
        stop_no: 1,
      })
      .execute();
    const blocked = await api(h, 'PATCH', `/v1/seller/locations/${loc}`, owner.actor, {
      status: 'Inactive',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe('location_has_viewings');
    await h.admin
      .updateTable('viewing.viewing_request')
      .set({ state: 'Cancelled' })
      .where('id', '=', vr.id)
      .execute();
    expect(
      (await api(h, 'PATCH', `/v1/seller/locations/${loc}`, owner.actor, { status: 'Inactive' }))
        .status,
    ).toBe(200);
  });
});
