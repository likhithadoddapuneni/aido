import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type {
  MediaConfirmBodySchema,
  MediaUploadBodySchema,
  MediaUploadSchema,
  ProductDataSchema,
  SellerProductSchema,
} from '@aidooi/contracts';
import {
  RuleViolation,
  assertTransition,
  dataStatus,
  initialDataStatus,
  validateProductData,
  type DataStatus,
  type FieldError,
  type ProductAttrs,
  type ProductDataInput,
} from '@aidooi/domain';
import type { Selectable } from 'kysely';
import type { DB } from '@aidooi/db';
import { recordAudit } from '../../audit.ts';
import { runAs, type AppContext, type Tx } from '../../context.ts';
import { HttpError, conflict, notFound } from '../../http/problem.ts';
import { requireManager } from './common.ts';

export type SellerProduct = z.infer<typeof SellerProductSchema>;
type ProductData = z.infer<typeof ProductDataSchema>;
type ProductRow = Selectable<DB['catalogue.product']>;

/** Fields whose change alters what the product *is*: editing any of them voids a prior verification. */
const IDENTITY_FIELDS = [
  'name',
  'type',
  'widthCm',
  'depthCm',
  'heightCm',
  'primaryColour',
  'secondaryColour',
  'specificColour',
  'primaryStyle',
  'secondaryStyle',
  'material',
  'attributes',
] as const;

const validationFailed = (errors: readonly FieldError[]) =>
  new HttpError(422, 'product_data_invalid', 'The product data breaks the catalogue standards.', [
    ...errors,
  ]);

function toInput(row: ProductRow): ProductDataInput {
  return {
    name: row.name,
    type: row.product_type,
    widthCm: row.width_cm ?? undefined,
    depthCm: row.depth_cm ?? undefined,
    heightCm: row.height_cm ?? undefined,
    primaryColour: row.primary_colour ?? undefined,
    secondaryColour: row.secondary_colour,
    specificColour: row.specific_colour,
    primaryStyle: row.primary_style ?? undefined,
    secondaryStyle: row.secondary_style,
    material: row.material_family ?? undefined,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
  };
}

export async function toSellerProduct(trx: Tx, row: ProductRow): Promise<SellerProduct> {
  const media = await trx
    .selectFrom('catalogue.product_media')
    .select(['id', 'storage_key', 'position'])
    .where('product_id', '=', row.id)
    .orderBy('position')
    .execute();
  return {
    id: row.id,
    name: row.name,
    type: row.product_type,
    dataStatus: row.data_status as SellerProduct['dataStatus'],
    missing: [...validateProductData(toInput(row)).missing],
    widthCm: row.width_cm,
    depthCm: row.depth_cm,
    heightCm: row.height_cm,
    primaryColour: row.primary_colour as SellerProduct['primaryColour'],
    primaryStyle: row.primary_style as SellerProduct['primaryStyle'],
    material: row.material_family,
    attributes: Object.fromEntries(
      Object.entries((row.attributes ?? {}) as Record<string, unknown>).filter(([, v]) =>
        ['string', 'number', 'boolean'].includes(typeof v),
      ),
    ) as SellerProduct['attributes'],
    media: media.map((m) => ({ id: m.id, storageKey: m.storage_key, position: m.position })),
  };
}

const fromData = (d: ProductData): ProductDataInput => ({
  name: d.name,
  type: d.type,
  widthCm: d.widthCm,
  depthCm: d.depthCm,
  heightCm: d.heightCm,
  primaryColour: d.primaryColour,
  secondaryColour: d.secondaryColour,
  specificColour: d.specificColour,
  primaryStyle: d.primaryStyle,
  secondaryStyle: d.secondaryStyle,
  material: d.material,
  attributes: d.attributes,
});

/**
 * A seller proposes a product. It is never live: the best it can reach is Ready for Review, and only an
 * ops reviewer can mark it Verified (AID-DATA-014). Values that break a rule refuse the submission;
 * values merely missing save it as Incomplete.
 */
export async function createProductRow(
  trx: Tx,
  partnerId: string,
  data: ProductData,
  actor: NonNullable<FastifyRequest['actor']>,
): Promise<ProductRow> {
  const result = validateProductData(fromData(data));
  if (result.errors.length) throw validationFailed(result.errors);
  if (!data.name || !data.type)
    throw validationFailed([
      { path: !data.name ? 'name' : 'type', message: 'Required to submit a product.' },
    ]);

  const parent = await trx
    .insertInto('catalogue.parent_product')
    .values({ model_name: data.name })
    .returning('id')
    .executeTakeFirstOrThrow();
  const status = initialDataStatus(result);
  const row = await trx
    .insertInto('catalogue.product')
    .values({
      parent_id: parent.id,
      name: data.name.trim(),
      main_category: 'Furniture',
      category: data.type,
      product_type: data.type,
      width_cm: data.widthCm ?? null,
      depth_cm: data.depthCm ?? null,
      height_cm: data.heightCm ?? null,
      primary_colour: data.primaryColour ?? null,
      secondary_colour: data.secondaryColour ?? null,
      specific_colour: data.specificColour ?? null,
      primary_style: data.primaryStyle ?? null,
      secondary_style: data.secondaryStyle ?? null,
      material_family: data.material ?? null,
      attributes: JSON.stringify(data.attributes ?? {}),
      data_status: status,
      submitted_by_partner_id: partnerId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await recordAudit(trx, {
    entityType: 'product',
    entityId: row.id,
    from: null,
    to: status,
    actor,
    data: { submittedBy: partnerId, missing: result.missing },
  });
  return row;
}

async function ownProduct(trx: Tx, partnerId: string, id: string): Promise<ProductRow> {
  const row = await trx
    .selectFrom('catalogue.product')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  // Another partner's product, or one ops loaded, is not this seller's to see or change.
  if (!row || row.submitted_by_partner_id !== partnerId) throw notFound('Product');
  return row;
}

export async function listProducts(ctx: AppContext, req: FastifyRequest): Promise<SellerProduct[]> {
  const seller = requireManager(req);
  return runAs(ctx, req, async (trx) => {
    const rows = await trx
      .selectFrom('catalogue.product')
      .selectAll()
      .where('submitted_by_partner_id', '=', seller.partnerId)
      .orderBy('id', 'desc')
      .limit(200)
      .execute();
    const out: SellerProduct[] = [];
    for (const r of rows) out.push(await toSellerProduct(trx, r));
    return out;
  });
}

export async function updateProduct(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  patch: ProductData,
): Promise<SellerProduct> {
  const seller = requireManager(req);
  return runAs(ctx, req, async (trx) => {
    const row = await ownProduct(trx, seller.partnerId, id);
    const merged: ProductDataInput = {
      ...toInput(row),
      ...Object.fromEntries(Object.entries(fromData(patch)).filter(([, v]) => v !== undefined)),
    };
    const result = validateProductData(merged);
    if (result.errors.length) throw validationFailed(result.errors);

    const current = row.data_status as DataStatus;
    const touchesIdentity = IDENTITY_FIELDS.some((f) => patch[f] !== undefined);
    // Editing what a product *is* withdraws its verification. Verified → Ready for Review is the only
    // way out of Verified; the machine refuses anything else.
    let next: DataStatus = current;
    if (touchesIdentity) {
      next = current === 'Verified' ? 'Ready for Review' : initialDataStatus(result);
      assertTransition(dataStatus, current, next);
    }
    const attrs = merged.attributes ?? {};
    const updated = await trx
      .updateTable('catalogue.product')
      .set({
        name: merged.name?.trim() ?? row.name,
        product_type: merged.type ?? row.product_type,
        category: merged.type ?? row.category,
        width_cm: merged.widthCm ?? null,
        depth_cm: merged.depthCm ?? null,
        height_cm: merged.heightCm ?? null,
        primary_colour: merged.primaryColour ?? null,
        secondary_colour: merged.secondaryColour ?? null,
        specific_colour: merged.specificColour ?? null,
        primary_style: merged.primaryStyle ?? null,
        secondary_style: merged.secondaryStyle ?? null,
        material_family: merged.material ?? null,
        attributes: JSON.stringify(attrs as ProductAttrs),
        data_status: next,
        // Unverified data carries no verifier; the CHECK ties the two together.
        ...(next !== 'Verified' ? { verified_by: null, verified_at: null } : {}),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      entityType: 'product',
      entityId: id,
      from: current,
      to: next,
      actor: req.actor!,
      reason: touchesIdentity ? 'seller edited product data' : 'seller edit',
      data: { fields: Object.keys(patch), missing: result.missing },
    });
    return toSellerProduct(trx, updated);
  });
}

/* ---------------- Photographs ---------------- */

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const UPLOAD_TTL_MS = 15 * 60_000;
const MAX_PHOTOS = 12;

export async function requestUpload(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  body: z.infer<typeof MediaUploadBodySchema>,
): Promise<z.infer<typeof MediaUploadSchema>> {
  const seller = requireManager(req);
  await runAs(ctx, req, async (trx) => {
    await ownProduct(trx, seller.partnerId, id);
    const n = await trx
      .selectFrom('catalogue.product_media')
      .select((e) => e.fn.countAll<string>().as('n'))
      .where('product_id', '=', id)
      .executeTakeFirstOrThrow();
    if (Number(n.n) >= MAX_PHOTOS)
      throw conflict('too_many_photos', `A product may have at most ${MAX_PHOTOS} photographs.`);
  });
  // The key is ours, never the client's: it names the product and a fresh id, and is bound to the signature.
  const storageKey = `products/${id}/${ctx.ids.uuid()}.${EXT[body.contentType]}`;
  const expiresAt = new Date(ctx.clock.now() + UPLOAD_TTL_MS);
  const signed = await ctx.media.signUpload({
    key: storageKey,
    contentType: body.contentType,
    maxBytes: body.sizeBytes,
    expiresAt,
  });
  return {
    storageKey,
    uploadUrl: signed.url,
    expiresAt: expiresAt.toISOString(),
    method: 'PUT',
    headers: signed.headers,
  };
}

export async function confirmUpload(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  body: z.infer<typeof MediaConfirmBodySchema>,
): Promise<SellerProduct> {
  const seller = requireManager(req);
  // A key is only ever accepted for the product it was issued for, so one product cannot claim another's object.
  if (!new RegExp(`^products/${id}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(body.storageKey)) {
    throw new RuleViolation('invalid_storage_key', 'That upload does not belong to this product.');
  }
  const stored = await ctx.media.head(body.storageKey);
  if (!stored) throw conflict('upload_not_found', 'The file has not been uploaded yet.');
  return runAs(ctx, req, async (trx) => {
    const row = await ownProduct(trx, seller.partnerId, id);
    const dup = await trx
      .selectFrom('catalogue.product_media')
      .select('id')
      .where('storage_key', '=', body.storageKey)
      .executeTakeFirst();
    if (!dup) {
      const taken = await trx
        .selectFrom('catalogue.product_media')
        .select('id')
        .where('product_id', '=', id)
        .where('position', '=', body.position)
        .executeTakeFirst();
      if (taken)
        throw conflict(
          'photo_position_taken',
          `Position ${body.position} already has a photograph.`,
        );
      await trx
        .insertInto('catalogue.product_media')
        .values({
          product_id: id,
          storage_key: body.storageKey,
          position: body.position,
          alt_text: body.altText,
          width_px: body.widthPx,
          height_px: body.heightPx,
        })
        .execute();
      await recordAudit(trx, {
        entityType: 'product',
        entityId: id,
        from: row.data_status,
        to: row.data_status,
        actor: req.actor!,
        reason: 'photo added',
        data: { storageKey: body.storageKey },
      });
    }
    return toSellerProduct(trx, row);
  });
}
