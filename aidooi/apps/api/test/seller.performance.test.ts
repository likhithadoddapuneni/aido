import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { fixtures } from '@aidooi/db/testing';
import { startHarness, type Harness } from './support/harness.ts';
import { createOrder } from './support/orders.ts';
import { api, sellerOf, type TestSeller } from './support/seller.ts';

let h: Harness;
let manager: TestSeller; // PRT-004: the partner whose numbers we check
let neighbour: TestSeller; // PRT-005: noise that must never leak in
const DAY = 86_400_000;
const HOUR = 3_600_000;
let now: number;
const at = (offsetMs: number) => new Date(now + offsetMs);

beforeAll(async () => {
  h = await startHarness();
  manager = await sellerOf(h, 'seller_manager', 'PRT-004');
  neighbour = await sellerOf(h, 'seller_manager', 'PRT-005');
  now = h.clock.now();
});
afterAll(() => h.close());

async function purchaseTask(
  s: TestSeller,
  o: {
    created: Date;
    answeredAfter?: number;
    response?: 'Confirmed' | 'Declined';
    bySeller?: boolean;
    due?: Date;
  },
) {
  const offer = await h.admin
    .selectFrom('catalogue.seller_offer')
    .select('id')
    .where('partner_id', '=', s.partnerId)
    .limit(1)
    .executeTakeFirstOrThrow();
  const customerId = await fixtures.customer(h.admin);
  const { reservationId } = await fixtures.reservation(h.admin, {
    customerId,
    offerId: offer.id,
    priceFils: 50_000,
  });
  await h.admin
    .insertInto('commerce.confirmation_task')
    .values({
      task_type: 'purchase',
      partner_id: s.partnerId,
      reservation_id: reservationId,
      created_at: o.created,
      due_at: o.due ?? new Date(o.created.getTime() + 4 * HOUR),
      response: o.response ?? null,
      responded_at:
        o.answeredAfter === undefined ? null : new Date(o.created.getTime() + o.answeredAfter),
      responded_by_seller_user_id: o.bySeller === false ? null : o.response ? s.userId : null,
    })
    .execute();
}

async function viewingTask(s: TestSeller, o: { created: Date; answeredAfter: number }) {
  const customerId = await fixtures.customer(h.admin);
  const project = await fixtures.project(h.admin, customerId);
  const vr = await h.admin
    .insertInto('viewing.viewing_request')
    .values({ customer_id: customerId, project_id: project })
    .returning('id')
    .executeTakeFirstOrThrow();
  const stop = await h.admin
    .insertInto('viewing.viewing_stop')
    .values({
      viewing_request_id: vr.id,
      partner_id: s.partnerId,
      partner_location_id: s.locationId,
      stop_no: 1,
      confirmation_state: 'Confirmed',
      responded_at: new Date(o.created.getTime() + o.answeredAfter),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.admin
    .insertInto('commerce.confirmation_task')
    .values({
      task_type: 'viewing',
      partner_id: s.partnerId,
      viewing_stop_id: stop.id,
      created_at: o.created,
      due_at: new Date(o.created.getTime() + 12 * HOUR),
      response: 'Confirmed',
      responded_at: new Date(o.created.getTime() + o.answeredAfter),
      responded_by_seller_user_id: s.userId,
    })
    .execute();
}

interface LineSpec {
  createdDaysAgo: number;
  deliveryDays: number;
  deliveredDaysAgo?: number;
  cancelled?: boolean;
}

async function lines(code: string, specs: LineSpec[]) {
  const order = await createOrder(h, { lines: specs.map(() => ({ partner: code })) });
  await sql`ALTER TABLE fulfilment.order_line DISABLE TRIGGER order_line_snapshot_write_once`.execute(
    h.admin,
  );
  try {
    for (const [i, spec] of specs.entries()) {
      const id = order.lineIds[i]!;
      await sql`UPDATE fulfilment.order_line SET snapshot = jsonb_set(snapshot, '{deliveryDays}', to_jsonb(${spec.deliveryDays}::int)), created_at = ${at(-spec.createdDaysAgo * DAY)} WHERE id = ${id}::uuid`.execute(
        h.admin,
      );
      if (spec.cancelled) {
        await h.admin
          .updateTable('fulfilment.order_line')
          .set({ state: 'Cancelled' })
          .where('id', '=', id)
          .execute();
      } else if (spec.deliveredDaysAgo !== undefined) {
        for (const state of ['Preparing', 'Ready for Dispatch', 'Dispatched'])
          await h.admin
            .updateTable('fulfilment.order_line')
            .set({ state })
            .where('id', '=', id)
            .execute();
        await h.admin
          .updateTable('fulfilment.order_line')
          .set({ state: 'Delivered', delivered_at: at(-spec.deliveredDaysAgo * DAY) })
          .where('id', '=', id)
          .execute();
      }
    }
  } finally {
    await sql`ALTER TABLE fulfilment.order_line ENABLE TRIGGER order_line_snapshot_write_once`.execute(
      h.admin,
    );
  }
  return order;
}

async function issue(
  orderLineId: string,
  partnerId: string,
  customerId: string,
  flag: string,
  raisedAt: Date,
) {
  await h.admin
    .insertInto('fulfilment.issue')
    .values({
      order_line_id: orderLineId,
      partner_id: partnerId,
      customer_id: customerId,
      flag,
      raised_at: raisedAt,
    })
    .execute();
}

describe('seller performance, against numbers worked out by hand', () => {
  beforeAll(async () => {
    // Purchase confirmations (SLA 4h). In the period: T1–T4 are answered or past due; T5 is still open.
    await purchaseTask(manager, {
      created: at(-10 * DAY),
      answeredAfter: 2 * HOUR,
      response: 'Confirmed',
    }); // T1  7 200 s
    await purchaseTask(manager, {
      created: at(-9 * DAY),
      answeredAfter: 6 * HOUR,
      response: 'Declined',
    }); //   T2 21 600 s
    await purchaseTask(manager, {
      created: at(-8 * DAY),
      answeredAfter: 1 * HOUR,
      response: 'Confirmed',
    }); //  T3  3 600 s
    await purchaseTask(manager, {
      created: at(-7 * DAY),
      answeredAfter: 4 * HOUR,
      response: 'Declined',
      bySeller: false,
    }); // T4 lapsed: counts against the rate, not the response time
    await purchaseTask(manager, { created: at(-1 * HOUR), due: at(3 * HOUR) }); //                              T5 open and not yet due: excluded
    await purchaseTask(manager, {
      created: at(-40 * DAY),
      answeredAfter: HOUR,
      response: 'Confirmed',
    }); //      outside the period: excluded
    // Viewing confirmations (SLA 12h).
    await viewingTask(manager, { created: at(-5 * DAY), answeredAfter: 4 * HOUR }); //   14 400 s
    await viewingTask(manager, { created: at(-4 * DAY), answeredAfter: 12 * HOUR }); //  43 200 s

    // Order lines. "Due" = promised delivery date already passed and not cancelled.
    const o = await lines('PRT-004', [
      { createdDaysAgo: 20, deliveryDays: 5, deliveredDaysAgo: 16 }, //  L1 eta −15d, delivered −16d: on time
      { createdDaysAgo: 20, deliveryDays: 5, deliveredDaysAgo: 12 }, //  L2 eta −15d, delivered −12d: late
      { createdDaysAgo: 10, deliveryDays: 3, deliveredDaysAgo: 8 }, //   L3 eta −7d,  delivered −8d: on time
      { createdDaysAgo: 5, deliveryDays: 10 }, //                        L4 eta +5d: not due yet
      { createdDaysAgo: 12, deliveryDays: 2 }, //                        L5 eta −10d, never delivered: late
      { createdDaysAgo: 12, deliveryDays: 2, cancelled: true }, //       L6 cancelled: excluded
    ]);
    // Three issues in the period, one 50 days ago (excluded).
    await issue(o.lineIds[1]!, manager.partnerId, o.customerId, 'Delayed', at(-11 * DAY));
    await issue(o.lineIds[4]!, manager.partnerId, o.customerId, 'Delayed', at(-9 * DAY));
    await issue(o.lineIds[4]!, manager.partnerId, o.customerId, 'Missing', at(-3 * DAY));
    await issue(o.lineIds[0]!, manager.partnerId, o.customerId, 'Damaged', at(-50 * DAY));

    // Another partner's activity must not leak into these numbers.
    await purchaseTask(neighbour, {
      created: at(-2 * DAY),
      answeredAfter: 100,
      response: 'Confirmed',
    });
    await lines('PRT-005', [{ createdDaysAgo: 20, deliveryDays: 5, deliveredDaysAgo: 16 }]);
  });

  it('30 days', async () => {
    const r = await api(h, 'GET', '/v1/seller/performance?period=30d', manager.actor);
    expect(r.status, r.text).toBe(200);
    expect(r.json.confirmation.purchase).toEqual({ requests: 4, confirmed: 2, rate: 0.5 });
    expect(r.json.confirmation.viewing).toEqual({ requests: 2, confirmed: 2, rate: 1 });
    // 3 600, 7 200, 14 400, 21 600, 43 200 → median 14 400; p90 = 21 600 + 0.6 × (43 200 − 21 600) = 34 560
    expect(r.json.confirmation.responseSeconds.median).toBeCloseTo(14_400, 3);
    expect(r.json.confirmation.responseSeconds.p90).toBeCloseTo(34_560, 3);
    expect(r.json.fulfilment).toEqual({ dueLines: 4, onTime: 2, onTimeRate: 0.5 });
    expect(r.json.issues).toEqual({ lines: 6, issues: 3, issueRate: 0.5 });
    expect(new Date(r.json.to).getTime() - new Date(r.json.from).getTime()).toBe(30 * DAY);
  });

  it('90 days brings in the older purchase confirmation and issue', async () => {
    const r = await api(h, 'GET', '/v1/seller/performance?period=90d', manager.actor);
    expect(r.json.confirmation.purchase).toEqual({ requests: 5, confirmed: 3, rate: 0.6 });
    expect(r.json.issues).toEqual({ lines: 6, issues: 4, issueRate: 4 / 6 });
  });

  it('a partner with no activity gets nulls, not zeros or errors; bad periods are refused; staff may not see it', async () => {
    const quiet = await sellerOf(h, 'seller_owner', 'PRT-006');
    const r = await api(h, 'GET', '/v1/seller/performance', quiet.actor);
    expect(r.json.confirmation.purchase).toEqual({ requests: 0, confirmed: 0, rate: null });
    expect(r.json.confirmation.responseSeconds).toEqual({ median: null, p90: null });
    expect(r.json.fulfilment.onTimeRate).toBeNull();
    expect(r.json.issues.issueRate).toBeNull();
    expect((await api(h, 'GET', '/v1/seller/performance?period=1y', manager.actor)).status).toBe(
      400,
    );
    const staff = await sellerOf(h, 'seller_staff', 'PRT-004');
    expect((await api(h, 'GET', '/v1/seller/performance', staff.actor)).status).toBe(403);
  });

  it("never includes another partner's rows", async () => {
    const n = await api(h, 'GET', '/v1/seller/performance', neighbour.actor);
    expect(n.json.confirmation.purchase).toEqual({ requests: 1, confirmed: 1, rate: 1 });
    expect(n.json.fulfilment).toEqual({ dueLines: 1, onTime: 1, onTimeRate: 1 });
    expect(n.json.issues.issues).toBe(0);
  });
});
