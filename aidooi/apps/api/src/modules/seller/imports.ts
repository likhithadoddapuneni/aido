import type { FastifyRequest } from 'fastify';
import type { Selectable } from 'kysely';
import type { z } from 'zod';
import type {
  CreateImportBodySchema,
  ImportDetailSchema,
  ImportJobSchema,
} from '@aidooi/contracts';
import type { DB } from '@aidooi/db';
import { validateProductData, type FieldError } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAs, type AppContext, type Tx } from '../../context.ts';
import { HttpError, notFound } from '../../http/problem.ts';
import { IMPORT_COLUMNS, parseImportCsv, toCsv, type RawRow } from './import-csv.ts';
import { iso, requireManager, type SellerActor } from './common.ts';
import { reconcile } from './offers.ts';
import { createProductRow } from './products.ts';

type Job = z.infer<typeof ImportJobSchema>;
type Detail = z.infer<typeof ImportDetailSchema>;
type JobRow = Selectable<DB['catalogue.import_job']>;

const CHUNK = 100;
const VIEWING = ['On Display', 'Viewable on Request', 'Not Viewable'] as const;
const FILE_PREFIX = 'inline:';

/* ---------------- Row interpretation (shared by validation and commit) ---------------- */

/** Exact AED → fils without floating point: whole dirhams plus at most two decimals. */
export function parseAed(s: string | undefined): number | null {
  const m = s?.match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}
const parseInt0 = (s: string | undefined): number | null =>
  s !== undefined && /^\d{1,7}$/.test(s) ? Number(s) : null;

interface Parsed {
  readonly sku: string;
  readonly productId: string | null;
  readonly newProduct: Parameters<typeof createProductRow>[2] | null;
  readonly price: number;
  readonly original: number | null;
  readonly stock: number;
  readonly delivery: number;
  readonly viewing: (typeof VIEWING)[number];
  readonly locationId: string | null;
}

export interface Seen {
  readonly skus: Set<string>;
  readonly listings: Set<string>;
}
const freshSeen = (): Seen => ({ skus: new Set(), listings: new Set() });

interface Context {
  readonly seller: SellerActor;
  readonly locations: readonly { id: string; name: string; status: string }[];
  readonly offersBySku: ReadonlyMap<string, { id: string; productId: string; locationId: string }>;
  readonly listed: ReadonlySet<string>; // `${productId}|${locationId}`
}

/** Domain field paths (`primaryColour`, `attributes.bedSize`) → the CSV column a seller must fix (`primary_colour`, `bed_size`). */
const toColumn = (path: string): string =>
  path.replace(/^attributes\./, '').replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);

const ATTR_COLUMNS = {
  seats: 'seats',
  bed_size: 'bedSize',
  capacity: 'capacity',
  door_group: 'doorGroup',
  rug_size: 'rugSize',
  adjustable: 'adjustable',
  cable_management: 'cableManagement',
} as const;

function productFromRow(r: RawRow): { data: Parsed['newProduct']; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const num = (col: keyof RawRow): number | undefined => {
    const v = r[col];
    if (v === undefined) return undefined;
    const n = parseInt0(v);
    if (n === null) errors.push({ path: col, message: `${col} must be a whole number.` });
    return n ?? undefined;
  };
  const attributes: Record<string, string | number | boolean> = {};
  for (const [col, key] of Object.entries(ATTR_COLUMNS)) {
    const v = r[col as keyof RawRow];
    if (v === undefined) continue;
    if (key === 'seats' || key === 'capacity') {
      const n = parseInt0(v);
      if (n === null) errors.push({ path: col, message: `${col} must be a whole number.` });
      else attributes[key] = n;
    } else if (key === 'adjustable' || key === 'cableManagement') {
      if (!/^(true|false)$/i.test(v))
        errors.push({ path: col, message: `${col} must be true or false.` });
      else attributes[key] = v.toLowerCase() === 'true';
    } else attributes[key] = v;
  }
  return {
    errors,
    data: {
      ...(r.name !== undefined ? { name: r.name } : {}),
      ...(r.type !== undefined ? { type: r.type } : {}),
      ...(num('width_cm') !== undefined ? { widthCm: num('width_cm') as number } : {}),
      ...(num('depth_cm') !== undefined ? { depthCm: num('depth_cm') as number } : {}),
      ...(num('height_cm') !== undefined ? { heightCm: num('height_cm') as number } : {}),
      ...(r.primary_colour !== undefined ? { primaryColour: r.primary_colour.toLowerCase() } : {}),
      ...(r.secondary_colour !== undefined
        ? { secondaryColour: r.secondary_colour.toLowerCase() }
        : {}),
      ...(r.primary_style !== undefined ? { primaryStyle: r.primary_style.toLowerCase() } : {}),
      ...(r.secondary_style !== undefined
        ? { secondaryStyle: r.secondary_style.toLowerCase() }
        : {}),
      ...(r.material !== undefined ? { material: r.material } : {}),
      attributes,
    },
  };
}

/** Everything wrong with one row, or the parsed row. Pure given the seller's current state. */
export function interpretRow(
  r: RawRow,
  c: Context,
  seen: Seen,
): { errors: FieldError[]; parsed: Parsed | null } {
  const errors: FieldError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  const sku = r.sku;
  if (!sku) err('sku', 'SKU is required.');
  else if (!/^[A-Za-z0-9._\-/]{1,60}$/.test(sku))
    err('sku', 'SKU may contain letters, digits and . _ - / (max 60).');
  else if (seen.skus.has(sku)) err('sku', 'This SKU appears earlier in the file.');
  if (sku) seen.skus.add(sku);

  const price = parseAed(r.price_aed);
  if (price === null || price <= 0)
    err('price_aed', 'Price must be a positive amount in AED with at most two decimals.');
  let original: number | null = null;
  if (r.original_price_aed !== undefined) {
    original = parseAed(r.original_price_aed);
    if (original === null)
      err(
        'original_price_aed',
        'Original price must be an amount in AED with at most two decimals.',
      );
    else if (price !== null && original < price)
      err('original_price_aed', 'Original price cannot be lower than the selling price.');
  }
  const stock = parseInt0(r.stock);
  if (stock === null || stock > 100_000)
    err('stock', 'Stock must be a whole number from 0 to 100000.');
  const delivery = parseInt0(r.delivery_days);
  if (delivery === null || delivery > 120)
    err('delivery_days', 'Delivery days must be a whole number from 0 to 120.');
  const viewing = (r.viewing_status ?? 'Not Viewable') as Parsed['viewing'];
  if (!VIEWING.includes(viewing))
    err('viewing_status', `Viewing status must be one of: ${VIEWING.join(', ')}.`);

  let locationId: string | null = null;
  const open = c.locations.filter((l) => l.status === 'Active');
  if (r.location !== undefined) {
    const hit = c.locations.find((l) => l.name.toLowerCase() === r.location!.toLowerCase());
    if (!hit) err('location', `No showroom named "${r.location}".`);
    else if (hit.status !== 'Active') err('location', `Showroom "${hit.name}" is closed.`);
    else if (c.seller.locationId && c.seller.locationId !== hit.id)
      err('location', 'You work at a different showroom.');
    else locationId = hit.id;
  } else if (c.seller.locationId) locationId = c.seller.locationId;
  else if (open.length === 1) locationId = (open[0] as { id: string }).id;

  const existing = sku ? c.offersBySku.get(sku) : undefined;
  let productId: string | null = null;
  let newProduct: Parsed['newProduct'] = null;
  if (existing) {
    // An existing SKU is a price/stock update; product facts are not re-submitted through it.
    if (r.product_id && r.product_id !== existing.productId)
      err('product_id', 'This SKU already belongs to a different product.');
    productId = existing.productId;
    locationId = locationId ?? existing.locationId;
  } else {
    if (locationId === null && r.location === undefined)
      err('location', 'Name the showroom (you have more than one).');
    if (r.product_id !== undefined) {
      if (!/^AID-\d{8}$/.test(r.product_id))
        err('product_id', 'Product id must look like AID-00000012.');
      else productId = r.product_id;
    } else {
      const p = productFromRow(r);
      errors.push(...p.errors);
      const v = validateProductData(p.data ?? {});
      errors.push(...v.errors.map((e) => ({ path: toColumn(e.path), message: e.message })));
      // A bulk import never creates a half-described product: everything mandatory must be present.
      for (const field of v.missing)
        err(toColumn(field), `${toColumn(field)} is required for a new product.`);
      newProduct = p.data;
    }
    const listing = productId && locationId ? `${productId}|${locationId}` : null;
    if (listing && (c.listed.has(listing) || seen.listings.has(listing)))
      err('product_id', 'You already list this product at that showroom.');
    if (listing) seen.listings.add(listing);
  }

  if (errors.length || sku === undefined || price === null || stock === null || delivery === null)
    return { errors, parsed: null };
  return {
    errors,
    parsed: { sku, productId, newProduct, price, original, stock, delivery, viewing, locationId },
  };
}

async function buildContext(trx: Tx, seller: SellerActor): Promise<Context> {
  const [locations, offers] = await Promise.all([
    trx
      .selectFrom('catalogue.partner_location')
      .select(['id', 'name', 'status'])
      .where('partner_id', '=', seller.partnerId)
      .execute(),
    trx
      .selectFrom('catalogue.seller_offer')
      .select(['id', 'seller_sku', 'product_id', 'partner_location_id'])
      .where('partner_id', '=', seller.partnerId)
      .execute(),
  ]);
  return {
    seller,
    locations,
    offersBySku: new Map(
      offers.map((o) => [
        o.seller_sku,
        { id: o.id, productId: o.product_id, locationId: o.partner_location_id },
      ]),
    ),
    listed: new Set(offers.map((o) => `${o.product_id}|${o.partner_location_id}`)),
  };
}

/* ---------------- Phase 1: validate ---------------- */

const toJob = (j: JobRow): Job => ({
  id: j.id,
  state: j.state as Job['state'],
  filename: j.file_key.startsWith(FILE_PREFIX) ? j.file_key.slice(FILE_PREFIX.length) : j.file_key,
  totalRows: j.total_rows,
  errorRows: j.error_rows,
  createdCount: j.created_count,
  updatedCount: j.updated_count,
  skippedCount:
    j.total_rows !== null && j.state === 'Imported'
      ? j.total_rows - (j.created_count ?? 0) - (j.updated_count ?? 0)
      : null,
  createdAt: iso(j.created_at),
});

/** Validate a CSV against the catalogue standards and the seller's own data, storing a row-by-row report. Changes no catalogue data. */
export async function createImport(
  ctx: AppContext,
  req: FastifyRequest,
  body: z.infer<typeof CreateImportBodySchema>,
): Promise<Job> {
  const seller = requireManager(req);
  const rows = parseImportCsv(body.csv, ctx.config.IMPORT_MAX_ROWS);
  return runAs(ctx, req, async (trx) => {
    const c = await buildContext(trx, seller);
    const seen = freshSeen();
    const evaluated = rows.map((raw, i) => ({ n: i + 2, raw, ...interpretRow(raw, c, seen) }));
    const bad = evaluated.filter((e) => e.errors.length).length;
    const job = await trx
      .insertInto('catalogue.import_job')
      .values({
        partner_id: seller.partnerId,
        seller_user_id: seller.sellerUserId,
        file_key: `${FILE_PREFIX}${body.filename}`,
        state: 'Validated',
        total_rows: rows.length,
        error_rows: bad,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    for (let i = 0; i < evaluated.length; i += 500) {
      await trx
        .insertInto('catalogue.import_row')
        .values(
          evaluated.slice(i, i + 500).map((e) => ({
            import_job_id: job.id,
            row_number: e.n,
            raw: JSON.stringify(e.raw),
            errors: JSON.stringify(e.errors),
            status: e.errors.length ? 'Invalid' : 'Valid',
          })),
        )
        .execute();
    }
    await recordAudit(trx, {
      entityType: 'import_job',
      entityId: job.id,
      from: null,
      to: 'Validated',
      actor: req.actor!,
      data: { rows: rows.length, invalid: bad },
    });
    return toJob(job);
  });
}

async function ownJob(trx: Tx, partnerId: string, id: string, lock = false): Promise<JobRow> {
  let q = trx
    .selectFrom('catalogue.import_job')
    .selectAll()
    .where('id', '=', id)
    .where('partner_id', '=', partnerId);
  if (lock) q = q.forUpdate();
  const j = await q.executeTakeFirst();
  if (!j) throw notFound('Import');
  return j;
}

export async function listImports(ctx: AppContext, req: FastifyRequest): Promise<Job[]> {
  const seller = requireManager(req);
  return runAs(ctx, req, async (trx) =>
    (
      await trx
        .selectFrom('catalogue.import_job')
        .selectAll()
        .where('partner_id', '=', seller.partnerId)
        .orderBy('created_at', 'desc')
        .limit(50)
        .execute()
    ).map(toJob),
  );
}

export async function getImport(ctx: AppContext, req: FastifyRequest, id: string): Promise<Detail> {
  const seller = requireManager(req);
  return runAs(ctx, req, async (trx) => {
    const job = await ownJob(trx, seller.partnerId, id);
    const rows = await trx
      .selectFrom('catalogue.import_row')
      .select(['row_number', 'status', 'raw', 'errors'])
      .where('import_job_id', '=', id)
      .orderBy('row_number')
      .limit(5000)
      .execute();
    return {
      ...toJob(job),
      rows: rows.map((r) => ({
        row: r.row_number,
        status: r.status as Detail['rows'][number]['status'],
        sku: (r.raw as RawRow).sku ?? null,
        errors: r.errors as unknown as FieldError[],
      })),
    };
  });
}

/** The error report a seller fixes and re-uploads. Every cell is neutralised against spreadsheet formula injection. */
export async function errorReportCsv(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<string> {
  const seller = requireManager(req);
  return runAs(ctx, req, async (trx) => {
    await ownJob(trx, seller.partnerId, id);
    const rows = await trx
      .selectFrom('catalogue.import_row')
      .select(['row_number', 'raw', 'errors'])
      .where('import_job_id', '=', id)
      .where('status', '=', 'Invalid')
      .orderBy('row_number')
      .execute();
    const lines: (string | number)[][] = [
      ['row', 'sku', 'column', 'message', ...IMPORT_COLUMNS.map((c) => `value:${c}`)],
    ];
    for (const r of rows) {
      const raw = r.raw as RawRow;
      for (const e of r.errors as unknown as FieldError[])
        lines.push([
          r.row_number,
          raw.sku ?? '',
          e.path,
          e.message,
          ...IMPORT_COLUMNS.map((c) => raw[c] ?? ''),
        ]);
    }
    return toCsv(lines);
  });
}

/* ---------------- Phase 2: commit ---------------- */

type CommitOutcome =
  | { kind: 'created' | 'updated'; productId: string; offerId: string }
  | { kind: 'rejected'; errors: FieldError[] };

async function applyRow(
  ctx: AppContext,
  trx: Tx,
  req: FastifyRequest,
  seller: SellerActor,
  raw: RawRow,
  jobId: string,
): Promise<CommitOutcome> {
  // Re-interpret against the *current* state: the catalogue may have moved since the dry run.
  const c = await buildContext(trx, seller);
  const { errors, parsed } = interpretRow(raw, c, freshSeen());
  if (!parsed) return { kind: 'rejected', errors };
  const partner = await trx
    .selectFrom('catalogue.partner')
    .select('commission_rate')
    .where('id', '=', seller.partnerId)
    .executeTakeFirstOrThrow();
  const existing = c.offersBySku.get(parsed.sku);
  const availability = reconcile(parsed.stock, undefined);
  const now = new Date(ctx.clock.now());

  if (existing) {
    const before = await trx
      .selectFrom('catalogue.seller_offer')
      .selectAll()
      .where('id', '=', existing.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (parsed.stock < before.stock_qty) {
      const held = await trx
        .selectFrom('commerce.reserved_qty')
        .select('reserved')
        .where('offer_id', '=', existing.id)
        .executeTakeFirst();
      if ((held?.reserved ?? 0) > parsed.stock) {
        return {
          kind: 'rejected',
          errors: [
            {
              path: 'stock',
              message: `${held?.reserved} unit(s) are held by buyers who are checking out; stock cannot go below that.`,
            },
          ],
        };
      }
    }
    await trx
      .updateTable('catalogue.seller_offer')
      .set({
        selling_price_fils: parsed.price,
        original_price_fils: parsed.original,
        stock_qty: parsed.stock,
        availability:
          parsed.stock > 0 && before.availability === 'Low Stock' ? 'Low Stock' : availability,
        delivery_days: parsed.delivery,
        viewing_status: parsed.viewing,
        viewing_confirmed_at: parsed.viewing === 'On Display' ? now : null,
        partner_location_id: parsed.locationId ?? before.partner_location_id,
      })
      .where('id', '=', existing.id)
      .execute();
    await recordAudit(trx, {
      entityType: 'seller_offer',
      entityId: existing.id,
      from: before.offer_status,
      to: before.offer_status,
      actor: req.actor!,
      reason: 'bulk import',
      data: {
        importJobId: jobId,
        before: { sellingPrice: Number(before.selling_price_fils), stockQty: before.stock_qty },
        after: { sellingPrice: parsed.price, stockQty: parsed.stock },
      },
    });
    return { kind: 'updated', productId: existing.productId, offerId: existing.id };
  }

  let productId = parsed.productId;
  if (productId) {
    const p = await trx
      .selectFrom('catalogue.product')
      .select(['data_status', 'lifecycle'])
      .where('id', '=', productId)
      .executeTakeFirst();
    if (!p || p.data_status !== 'Verified' || p.lifecycle !== 'Active')
      return {
        kind: 'rejected',
        errors: [{ path: 'product_id', message: 'Only Verified products can be listed.' }],
      };
  } else {
    productId = (await createProductRow(trx, seller.partnerId, parsed.newProduct!, req.actor!)).id;
  }
  const offer = await trx
    .insertInto('catalogue.seller_offer')
    .values({
      product_id: productId,
      partner_id: seller.partnerId,
      partner_location_id: parsed.locationId as string,
      seller_sku: parsed.sku,
      selling_price_fils: parsed.price,
      original_price_fils: parsed.original,
      availability,
      stock_qty: parsed.stock,
      viewing_status: parsed.viewing,
      viewing_confirmed_at: parsed.viewing === 'On Display' ? now : null,
      delivery_days: parsed.delivery,
      commission_rate: partner.commission_rate,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await recordAudit(trx, {
    entityType: 'seller_offer',
    entityId: offer.id,
    from: null,
    to: 'Active',
    actor: req.actor!,
    reason: 'bulk import',
    data: { importJobId: jobId, productId, sku: parsed.sku },
  });
  return { kind: 'created', productId, offerId: offer.id };
}

/**
 * Apply the valid rows in chunks of 100, each chunk one transaction: a chunk lands whole or not at all.
 * Re-committing is a no-op for a finished job and *resumes* a failed one — rows already Imported are
 * never touched twice, so a retry after a crash neither duplicates nor skips anything.
 */
export async function commitImport(ctx: AppContext, req: FastifyRequest, id: string): Promise<Job> {
  const seller = requireManager(req);
  const state = await runAs(
    ctx,
    req,
    async (trx) => (await ownJob(trx, seller.partnerId, id)).state,
  );
  if (state === 'Imported')
    return runAs(ctx, req, async (trx) => toJob(await ownJob(trx, seller.partnerId, id)));
  if (state !== 'Validated' && state !== 'Failed')
    throw new HttpError(
      409,
      'import_not_committable',
      `An import in state ${state} cannot be committed.`,
    );

  for (;;) {
    let progressed: boolean;
    try {
      progressed = await runAs(ctx, req, async (trx) => {
        const job = await ownJob(trx, seller.partnerId, id, true);
        if (job.state === 'Imported') return false;
        const chunk = await trx
          .selectFrom('catalogue.import_row')
          .select(['row_number', 'raw'])
          .where('import_job_id', '=', id)
          .where('status', '=', 'Valid')
          .orderBy('row_number')
          .limit(CHUNK)
          .execute();
        if (chunk.length === 0) return false;
        let created = 0;
        let updated = 0;
        for (const row of chunk) {
          const out = await applyRow(ctx, trx, req, seller, row.raw as RawRow, id);
          if (out.kind === 'rejected') {
            await trx
              .updateTable('catalogue.import_row')
              .set({ status: 'Invalid', errors: JSON.stringify(out.errors) })
              .where('import_job_id', '=', id)
              .where('row_number', '=', row.row_number)
              .execute();
            continue;
          }
          await trx
            .updateTable('catalogue.import_row')
            .set({ status: 'Imported', product_id: out.productId, offer_id: out.offerId })
            .where('import_job_id', '=', id)
            .where('row_number', '=', row.row_number)
            .execute();
          if (out.kind === 'created') created++;
          else updated++;
        }
        await trx
          .updateTable('catalogue.import_job')
          .set({
            created_count: (job.created_count ?? 0) + created,
            updated_count: (job.updated_count ?? 0) + updated,
            state: 'Validated',
          })
          .where('id', '=', id)
          .execute();
        return true;
      });
    } catch (error) {
      // The failed chunk rolled back whole. Earlier chunks stand; the job records the failure and can be resumed.
      await runAs(ctx, req, (trx) =>
        trx
          .updateTable('catalogue.import_job')
          .set({ state: 'Failed' })
          .where('id', '=', id)
          .execute(),
      );
      throw new HttpError(
        409,
        'import_chunk_failed',
        `The import stopped at an unexpected error (${error instanceof Error ? error.message : 'unknown'}). Rows already imported are kept; commit again to resume.`,
      );
    }
    if (!progressed) break;
  }

  return runAs(ctx, req, async (trx) => {
    const job = await ownJob(trx, seller.partnerId, id, true);
    if (job.state !== 'Imported') {
      const invalid = await trx
        .selectFrom('catalogue.import_row')
        .select((e) => e.fn.countAll<string>().as('n'))
        .where('import_job_id', '=', id)
        .where('status', '=', 'Invalid')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('catalogue.import_job')
        .set({
          state: 'Imported',
          committed_at: new Date(ctx.clock.now()),
          error_rows: Number(invalid.n),
          created_count: job.created_count ?? 0,
          updated_count: job.updated_count ?? 0,
        })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, {
        entityType: 'import_job',
        entityId: id,
        from: job.state,
        to: 'Imported',
        actor: req.actor!,
        data: { created: job.created_count ?? 0, updated: job.updated_count ?? 0 },
      });
    }
    return toJob(await ownJob(trx, seller.partnerId, id));
  });
}
