/**
 * The business rules live in two places on purpose: `@aidooi/domain` (checked by application code)
 * and the database (checked by triggers and CHECK constraints). These tests make that duplication
 * safe — if either side changes without the other, the build fails.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as domain from '@aidooi/domain';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';
import * as vocab from '../src/vocab.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

const sorted = (xs: readonly string[]) => [...xs].sort();
const edgeKey = (from: string, to: string) => `${from}>${to}`;

/** domain machine ↔ database machine name (the names equal the guarded table). */
const MACHINES = [
  [domain.viewingRequest, 'viewing_request'],
  [domain.viewingDeposit, 'viewing_deposit'],
  [domain.reservation, 'reservation'],
  [domain.payment, 'payment'],
  [domain.orderLine, 'order_line'],
  [domain.issue, 'issue'],
  [domain.partnerStatus, 'partner_status'],
  [domain.dataStatus, 'data_status'],
] as const;

describe('state machines: domain = vocab = database', () => {
  it.each(MACHINES)('%s', async (machine, dbName) => {
    const fromDomain = sorted(domain.edges(machine).map((e) => edgeKey(e.from, e.to)));
    expect(machine.name).toBe(dbName);

    const declared = vocab.STATE_TRANSITIONS[dbName as vocab.StateMachineName];
    expect(sorted(declared.edges.map(([a, b]) => edgeKey(a, b)))).toEqual(fromDomain);

    const { rows } = await sql<{ from_state: string; to_state: string }>`
      SELECT from_state, to_state FROM platform.state_transition WHERE machine = ${dbName}`.execute(
      t.admin,
    );
    expect(sorted(rows.map((r) => edgeKey(r.from_state, r.to_state)))).toEqual(fromDomain);
  });
});

describe('vocabularies: domain = database', () => {
  const same = (a: readonly string[], b: readonly string[]) => expect(sorted(a)).toEqual(sorted(b));
  it('styles, colours, materials, tiers, size classes', () => {
    same(domain.STYLE_IDS, vocab.STYLES);
    same(domain.COLOUR_IDS, vocab.COLOUR_FAMILIES);
    same(domain.MATERIAL_FAMILIES, vocab.MATERIAL_FAMILIES);
    same(domain.TIERS, vocab.BUDGET_TIERS);
    same(domain.SIZE_CLASSES, vocab.SIZE_CLASSES);
  });

  it('product-level vocabularies match their CHECK columns', () => {
    const col = (table: string, column: string) => {
      const e = vocab.ENUMS.find((x) => x.table === table && x.column === column);
      if (!e) throw new Error(`${table}.${column} not in vocab`);
      return e.values;
    };
    same(domain.AVAILABILITY, col('catalogue.seller_offer', 'availability'));
    same(domain.VIEWING_STATUS, col('catalogue.seller_offer', 'viewing_status'));
    same(domain.OFFER_STATUS, col('catalogue.seller_offer', 'offer_status'));
    same(domain.LIFECYCLE, col('catalogue.product', 'lifecycle'));
    same(domain.dataStatus.states, col('catalogue.product', 'data_status'));
    same(domain.partnerStatus.states, col('catalogue.partner', 'status'));
    same(domain.ISSUE_FLAGS, col('fulfilment.issue', 'flag'));
    same(domain.orderLine.states, col('fulfilment.order_line', 'state'));
  });

  it('settlement states', () => {
    const e = vocab.ENUMS.find(
      (x) => x.table === 'fulfilment.order_line' && x.column === 'settlement_state',
    );
    same(['Not Eligible', 'Eligible', 'On Hold', 'Included', 'Paid', 'Adjusted'], e?.values ?? []);
  });
});

describe('numeric rules: domain = database', () => {
  it('the deposit rule the CHECK enforces is the rule the domain computes', async () => {
    // Exhaustive around the interesting range, including the cap boundary and rounding ties.
    const bases = [
      1, 9, 10, 11, 99, 100, 101, 999, 1_000, 49_999, 50_000, 999_999, 1_000_000, 1_000_001,
      1_234_567, 10_000_000,
    ];
    for (const base of bases) {
      const quote = domain.quoteDeposit([{ offer: { sellingPrice: domain.fils(base) }, qty: 1 }]);
      const { rows } = await sql<{ amount: string; capped: boolean }>`
        SELECT LEAST((${base}::bigint * 5 + 50) / 100, 50000)::text AS amount,
               ((${base}::bigint * 5 + 50) / 100 > 50000) AS capped`.execute(t.admin);
      expect(Number(rows[0]?.amount), `base ${base}`).toBe(quote.amount);
      expect(rows[0]?.capped, `base ${base}`).toBe(quote.capped);
    }
  });

  it('the commission rounding the CHECK enforces is the rounding the domain computes', async () => {
    for (const gross of [1, 3, 99, 100, 12_345, 220_500, 9_999_999]) {
      for (const rate of [0, 0.1, 0.12, 0.1234, 0.14, 0.18, 0.3333, 1]) {
        const expected = domain.percentOf(domain.fils(gross), domain.bpsFromRate(rate));
        const { rows } = await sql<{ c: string }>`
          SELECT ((${gross}::bigint * (${rate}::numeric(5,4) * 10000)::bigint + 5000) / 10000)::text AS c`.execute(
          t.admin,
        );
        expect(Number(rows[0]?.c), `${gross} × ${rate}`).toBe(expected);
      }
    }
  });
});
