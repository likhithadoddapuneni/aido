import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { masterStatus, type OrderLineState } from '@aidooi/domain';
import { startHarness, type Harness } from './support/harness.ts';
import { as, opsActor } from './support/ops.ts';
import { confirmDirect, createOrder } from './support/orders.ts';
import { bookViewing } from './support/viewing.ts';

let h: Harness;
let support: ReturnType<typeof as>;
let supportUser: string;
beforeAll(async () => {
  h = await startHarness();
  const a = await opsActor(h, 'ops_support');
  supportUser = a.opsUserId;
  support = as(h, a);
});
afterAll(() => h.close());

const piiReads = async (like?: string) => {
  const rows = await h.admin
    .selectFrom('audit.event')
    .select(['entity_id', 'data', 'actor_type', 'actor_id'])
    .where('entity_type', '=', 'pii_read')
    .execute();
  return rows.filter((r) => !like || r.entity_id.startsWith(like));
};

describe('order search', () => {
  it('finds an order by id, by customer phone (full or last digits), by email, and by partner', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }, { partner: 'PRT-002' }] });
    const cust = await h.admin
      .selectFrom('identity.customer')
      .select(['phone_e164'])
      .where('id', '=', o.customerId)
      .executeTakeFirstOrThrow();
    await h.admin
      .updateTable('identity.customer')
      .set({ email: 'findme@example.test' })
      .where('id', '=', o.customerId)
      .execute();
    const ids = async (q: string) =>
      (await support.get(`/v1/ops/orders?search=${encodeURIComponent(q)}`)).json.items.map(
        (i: { id: string }) => i.id,
      );

    expect(await ids(o.orderId)).toEqual([o.orderId]);
    expect(await ids(cust.phone_e164!)).toContain(o.orderId);
    expect(await ids(cust.phone_e164!.slice(-5))).toContain(o.orderId);
    expect(await ids('FindMe@Example.test')).toEqual([o.orderId]);
    expect(await ids('+971000000000')).toEqual([]);
    expect(await ids('12')).toEqual([]); // too short to be a phone suffix: never a fishing expedition

    const byPartner = (
      await support.get(`/v1/ops/orders?partnerId=${o.partnerIds[0]}&limit=100`)
    ).json.items.map((i: { id: string }) => i.id);
    expect(byPartner).toContain(o.orderId);
    const none = (
      await support.get(
        `/v1/ops/orders?partnerId=${o.partnerIds[0]}&search=${o.orderId}&status=Cancelled`,
      )
    ).json.items;
    expect(none).toEqual([]);
    expect((await support.get('/v1/ops/orders?cursor=%%')).status).toBe(400);
  });

  it('searching by a person writes a pii_read audit row that records the fields, never the value', async () => {
    const before = (await piiReads('order_search')).length;
    await support.get('/v1/ops/orders?search=findme%40example.test');
    const after = await piiReads('order_search');
    expect(after.length).toBe(before + 1);
    const row = after[after.length - 1]!;
    expect(row).toMatchObject({
      actor_type: 'ops_user',
      actor_id: supportUser,
      data: { fields: ['phone', 'email'] },
    });
    expect(JSON.stringify(row)).not.toContain('findme');
    // A search by order id reads no personal data and writes no pii row.
    const n = (await piiReads('order_search')).length;
    await support.get(`/v1/ops/orders?search=${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`);
    expect((await piiReads('order_search')).length).toBe(n);
  });

  it('paginates newest-first without repeats', async () => {
    for (let i = 0; i < 4; i++) await createOrder(h, { lines: [{ partner: 'PRT-004' }] });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { json: { items: { id: string }[]; nextCursor: string | null } } =
        await support.get(`/v1/ops/orders?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.json.items.map((i) => i.id));
      cursor = page.json.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(5);
  });

  it('the SQL status filter agrees with the domain rule for every kind of order', async () => {
    const fresh = await createOrder(h, { lines: [{ partner: 'PRT-005' }, { partner: 'PRT-005' }] });
    const done = await createOrder(h, { lines: [{ partner: 'PRT-005' }] });
    await confirmDirect(h, done.lineIds[0]!, new Date());
    const mixed = await createOrder(h, { lines: [{ partner: 'PRT-005' }, { partner: 'PRT-005' }] });
    await confirmDirect(h, mixed.lineIds[0]!, new Date());
    const issue = await createOrder(h, { lines: [{ partner: 'PRT-005' }] });
    await h.admin
      .insertInto('fulfilment.issue')
      .values({
        order_line_id: issue.lineIds[0]!,
        partner_id: issue.partnerIds[0]!,
        customer_id: issue.customerId,
        flag: 'Damaged',
      })
      .execute();
    const cancelled = await createOrder(h, { lines: [{ partner: 'PRT-005' }] });
    await h.admin
      .updateTable('fulfilment.order_line')
      .set({ state: 'Cancelled' })
      .where('id', '=', cancelled.lineIds[0]!)
      .execute();
    const partlyRefunded = await createOrder(h, {
      lines: [{ partner: 'PRT-005' }, { partner: 'PRT-005' }],
    });
    await h.admin
      .updateTable('fulfilment.order_line')
      .set({ state: 'Refunded' })
      .where('id', '=', partlyRefunded.lineIds[0]!)
      .execute();

    const orders = [fresh, done, mixed, issue, cancelled, partlyRefunded];
    const expected = new Map<string, string>();
    for (const o of orders) {
      const lines = await h.admin
        .selectFrom('fulfilment.order_line')
        .select(['id', 'state'])
        .where('master_order_id', '=', o.orderId)
        .execute();
      const open = await h.admin
        .selectFrom('fulfilment.issue')
        .select('order_line_id')
        .where('state', 'in', ['Open', 'Partner Handling'])
        .where(
          'order_line_id',
          'in',
          lines.map((l) => l.id),
        )
        .execute();
      expected.set(
        o.orderId,
        masterStatus(
          lines.map((l) => ({
            state: l.state as OrderLineState,
            openIssues: open.filter((i) => i.order_line_id === l.id).length,
          })),
        ),
      );
    }
    expect(new Set(expected.values())).toEqual(
      new Set(['Confirmed', 'Completed', 'In Progress', 'Issue Reported', 'Cancelled']),
    );
    for (const [id, status] of expected) {
      const hit = (await support.get(`/v1/ops/orders?search=${id}`)).json.items[0];
      expect(hit.status, id).toBe(status);
      const filtered = (
        await support.get(`/v1/ops/orders?status=${encodeURIComponent(status)}&limit=100`)
      ).json.items.map((i: { id: string }) => i.id);
      expect(filtered, id).toContain(id);
    }
  });
});

describe('order detail', () => {
  it('shows the whole order — lines, payment, refunds, ledger, delivery, audit — and audits the read', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-006', quantity: 2 }] });
    const before = (await piiReads(`master_order:${o.orderId}`)).length;
    const res = await support.get(`/v1/ops/orders/${o.orderId}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const d = res.json;
    expect(d.order).toMatchObject({
      id: o.orderId,
      grossFils: o.grossFils,
      paidFils: o.paidFils,
      lineCount: 1,
    });
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].grossLineFils).toBe(o.grossFils);
    expect(d.sellerOrders).toHaveLength(1);
    expect(d.payment).toMatchObject({ state: 'Successful', amountFils: o.paidFils });
    expect(d.delivery.phone).toMatch(/^\+/);
    expect(d.ledger.length).toBeGreaterThan(0);
    const net = d.ledger.reduce(
      (t: number, e: { direction: string; amountFils: number }) =>
        t + (e.direction === 'debit' ? e.amountFils : -e.amountFils),
      0,
    );
    expect(net).toBe(0);
    const after = await piiReads(`master_order:${o.orderId}`);
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({
      actor_id: supportUser,
      data: { fields: ['delivery'] },
    });
    expect(JSON.stringify(after)).not.toContain(d.delivery.line1);
    expect((await support.get(`/v1/ops/orders/${crypto.randomUUID()}`)).status).toBe(404);
  });

  it('notes are internal, append-only (API and database), and shown on the order', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-006' }] });
    const note = await support.post(`/v1/ops/orders/${o.orderId}/notes`, {
      body: 'Customer called; delivery window moved to Friday.',
    });
    expect(note.status).toBe(201);
    expect(note.json.opsUserId).toBe(supportUser);
    await support.post(`/v1/ops/orders/${o.orderId}/notes`, { body: 'Seller confirmed.' });
    const d = (await support.get(`/v1/ops/orders/${o.orderId}`)).json;
    expect(d.notes.map((n: { body: string }) => n.body)).toEqual([
      'Customer called; delivery window moved to Friday.',
      'Seller confirmed.',
    ]);

    await expect(
      h.admin
        .updateTable('commerce.order_note')
        .set({ body: 'edited' })
        .where('id', '=', note.json.id)
        .execute(),
    ).rejects.toThrow(/append-only|forbid|not allowed/i);
    await expect(
      h.admin.deleteFrom('commerce.order_note').where('id', '=', note.json.id).execute(),
    ).rejects.toThrow(/append-only|forbid|not allowed/i);
    // The application role cannot even attempt an UPDATE.
    await expect(
      h.database.app
        .updateTable('commerce.order_note')
        .set({ body: 'x' })
        .where('id', '=', note.json.id)
        .execute(),
    ).rejects.toThrow();

    expect((await support.post(`/v1/ops/orders/${o.orderId}/notes`, { body: '   ' })).status).toBe(
      400,
    );
    expect(
      (await support.post(`/v1/ops/orders/${crypto.randomUUID()}/notes`, { body: 'x' })).status,
    ).toBe(404);
  });

  it('notes are invisible to buyers and sellers (row-level security)', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-006' }] });
    await support.post(`/v1/ops/orders/${o.orderId}/notes`, { body: 'internal only' });
    const { withActor } = await import('@aidooi/db');
    const asSeller = await withActor(
      h.database.app,
      { kind: 'seller', partnerId: o.partnerIds[0]! },
      (t) => t.selectFrom('commerce.order_note').selectAll().execute(),
    );
    const asBuyer = await withActor(
      h.database.app,
      { kind: 'buyer', customerId: o.customerId },
      (t) => t.selectFrom('commerce.order_note').selectAll().execute(),
    );
    expect(asSeller).toEqual([]);
    expect(asBuyer).toEqual([]);
  });
});

describe('customers', () => {
  it('shows a masked summary and audits the read', async () => {
    const o = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
    await h.admin
      .updateTable('identity.customer')
      .set({ email: 'someone.private@example.test', full_name: 'Sam Private' })
      .where('id', '=', o.customerId)
      .execute();
    const phone = (
      await h.admin
        .selectFrom('identity.customer')
        .select('phone_e164')
        .where('id', '=', o.customerId)
        .executeTakeFirstOrThrow()
    ).phone_e164!;
    const res = await support.get(`/v1/ops/customers/${o.customerId}`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: o.customerId,
      fullName: 'Sam Private',
      emailMasked: 's***@example.test',
      orderCount: 1,
    });
    expect(res.json.phoneMasked).toMatch(/^\+971\*+\d{3}$/);
    expect(res.json.phoneMasked).not.toBe(phone);
    expect(JSON.stringify(res.json)).not.toContain('someone.private');
    expect((await piiReads(`customer:${o.customerId}`)).length).toBe(1);
    expect((await support.get(`/v1/ops/customers/${crypto.randomUUID()}`)).status).toBe(404);
  });
});

describe('viewings', () => {
  it('lists and shows a booked viewing with its stops, deposit and attribution', async () => {
    const booked = await bookViewing(h);
    const list = await support.get('/v1/ops/viewings?state=Confirmed&limit=100');
    const item = list.json.items.find((v: { id: string }) => v.id === booked.viewing.id);
    expect(item).toMatchObject({
      state: 'Confirmed',
      customerId: booked.customerId,
      depositState: 'Paid',
    });
    expect(item.depositFils).toBeGreaterThan(0);
    const detail = (await support.get(`/v1/ops/viewings/${booked.viewing.id}`)).json;
    expect(detail.stops.length).toBe(item.stopCount);
    expect(
      detail.stops.every(
        (s: { confirmationState: string; products: unknown[] }) =>
          s.confirmationState === 'Confirmed' && s.products.length > 0,
      ),
    ).toBe(true);
    expect(detail.attribution.map((a: { stage: string }) => a.stage)).toContain('Requested');
    const partner = detail.stops[0].partnerId;
    expect(
      (await support.get(`/v1/ops/viewings?partnerId=${partner}&limit=100`)).json.items.some(
        (v: { id: string }) => v.id === booked.viewing.id,
      ),
    ).toBe(true);
    expect(
      (await support.get('/v1/ops/viewings?state=Completed&limit=100')).json.items.some(
        (v: { id: string }) => v.id === booked.viewing.id,
      ),
    ).toBe(false);
    expect((await support.get(`/v1/ops/viewings/${crypto.randomUUID()}`)).status).toBe(404);
  });
});
