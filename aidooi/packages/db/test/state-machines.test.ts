import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '../src/generated/db.ts';
import { createTestDatabase, fixtures, type TestDatabase } from '../src/testing/index.ts';
import { STATE_TRANSITIONS, type StateMachineName } from '../src/vocab.ts';
import { attempt } from './helpers.ts';

let t: TestDatabase;
let reviewer: string;
beforeAll(async () => {
  t = await createTestDatabase();
  reviewer = await fixtures.opsUser(t.admin);
});
afterAll(() => t.drop());

type Table = keyof DB;
const FUTURE = () => new Date(Date.now() + 3_600_000);

/** Columns other CHECK constraints require alongside a given state. */
const extras: Record<StateMachineName, (state: string) => Record<string, unknown>> = {
  viewing_request: (s) =>
    ['Confirmed', 'Completed', 'No-show'].includes(s)
      ? { qr_token_hash: randomUUID(), scheduled_at: FUTURE() }
      : {},
  viewing_deposit: () => ({}),
  reservation: () => ({}),
  payment: (s) => ({
    ...(['Successful', 'Refunded'].includes(s) && { captured_at: new Date() }),
    ...(s === 'Voided' && { voided_at: new Date() }),
    ...(['Authorized', 'Successful', 'Refunded'].includes(s) && { authorized_at: new Date() }),
  }),
  order_line: (s) => ({
    ...(['Delivered', 'Receipt Confirmed'].includes(s) && { delivered_at: new Date() }),
    ...(s === 'Receipt Confirmed' && { receipt_confirmed_at: new Date() }),
  }),
  issue: (s) =>
    ['Resolved', 'Refunded', 'Rejected'].includes(s) ? { resolved_at: new Date() } : {},
  partner_status: (s) => (s === 'Active' ? { activated_at: new Date() } : {}),
  // A Verified product must say who verified it and when (a CHECK); moving into Verified supplies that.
  data_status: (s) => (s === 'Verified' ? { verified_by: reviewer, verified_at: new Date() } : {}),
};

/** Creates a row of the machine's table already in `state`, returning its id. */
const create: Record<StateMachineName, (db: Kysely<DB>, state: string) => Promise<string>> = {
  async viewing_request(db, state) {
    const customer = await fixtures.customer(db);
    const project = await fixtures.project(db, customer);
    const row = await db
      .insertInto('viewing.viewing_request')
      .values({
        customer_id: customer,
        project_id: project,
        state,
        ...extras.viewing_request(state),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  },
  async viewing_deposit(db, state) {
    const request = await create.viewing_request(db, 'Draft');
    const row = await db
      .insertInto('viewing.viewing_deposit')
      .values({
        viewing_request_id: request,
        basis_fils: 100_000,
        amount_fils: 5_000,
        capped: false,
        state,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  },
  async reservation(db, state) {
    const cat = await fixtures.catalogue(db);
    const customer = await fixtures.customer(db);
    const { purchaseRequestId } = await fixtures.reservation(db, {
      customerId: customer,
      offerId: cat.offer,
      priceFils: 1000,
    });
    // The factory opens an Active reservation; release it so a second row of any state can exist.
    await db
      .updateTable('commerce.reservation')
      .set({ state: 'Released' })
      .where('purchase_request_id', '=', purchaseRequestId)
      .execute();
    const row = await db
      .insertInto('commerce.reservation')
      .values({ purchase_request_id: purchaseRequestId, state, expires_at: FUTURE() })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  },
  async payment(db, state) {
    const customer = await fixtures.customer(db);
    const pr = await db
      .insertInto('commerce.purchase_request')
      .values({ customer_id: customer, total_fils: 1000, validation_state: 'Validated' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const row = await db
      .insertInto('commerce.payment')
      .values({
        purpose: 'Order',
        customer_id: customer,
        purchase_request_id: pr.id,
        amount_fils: 1000,
        idempotency_key: randomUUID(),
        state,
        ...extras.payment(state),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  },
  async order_line(db, state) {
    const g = await fixtures.orderGraph(db, { line: { state, ...extras.order_line(state) } });
    return g.orderLine;
  },
  async partner_status(db, state) {
    const row = await db
      .insertInto('catalogue.partner')
      .values({
        code: `PRT-${String(Math.floor(Math.random() * 90_000) + 1000)}`,
        legal_name: 'Machine Test LLC',
        trade_name: 'Machine Test',
        commission_rate: 0.14,
        status: state,
        ...extras.partner_status(state),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  },
  async data_status(db, state) {
    const ops = await fixtures.opsUser(db);
    return fixtures.product(db, ops, { data_status: state });
  },
  async issue(db, state) {
    const g = await fixtures.orderGraph(db);
    const row = await db
      .insertInto('fulfilment.issue')
      .values({
        order_line_id: g.orderLine,
        partner_id: g.partner,
        customer_id: g.customer,
        flag: 'Damaged',
        state,
        ...extras.issue(state),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  },
};

const columnOf = (machine: StateMachineName): string => STATE_TRANSITIONS[machine].column;
const tableOf = (machine: StateMachineName): Table => STATE_TRANSITIONS[machine].table as Table;

describe.each(Object.keys(STATE_TRANSITIONS) as StateMachineName[])(
  '%s state machine',
  (machine) => {
    const { edges } = STATE_TRANSITIONS[machine];
    const states = [...new Set(edges.flat())] as string[];
    const legal = new Set(edges.map(([from, to]) => `${from}→${to}`));

    it.each(states)('from %s: exactly the declared transitions are accepted', async (from) => {
      const id = await create[machine](t.admin, from);
      for (const to of states.filter((s) => s !== from)) {
        const result = await attempt(t.admin, (trx) =>
          trx
            .updateTable(tableOf(machine) as never)
            .set({ [columnOf(machine)]: to, ...extras[machine](to) } as never)
            .where('id' as never, '=', id as never)
            .execute(),
        );
        const expected = legal.has(`${from}→${to}`);
        if (expected) {
          expect(result, `${machine}: ${from} → ${to} should be allowed`).toEqual({ ok: true });
        } else {
          expect(result.ok, `${machine}: ${from} → ${to} should be rejected`).toBe(false);
          if (!result.ok)
            expect(result.error.message).toMatch(
              new RegExp(`illegal ${machine} transition: ${from} -> ${to}`),
            );
        }
      }
    });

    it('allows an update that leaves the state unchanged', async () => {
      const id = await create[machine](t.admin, states[0]!);
      const result = await attempt(t.admin, (trx) =>
        trx
          .updateTable(tableOf(machine) as never)
          .set({ [columnOf(machine)]: states[0] } as never)
          .where('id' as never, '=', id as never)
          .execute(),
      );
      expect(result).toEqual({ ok: true });
    });
  },
);
