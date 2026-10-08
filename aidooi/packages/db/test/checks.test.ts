import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, fixtures, type TestDatabase } from '../src/testing/index.ts';
import { expectPgError } from './helpers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

async function viewingRequest(): Promise<string> {
  const customer = await fixtures.customer(t.admin);
  const project = await fixtures.project(t.admin, customer);
  const row = await t.admin
    .insertInto('viewing.viewing_request')
    .values({ customer_id: customer, project_id: project })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('viewing deposit (AID-LOG-012 §5: 5%, capped at AED 500)', () => {
  // [basis in fils, expected deposit in fils, capped]
  const cases: [number, number, boolean][] = [
    [10_000, 500, false], //            AED 100  → AED 5.00
    [10, 1, false], //                  0.5 fils rounds half-up to 1
    [9, 0, false], //                   0.45 fils rounds to 0
    [999_999, 50_000, false], //        just under the cap boundary: 49,999.95 → 50,000
    [1_000_000, 50_000, false], //      exactly AED 10,000 → exactly AED 500, not "capped"
  ];

  it.each(cases)('basis %i fils → %i fils (capped: %s)', async (basis, amount, capped) => {
    const request = await viewingRequest();
    await t.admin
      .insertInto('viewing.viewing_deposit')
      .values({ viewing_request_id: request, basis_fils: basis, amount_fils: amount, capped })
      .execute();
  });

  it('caps at AED 500 and flags it', async () => {
    const request = await viewingRequest();
    await t.admin
      .insertInto('viewing.viewing_deposit')
      .values({
        viewing_request_id: request,
        basis_fils: 5_000_000,
        amount_fils: 50_000,
        capped: true,
      })
      .execute();
  });

  it('rejects an amount that is not what the standard prescribes', async () => {
    for (const [basis, amount, capped] of [
      [10_000, 501, false],
      [5_000_000, 250_000, false], // uncapped 5%
      [5_000_000, 50_000, false], // capped but not flagged
      [10_000, 500, true], // flagged but not capped
    ] as const) {
      const request = await viewingRequest();
      await expect(
        t.admin
          .insertInto('viewing.viewing_deposit')
          .values({ viewing_request_id: request, basis_fils: basis, amount_fils: amount, capped })
          .execute(),
        `${basis} → ${amount}/${capped}`,
      ).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('cannot be changed after it is quoted', async () => {
    const request = await viewingRequest();
    await t.admin
      .insertInto('viewing.viewing_deposit')
      .values({ viewing_request_id: request, basis_fils: 10_000, amount_fils: 500, capped: false })
      .execute();
    await expectPgError(
      t.admin
        .updateTable('viewing.viewing_deposit')
        .set({ amount_fils: 400 })
        .where('viewing_request_id', '=', request)
        .execute(),
      { message: /write-once/ },
    );
  });
});

describe('money and rates', () => {
  it.each([0, -1])('rejects a selling price of %i fils', async (price) => {
    const ops = await fixtures.opsUser(t.admin);
    const p = await fixtures.partner(t.admin);
    const l = await fixtures.location(t.admin, p);
    const prod = await fixtures.product(t.admin, ops);
    await expectPgError(
      fixtures.offer(
        t.admin,
        { productId: prod, partnerId: p, locationId: l },
        { selling_price_fils: price },
      ),
      {
        constraint: 'seller_offer_price_ck',
      },
    );
  });

  it('keeps the original (struck-through) price at or above the selling price', async () => {
    const c = await fixtures.catalogue(t.admin);
    await expectPgError(
      t.admin
        .updateTable('catalogue.seller_offer')
        .set({ original_price_fils: 1 })
        .where('id', '=', c.offer)
        .execute(),
      { constraint: 'seller_offer_original_price_ck' },
    );
  });

  it.each([-0.01, 1.01])('rejects a commission rate of %f on partners and offers', async (rate) => {
    await expectPgError(fixtures.partner(t.admin, { commission_rate: rate }), {
      constraint: 'partner_commission_ck',
    });
    const ops = await fixtures.opsUser(t.admin);
    const p = await fixtures.partner(t.admin);
    const l = await fixtures.location(t.admin, p);
    const prod = await fixtures.product(t.admin, ops);
    await expectPgError(
      fixtures.offer(
        t.admin,
        { productId: prod, partnerId: p, locationId: l },
        { commission_rate: rate },
      ),
      {
        constraint: 'seller_offer_commission_ck',
      },
    );
  });

  it('only stores AED', async () => {
    const g = await fixtures.orderGraph(t.admin);
    const row = await t.admin
      .selectFrom('commerce.payment')
      .select('customer_id')
      .where('id', '=', g.payment)
      .executeTakeFirstOrThrow();
    const pr = await t.admin
      .insertInto('commerce.purchase_request')
      .values({ customer_id: row.customer_id, total_fils: 1000 })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expectPgError(
      t.admin
        .insertInto('commerce.payment')
        .values({
          purpose: 'Order',
          customer_id: row.customer_id,
          purchase_request_id: pr.id,
          amount_fils: 1000,
          currency: 'USD',
          idempotency_key: randomUUID(),
        })
        .execute(),
      { constraint: 'payment_currency_ck' },
    );
  });
});

describe('ledger', () => {
  const entry = (group: string, direction: 'debit' | 'credit', amount: number) => ({
    entry_group: group,
    account: direction === 'debit' ? 'customer_funds' : 'partner_payable',
    direction,
    amount_fils: amount,
    ref_type: 'order',
    ref_id: 'o-1',
  });

  it('commits a balanced group', async () => {
    const group = randomUUID();
    await t.admin.transaction().execute(async (trx) => {
      await trx
        .insertInto('commerce.ledger_entry')
        .values(entry(group, 'debit', 1000))
        .execute();
      await trx
        .insertInto('commerce.ledger_entry')
        .values(entry(group, 'credit', 1000))
        .execute();
    });
  });

  it('refuses to commit an unbalanced group', async () => {
    const group = randomUUID();
    await expectPgError(
      t.admin.transaction().execute(async (trx) => {
        await trx
          .insertInto('commerce.ledger_entry')
          .values(entry(group, 'debit', 1000))
          .execute();
        await trx
          .insertInto('commerce.ledger_entry')
          .values(entry(group, 'credit', 999))
          .execute();
      }),
      { message: /unbalanced by 1 fils/ },
    );
    const rows = await t.admin
      .selectFrom('commerce.ledger_entry')
      .select('id')
      .where('entry_group', '=', group)
      .execute();
    expect(rows).toEqual([]);
  });

  it('is append-only, even for the owner', async () => {
    const group = randomUUID();
    await t.admin.transaction().execute(async (trx) => {
      await trx
        .insertInto('commerce.ledger_entry')
        .values(entry(group, 'debit', 5))
        .execute();
      await trx
        .insertInto('commerce.ledger_entry')
        .values(entry(group, 'credit', 5))
        .execute();
    });
    await expectPgError(
      t.admin
        .updateTable('commerce.ledger_entry')
        .set({ amount_fils: 9 })
        .where('entry_group', '=', group)
        .execute(),
      {
        message: /append-only/,
      },
    );
    await expectPgError(
      t.admin.deleteFrom('commerce.ledger_entry').where('entry_group', '=', group).execute(),
      {
        message: /append-only/,
      },
    );
  });

  it('is not even updatable by the application role', async () => {
    await expectPgError(t.app.updateTable('commerce.ledger_entry').set({ memo: 'x' }).execute(), {
      code: '42501',
    });
  });
});

describe('settlement', () => {
  async function run(period = '2026-10') {
    const g = await fixtures.orderGraph(t.admin);
    const r = await t.admin
      .insertInto('settlement.settlement_run')
      .values({ partner_id: g.partner, period })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { g, runId: r.id };
  }

  it('allows one run per partner and month', async () => {
    const { g } = await run();
    await expectPgError(
      t.admin
        .insertInto('settlement.settlement_run')
        .values({ partner_id: g.partner, period: '2026-10' })
        .execute(),
      { constraint: 'settlement_run_period_uq' },
    );
  });

  it.each(['2026-13', '2026-1', '26-10', 'October'])('rejects period %s', async (period) => {
    const g = await fixtures.orderGraph(t.admin);
    await expectPgError(
      t.admin
        .insertInto('settlement.settlement_run')
        .values({ partner_id: g.partner, period })
        .execute(),
      {
        constraint: 'settlement_run_period_ck',
      },
    );
  });

  it('requires net = gross − commission − adjustments, and lets it go negative', async () => {
    const g = await fixtures.orderGraph(t.admin);
    await expectPgError(
      t.admin
        .insertInto('settlement.settlement_run')
        .values({
          partner_id: g.partner,
          period: '2026-01',
          gross_fils: 1000,
          commission_fils: 100,
          adjustment_fils: 0,
          net_fils: 901,
        })
        .execute(),
      { constraint: 'settlement_run_net_ck' },
    );
    await t.admin
      .insertInto('settlement.settlement_run')
      .values({
        partner_id: g.partner,
        period: '2026-02',
        gross_fils: 0,
        commission_fils: 0,
        adjustment_fils: 500,
        net_fils: -500,
      })
      .execute();
  });

  it('settles a line once as a sale and once as a clawback, never twice', async () => {
    const { g, runId } = await run('2026-03');
    const line = (kind: string) => ({
      run_id: runId,
      partner_id: g.partner,
      order_line_id: g.orderLine,
      kind,
      gross_fils: 1000,
      commission_fils: 140,
    });
    await t.admin.insertInto('settlement.settlement_line').values(line('Sale')).execute();
    await expectPgError(
      t.admin.insertInto('settlement.settlement_line').values(line('Sale')).execute(),
      {
        constraint: 'settlement_line_once_uq',
      },
    );
    await t.admin.insertInto('settlement.settlement_line').values(line('Clawback')).execute();
  });

  it('will not settle another partner’s order line in a run', async () => {
    const { runId } = await run('2026-04');
    const other = await fixtures.orderGraph(t.admin);
    await expectPgError(
      t.admin
        .insertInto('settlement.settlement_line')
        .values({
          run_id: runId,
          partner_id: other.partner,
          order_line_id: other.orderLine,
          kind: 'Sale',
          gross_fils: 1,
          commission_fils: 0,
        })
        .execute(),
      { constraint: 'settlement_line_run_fk' },
    );
  });

  it('requires approval details once a run leaves Draft', async () => {
    const { runId } = await run('2026-05');
    await expectPgError(
      t.admin
        .updateTable('settlement.settlement_run')
        .set({ state: 'Approved' })
        .where('id', '=', runId)
        .execute(),
      { constraint: 'settlement_run_approved_ck' },
    );
  });
});

describe('identity and viewing integrity', () => {
  it('needs a way to contact a customer, and a valid E.164 phone', async () => {
    await expectPgError(
      t.admin.insertInto('identity.customer').values({ full_name: 'No contact' }).execute(),
      {
        constraint: 'customer_contact_ck',
      },
    );
    await expectPgError(
      t.admin.insertInto('identity.customer').values({ phone_e164: '0501234567' }).execute(),
      {
        constraint: 'customer_phone_ck',
      },
    );
  });

  it('upgrades a guest session in place, keeping the link and timestamp together', async () => {
    const customer = await fixtures.customer(t.admin);
    await expectPgError(
      t.admin
        .insertInto('identity.guest_session')
        .values({
          token_hash: randomUUID(),
          customer_id: customer,
          expires_at: new Date(Date.now() + 1000),
        })
        .execute(),
      { constraint: 'guest_session_upgrade_ck' },
    );
  });

  it('ties a refresh token family and device token to exactly one principal', async () => {
    await expectPgError(
      t.admin
        .insertInto('identity.refresh_token_family')
        .values({ device_label: 'orphan' })
        .execute(),
      { constraint: 'refresh_token_family_one_subject_ck' },
    );
    const customer = await fixtures.customer(t.admin);
    const ops = await fixtures.opsUser(t.admin);
    await expectPgError(
      t.admin
        .insertInto('identity.device_token')
        .values({
          customer_id: customer,
          ops_user_id: ops,
          platform: 'ios',
          push_token: randomUUID(),
        })
        .execute(),
      { constraint: 'device_token_one_owner_ck' },
    );
  });

  it('keeps the attribution trail append-only', async () => {
    const request = await viewingRequest();
    const row = await t.admin
      .insertInto('viewing.attribution_event')
      .values({ viewing_request_id: request, stage: 'Requested' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expectPgError(
      t.admin
        .updateTable('viewing.attribution_event')
        .set({ stage: 'Purchased' })
        .where('id', '=', row.id)
        .execute(),
      {
        message: /append-only/,
      },
    );
    await expectPgError(
      t.admin.deleteFrom('viewing.attribution_event').where('id', '=', row.id).execute(),
      { message: /append-only/ },
    );
  });

  it('puts a confirmed viewing behind a QR token and a time', async () => {
    const request = await viewingRequest();
    await t.admin
      .updateTable('viewing.viewing_request')
      .set({ state: 'Awaiting Deposit' })
      .where('id', '=', request)
      .execute();
    await expectPgError(
      t.admin
        .updateTable('viewing.viewing_request')
        .set({ state: 'Confirmed' })
        .where('id', '=', request)
        .execute(),
      { constraint: 'viewing_request_confirmed_ck' },
    );
  });

  it('keeps a stop inside a location of the stop’s own partner', async () => {
    const request = await viewingRequest();
    const a = await fixtures.partner(t.admin);
    const b = await fixtures.partner(t.admin);
    const locOfB = await fixtures.location(t.admin, b);
    await expectPgError(
      t.admin
        .insertInto('viewing.viewing_stop')
        .values({
          viewing_request_id: request,
          partner_id: a,
          partner_location_id: locOfB,
          stop_no: 1,
        })
        .execute(),
      { constraint: 'viewing_stop_location_fk' },
    );
  });

  it('ties a confirmation task to one subject of the matching type and its own partner', async () => {
    const g = await fixtures.orderGraph(t.admin);
    const due = new Date(Date.now() + 3600_000);
    await expectPgError(
      t.admin
        .insertInto('commerce.confirmation_task')
        .values({
          task_type: 'viewing',
          partner_id: g.partner,
          order_line_id: g.orderLine,
          due_at: due,
        })
        .execute(),
      { constraint: 'confirmation_task_subject_ck' },
    );
    const stranger = await fixtures.partner(t.admin);
    await expectPgError(
      t.admin
        .insertInto('commerce.confirmation_task')
        .values({
          task_type: 'fulfilment',
          partner_id: stranger,
          order_line_id: g.orderLine,
          due_at: due,
        })
        .execute(),
      { constraint: 'confirmation_task_order_line_fk' },
    );
    await t.admin
      .insertInto('commerce.confirmation_task')
      .values({
        task_type: 'fulfilment',
        partner_id: g.partner,
        order_line_id: g.orderLine,
        due_at: due,
      })
      .execute();
  });

  it('allows one live issue per line and flag', async () => {
    const g = await fixtures.orderGraph(t.admin);
    const issue = {
      order_line_id: g.orderLine,
      partner_id: g.partner,
      customer_id: g.customer,
      flag: 'Damaged',
    };
    await t.admin.insertInto('fulfilment.issue').values(issue).execute();
    await expectPgError(t.admin.insertInto('fulfilment.issue').values(issue).execute(), {
      constraint: 'issue_live_uq',
    });
    await t.admin
      .insertInto('fulfilment.issue')
      .values({ ...issue, flag: 'Delayed' })
      .execute();
  });

  it('versions compatibility maps immutably, with one active version per kind', async () => {
    const ops = await fixtures.opsUser(t.admin);
    const insert = (version: string, extra: object = {}) =>
      t.admin
        .insertInto('catalogue.compat_map_version')
        .values({
          kind: 'style',
          version,
          content: { modern: { contemporary: 0.7 } },
          approved_by: ops,
          ...extra,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    const v1 = await insert('v1', { activated_at: new Date() });
    await expectPgError(insert('v2', { activated_at: new Date() }), {
      constraint: 'compat_map_version_active_uq',
    });
    await expectPgError(
      t.admin
        .updateTable('catalogue.compat_map_version')
        .set({ content: { hacked: true } })
        .where('id', '=', v1.id)
        .execute(),
      { message: /write-once/ },
    );
    await t.admin
      .updateTable('catalogue.compat_map_version')
      .set({ retired_at: new Date() })
      .where('id', '=', v1.id)
      .execute();
    await insert('v2', { activated_at: new Date() });
    await expectPgError(sql`DELETE FROM catalogue.compat_map_version`.execute(t.admin), {
      message: /never deleted/,
    });
  });
});
