import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { sql } from 'kysely';
import { withActor } from '@aidooi/db';
import { fixtures } from '@aidooi/db/testing';
import { IMPORT_COLUMNS, cell } from '../src/modules/seller/import-csv.ts';
import { parseAed } from '../src/modules/seller/imports.ts';
import { startHarness, type Harness } from './support/harness.ts';
import { api, sellerOf, type TestSeller } from './support/seller.ts';

let h: Harness;
let owner: TestSeller;
let staff: TestSeller;
let other: TestSeller;
beforeAll(async () => {
  h = await startHarness();
  owner = await sellerOf(h, 'seller_owner');
  staff = await sellerOf(h, 'seller_staff');
  other = await sellerOf(h, 'seller_owner', 'PRT-002');
});
afterAll(() => h.close());

type Row = Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>;
const csv = (rows: Row[], cols: readonly string[] = IMPORT_COLUMNS) =>
  [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => cell((r as Record<string, string>)[c] ?? '')).join(',')),
  ].join('\r\n');

let seq = 0;
const lamp = (over: Row = {}): Row => ({
  sku: `IMP-${++seq}-${Math.random().toString(36).slice(2, 6)}`,
  name: `Lamp Model ${seq}`,
  type: 'Floor Lamp',
  width_cm: '35',
  depth_cm: '35',
  height_cm: '155',
  primary_colour: 'natural',
  primary_style: 'japandi',
  material: 'Wood',
  price_aed: '250.00',
  stock: '5',
  delivery_days: '4',
  ...over,
});

const upload = (rows: Row[] | string, who = owner, cols?: readonly string[]) =>
  api(h, 'POST', '/v1/seller/imports', who.actor, {
    filename: 'catalogue.csv',
    csv: typeof rows === 'string' ? rows : csv(rows, cols),
  });
const commit = (id: string, who = owner) =>
  api(h, 'POST', `/v1/seller/imports/${id}/commit`, who.actor);
const offersOf = (partnerId = owner.partnerId) =>
  h.admin
    .selectFrom('catalogue.seller_offer')
    .select(['id', 'seller_sku', 'selling_price_fils', 'stock_qty'])
    .where('partner_id', '=', partnerId);
const count = async (q: ReturnType<typeof offersOf>) => (await q.execute()).length;

describe('money parsing', () => {
  it.each([
    ['250', 25_000],
    ['250.5', 25_050],
    ['250.05', 25_005],
    ['0.01', 1],
    ['999999999.99', 99_999_999_999],
  ])('%s AED → %s fils, exactly', (s, fils) => {
    expect(parseAed(s)).toBe(fils);
  });
  it.each(['', '12,5', '-5', '1e3', '12.345', '1 000', 'AED 5', '0x10', '.5', '1.'])(
    'rejects %j',
    (s) => {
      expect(parseAed(s)).toBeNull();
    },
  );
});

describe('template and access', () => {
  it('serves the template with every column; managers only for the rest', async () => {
    const t = await api(h, 'GET', '/v1/seller/imports/template.csv', staff.actor);
    expect(t.status).toBe(200);
    expect(String(t.headers['content-type'])).toMatch(/text\/csv/);
    expect(t.text.split('\r\n')[0]).toBe(IMPORT_COLUMNS.join(','));
    expect((await upload([lamp()], staff)).status).toBe(403);
    expect((await api(h, 'GET', '/v1/seller/imports', staff.actor)).status).toBe(403);
  });
});

describe('validation (dry run)', () => {
  it('reports every row precisely and imports nothing', async () => {
    const mine = await offersOf()
      .select('seller_sku')
      .where('stock_qty', '>', 2)
      .limit(1)
      .executeTakeFirstOrThrow();
    const free = await h.admin
      .selectFrom('catalogue.product as p')
      .select('p.id')
      .where('p.data_status', '=', 'Verified')
      .where((e) =>
        e.not(
          e.exists(
            e
              .selectFrom('catalogue.seller_offer as o')
              .select('o.id')
              .whereRef('o.product_id', '=', 'p.id')
              .where('o.partner_id', '=', owner.partnerId),
          ),
        ),
      )
      .orderBy('p.id')
      .executeTakeFirstOrThrow();
    const good = lamp({ sku: 'GOOD-1' });
    const rows: Row[] = [
      good, //                                                       row 2  valid: new product
      { sku: mine.seller_sku, price_aed: '99.50', stock: '4', delivery_days: '2' }, // row 3  valid: update by SKU
      { sku: 'VER-1', product_id: free.id, price_aed: '10', stock: '1', delivery_days: '1' }, // row 4 valid: existing verified product
      lamp({ sku: 'BAD-COL', primary_colour: 'cognac' }), //          row 5  bad vocabulary
      lamp({ sku: 'GOOD-1' }), //                                     row 6  duplicate SKU in the file
      lamp({ sku: 'BAD-PRICE', price_aed: '12,5' }), //               row 7  bad price
      lamp({ sku: 'NEG', price_aed: '-5' }), //                       row 8  negative price
      lamp({ sku: "=cmd|' /C calc'!A0", name: '@SUM(1+1)' }), //      row 9  injection payloads
      lamp({ sku: 'NO-TYPE', type: '' }), //                          row 10 missing type
      {
        sku: 'SOFA-1',
        name: 'Orla Sofa',
        type: 'Sofa',
        width_cm: '215',
        depth_cm: '92',
        height_cm: '82',
        primary_colour: 'beige',
        primary_style: 'scandinavian',
        material: 'Fabric',
        price_aed: '4000',
        stock: '2',
        delivery_days: '7',
      }, // row 11 sofa without seats
      lamp({ sku: 'ORIG', original_price_aed: '100', price_aed: '250' }), // row 12 original below selling
      lamp({ sku: 'LOC', location: 'Nowhere' }), //                   row 13 unknown showroom
      lamp({ sku: 'STOCK', stock: '-1' }), //                         row 14 negative stock
      lamp({ sku: 'VIEW', viewing_status: 'Maybe' }), //              row 15 bad viewing status
    ];
    const before = await count(offersOf());
    const r = await upload(rows);
    expect(r.status, r.text).toBe(201);
    expect(r.json).toMatchObject({
      state: 'Validated',
      totalRows: 14,
      errorRows: 11,
      createdCount: null,
    });
    expect(await count(offersOf())).toBe(before);

    const detail = (await api(h, 'GET', `/v1/seller/imports/${r.json.id}`, owner.actor)).json;
    const byRow = new Map<number, { status: string; errors: { path: string; message: string }[] }>(
      detail.rows.map(
        (x: { row: number; status: string; errors: { path: string; message: string }[] }) => [
          x.row,
          x,
        ],
      ),
    );
    expect([2, 3, 4].map((n) => byRow.get(n)!.status)).toEqual(['Valid', 'Valid', 'Valid']);
    const cols = (n: number) => byRow.get(n)!.errors.map((e) => e.path);
    expect(cols(5)).toContain('primary_colour');
    expect(cols(6)).toContain('sku');
    expect(cols(7)).toEqual(['price_aed']);
    expect(cols(8)).toEqual(['price_aed']);
    expect(cols(9)).toContain('sku');
    expect(cols(10)).toEqual(expect.arrayContaining(['type']));
    expect(cols(11)).toContain('seats');
    expect(cols(12)).toEqual(['original_price_aed']);
    expect(cols(13)).toEqual(['location']);
    expect(cols(14)).toEqual(['stock']);
    expect(cols(15)).toEqual(['viewing_status']);
    expect(byRow.get(6)!.errors[0]!.message).toMatch(/earlier in the file/);
  });

  it('the error report is a spreadsheet-safe CSV: no cell can start a formula', async () => {
    const r = await upload([
      lamp({ sku: "=cmd|' /C calc'!A0", name: '+1+1' }),
      lamp({ sku: 'OK-ROW' }),
      lamp({ sku: 'AT', name: '@SUM(A1)', price_aed: '-9' }),
    ]);
    const rep = await api(h, 'GET', `/v1/seller/imports/${r.json.id}/errors.csv`, owner.actor);
    expect(rep.status).toBe(200);
    expect(String(rep.headers['content-type'])).toMatch(/text\/csv/);
    const rows = parse(rep.text, { relax_column_count: true }) as string[][];
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows)
      for (const c of row) expect(c, `cell ${JSON.stringify(c)}`).not.toMatch(/^[=+\-@\t\r]/);
    expect(rows.flat().some((c) => c.startsWith("'="))).toBe(true);
    expect(rep.text).not.toContain('OK-ROW');
  });

  it('refuses a malformed, empty, mis-headed or oversized file before storing anything', async () => {
    const jobs = async () =>
      (await h.admin.selectFrom('catalogue.import_job').select('id').execute()).length;
    const before = await jobs();
    expect((await upload('sku,price_aed\r\n"unterminated,1')).json.code).toBe('csv_malformed');
    expect((await upload('sku,price_aed,stock,delivery_days\r\n')).json.code).toBe('csv_empty');
    const unknown = await upload('sku,price_aed,stock,delivery_days,pricee\r\nA,1,1,1,3');
    expect(unknown.json.code).toBe('csv_header_invalid');
    expect(unknown.json.detail).toMatch(/pricee/);
    expect((await upload('sku,price_aed\r\nA,1')).json.detail).toMatch(
      /missing column\(s\): stock, delivery_days/,
    );
    const big = [
      'sku,price_aed,stock,delivery_days',
      ...Array.from({ length: 2001 }, (_, i) => `S${i},1,1,1`),
    ].join('\r\n');
    const tooBig = await upload(big);
    expect(tooBig.status).toBe(422);
    expect(tooBig.json.code).toBe('import_too_large');
    expect(await jobs()).toBe(before);
  });

  it('handles a BOM, mixed-case headers and quoted commas the way Excel writes them', async () => {
    const text = `\uFEFFSKU,Price_AED,STOCK,Delivery_Days,Name,Type,Width_Cm,Depth_Cm,Height_Cm,Primary_Colour,Primary_Style,Material\r\nBOM-1,"1,250.00",3,3,"Kano, Floor Lamp",Floor Lamp,35,35,155,natural,japandi,Wood\r\nBOM-2,1250,3,3,Kano Lamp,Floor Lamp,35,35,155,natural,japandi,Wood`;
    const r = await upload(text);
    expect(r.status, r.text).toBe(201);
    expect(r.json).toMatchObject({ totalRows: 2, errorRows: 1 });
  });

  it("is private to the seller's partner", async () => {
    const r = await upload([lamp()]);
    expect((await api(h, 'GET', `/v1/seller/imports/${r.json.id}`, other.actor)).status).toBe(404);
    expect((await commit(r.json.id, other)).status).toBe(404);
    expect(
      (await api(h, 'GET', '/v1/seller/imports', other.actor)).json.imports.map(
        (j: { id: string }) => j.id,
      ),
    ).not.toContain(r.json.id);
  });
});

describe('commit', () => {
  it('applies the valid rows (create, update, existing product), skips the invalid, and records exact counts', async () => {
    const existing = await offersOf()
      .select('seller_sku')
      .where('stock_qty', '>', 5)
      .limit(1)
      .executeTakeFirstOrThrow();
    const free = await h.admin
      .selectFrom('catalogue.product as p')
      .select('p.id')
      .where('p.data_status', '=', 'Verified')
      .where((e) =>
        e.not(
          e.exists(
            e
              .selectFrom('catalogue.seller_offer as o')
              .select('o.id')
              .whereRef('o.product_id', '=', 'p.id')
              .where('o.partner_id', '=', owner.partnerId),
          ),
        ),
      )
      .orderBy('p.id')
      .executeTakeFirstOrThrow();
    const a = lamp({
      price_aed: '300.00',
      original_price_aed: '350',
      viewing_status: 'On Display',
    });
    const r = await upload([
      a,
      { sku: existing.seller_sku, price_aed: '77.77', stock: '9', delivery_days: '3' },
      { sku: 'EXIST-PROD', product_id: free.id, price_aed: '40', stock: '2', delivery_days: '2' },
      lamp({ primary_colour: 'cognac' }),
    ]);
    expect(r.json).toMatchObject({ totalRows: 4, errorRows: 1 });
    const done = await commit(r.json.id);
    expect(done.status, done.text).toBe(200);
    expect(done.json).toMatchObject({
      state: 'Imported',
      createdCount: 2,
      updatedCount: 1,
      skippedCount: 1,
      errorRows: 1,
    });

    const created = await offersOf()
      .select('selling_price_fils')
      .where('seller_sku', '=', a.sku!)
      .executeTakeFirstOrThrow();
    expect(created.selling_price_fils).toBe(30_000);
    const full = await h.admin
      .selectFrom('catalogue.seller_offer')
      .select(['viewing_status', 'viewing_confirmed_at', 'original_price_fils', 'commission_rate'])
      .where('seller_sku', '=', a.sku!)
      .executeTakeFirstOrThrow();
    expect(full).toMatchObject({ viewing_status: 'On Display', original_price_fils: 35_000 });
    expect(Number(full.commission_rate)).toBe(0.14);
    expect(full.viewing_confirmed_at).not.toBeNull();
    const updated = await offersOf()
      .where('seller_sku', '=', existing.seller_sku)
      .executeTakeFirstOrThrow();
    expect(updated).toMatchObject({ selling_price_fils: 7_777, stock_qty: 9 });
    const product = await h.admin
      .selectFrom('catalogue.product as p')
      .innerJoin('catalogue.seller_offer as o', 'o.product_id', 'p.id')
      .select(['p.data_status', 'p.submitted_by_partner_id'])
      .where('o.seller_sku', '=', a.sku!)
      .executeTakeFirstOrThrow();
    expect(product).toEqual({
      data_status: 'Ready for Review',
      submitted_by_partner_id: owner.partnerId,
    });
    expect(await offersOf().where('seller_sku', '=', 'EXIST-PROD').execute()).toHaveLength(1);
    const audit = await h.admin
      .selectFrom('audit.event')
      .select('reason')
      .where('data', '@>', sql`${JSON.stringify({ importJobId: r.json.id })}::jsonb` as never)
      .execute();
    expect(audit.filter((x) => x.reason === 'bulk import')).toHaveLength(3);
  });

  it('is idempotent: committing again changes nothing and returns the same result', async () => {
    const r = await upload([lamp(), lamp()]);
    const first = await commit(r.json.id);
    const total = await count(offersOf());
    const auditCount = async () =>
      (
        await h.admin
          .selectFrom('audit.event')
          .select('id')
          .where('entity_id', '=', r.json.id)
          .execute()
      ).length;
    const audits = await auditCount();
    const again = await commit(r.json.id);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await count(offersOf())).toBe(total);
    expect(await auditCount()).toBe(audits);
  });

  it('two simultaneous commits import every row exactly once', async () => {
    const rows = Array.from({ length: 30 }, () => lamp());
    const r = await upload(rows);
    const before = await count(offersOf());
    const [a, b] = await Promise.all([commit(r.json.id), commit(r.json.id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.json).toMatchObject({ state: 'Imported', createdCount: 30 });
    expect(b.json).toMatchObject({ state: 'Imported', createdCount: 30 });
    expect(await count(offersOf())).toBe(before + 30);
  });

  it('a chunk that fails rolls back whole; earlier chunks stand; committing again resumes without duplicates', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => lamp(i === 119 ? { sku: 'BOOM' } : {}));
    const r = await upload(rows);
    expect(r.json).toMatchObject({ totalRows: 150, errorRows: 0 });
    await sql`CREATE FUNCTION public.boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.seller_sku = 'BOOM' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END $$`.execute(
      h.admin,
    );
    await sql`CREATE TRIGGER t_boom BEFORE INSERT ON catalogue.seller_offer FOR EACH ROW EXECUTE FUNCTION public.boom()`.execute(
      h.admin,
    );
    const productsBefore = Number(
      (
        await h.admin
          .selectFrom('catalogue.product')
          .select((e) => e.fn.countAll<string>().as('n'))
          .where('submitted_by_partner_id', '=', owner.partnerId)
          .executeTakeFirstOrThrow()
      ).n,
    );
    const offersBefore = await count(offersOf());

    const failed = await commit(r.json.id);
    expect(failed.status).toBe(409);
    expect(failed.json.code).toBe('import_chunk_failed');
    expect(await count(offersOf())).toBe(offersBefore + 100); // the first chunk landed whole…
    const productsMid = Number(
      (
        await h.admin
          .selectFrom('catalogue.product')
          .select((e) => e.fn.countAll<string>().as('n'))
          .where('submitted_by_partner_id', '=', owner.partnerId)
          .executeTakeFirstOrThrow()
      ).n,
    );
    expect(productsMid).toBe(productsBefore + 100); // …and the failed chunk left no half-created products behind
    const job = (await api(h, 'GET', `/v1/seller/imports/${r.json.id}`, owner.actor)).json;
    expect(job.state).toBe('Failed');
    expect(job.rows.filter((x: { status: string }) => x.status === 'Imported')).toHaveLength(100);
    expect(job.rows.filter((x: { status: string }) => x.status === 'Valid')).toHaveLength(50);

    await sql`DROP TRIGGER t_boom ON catalogue.seller_offer`.execute(h.admin);
    const resumed = await commit(r.json.id);
    expect(resumed.json).toMatchObject({ state: 'Imported', createdCount: 150, updatedCount: 0 });
    expect(await count(offersOf())).toBe(offersBefore + 150);
    expect((await offersOf().where('seller_sku', '=', 'BOOM').execute()).length).toBe(1);
  });

  it('a row that became impossible since the dry run is skipped, not forced: stock cannot drop below what buyers hold', async () => {
    const created = await upload([lamp({ sku: 'HELD-1', stock: '10' })]);
    await commit(created.json.id);
    const offer = await offersOf().where('seller_sku', '=', 'HELD-1').executeTakeFirstOrThrow();
    const customerId = await fixtures.customer(h.admin);
    const { reservationId } = await fixtures.reservation(h.admin, {
      customerId,
      offerId: offer.id,
      priceFils: 100_000,
    });
    await withActor(h.database.app, { kind: 'system' }, (trx) =>
      sql`SELECT commerce.try_reserve(${reservationId}::uuid, ${offer.id}, 6)`.execute(trx),
    );
    const r = await upload([{ sku: 'HELD-1', price_aed: '10', stock: '2', delivery_days: '1' }]);
    expect(r.json.errorRows).toBe(0);
    const done = await commit(r.json.id);
    expect(done.json).toMatchObject({
      state: 'Imported',
      updatedCount: 0,
      skippedCount: 1,
      errorRows: 1,
    });
    expect(
      (await offersOf().where('seller_sku', '=', 'HELD-1').executeTakeFirstOrThrow()).stock_qty,
    ).toBe(10);
    const detail = (await api(h, 'GET', `/v1/seller/imports/${r.json.id}`, owner.actor)).json;
    expect(detail.rows[0].errors[0].message).toMatch(/6 unit/);
  });

  it('only a validated or failed import can be committed', async () => {
    const r = await upload([lamp()]);
    await h.admin
      .updateTable('catalogue.import_job')
      .set({ state: 'Validating' })
      .where('id', '=', r.json.id)
      .execute();
    expect((await commit(r.json.id)).json.code).toBe('import_not_committable');
  });
});
