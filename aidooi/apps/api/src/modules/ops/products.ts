import { sql, type Selectable } from 'kysely';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type {
  OpsProductDetailSchema,
  OpsProductQuerySchema,
  OpsProductSummarySchema,
  PatchProductBodySchema,
  RejectProductBodySchema,
} from '@aidooi/contracts';
import type { DB } from '@aidooi/db';
import {
  RuleViolation,
  assertTransition,
  checkProductCompleteness,
  dataStatus,
  type DataStatus,
  type ProductAttrs,
  type ProductDraft,
} from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAs, type AppContext, type Tx } from '../../context.ts';
import { HttpError, notFound } from '../../http/problem.ts';
import { decodeKey, encodeKey, iso } from './cursors.ts';
import { guard, ROLES } from './guard.ts';

type Row = Selectable<DB['catalogue.product']>;
type Summary = z.infer<typeof OpsProductSummarySchema>;
type Detail = z.infer<typeof OpsProductDetailSchema>;

const ATTR_KEYS = [
  'seats',
  'bedSize',
  'capacity',
  'doorGroup',
  'rugSize',
  'adjustable',
  'cableManagement',
];

const attrsOf = (json: unknown): ProductAttrs => {
  const src = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(src).filter(([k, v]) => ATTR_KEYS.includes(k) && v !== null && v !== undefined),
  ) as ProductAttrs;
};
const scalarAttrs = (json: unknown): Detail['attributes'] =>
  Object.fromEntries(
    Object.entries((json ?? {}) as Record<string, unknown>).filter(([, v]) =>
      ['string', 'number', 'boolean'].includes(typeof v),
    ),
  ) as Detail['attributes'];

export const draftOf = (r: Row): ProductDraft => ({
  name: r.name,
  type: r.product_type,
  widthCm: r.width_cm,
  depthCm: r.depth_cm,
  heightCm: r.height_cm,
  primaryColour: r.primary_colour,
  secondaryColour: r.secondary_colour,
  material: r.material_family,
  primaryStyle: r.primary_style,
  secondaryStyle: r.secondary_style,
  attrs: attrsOf(r.attributes),
});

async function partnersOf(trx: Tx, productIds: readonly string[]) {
  const map = new Map<string, { id: string; tradeName: string }[]>();
  if (productIds.length === 0) return map;
  const rows = await trx
    .selectFrom('catalogue.seller_offer as o')
    .innerJoin('catalogue.partner as p', 'p.id', 'o.partner_id')
    .select(['o.product_id', 'p.id', 'p.trade_name'])
    .where('o.product_id', 'in', [...productIds])
    .groupBy(['o.product_id', 'p.id', 'p.trade_name'])
    .execute();
  for (const r of rows) {
    const l = map.get(r.product_id) ?? [];
    l.push({ id: r.id, tradeName: r.trade_name });
    map.set(r.product_id, l);
  }
  return map;
}

const summaryOf = (
  r: Row,
  partners: Map<string, { id: string; tradeName: string }[]>,
): Summary => ({
  id: r.id,
  name: r.name,
  type: r.product_type,
  dataStatus: r.data_status as DataStatus,
  lifecycle: r.lifecycle as 'Active' | 'Inactive',
  updatedAt: iso(r.updated_at),
  completeness: ((c) => ({
    missing: [...c.missing],
    invalid: [...c.invalid],
    complete: c.complete,
  }))(checkProductCompleteness(draftOf(r))),
  partners: partners.get(r.id) ?? [],
});

export async function productQueue(
  ctx: AppContext,
  req: FastifyRequest,
  q: z.infer<typeof OpsProductQuerySchema>,
) {
  guard(req, ROLES.catalogueRead);
  const after = decodeKey(q.cursor);
  return runAs(ctx, req, async (trx) => {
    let query = trx.selectFrom('catalogue.product').selectAll().where('data_status', '=', q.status);
    if (after) query = query.where('id', '>', after);
    if (q.type) query = query.where('product_type', '=', q.type);
    if (q.search) {
      const like = `%${q.search.replace(/[%_\\]/g, '\\$&')}%`;
      query = query.where((e) => e.or([e('name', 'ilike', like), e('id', 'ilike', like)]));
    }
    if (q.partnerId) {
      const pid = q.partnerId;
      query = query.where((e) =>
        e.exists(
          e
            .selectFrom('catalogue.seller_offer as o')
            .select('o.id')
            .whereRef('o.product_id', '=', 'catalogue.product.id')
            .where('o.partner_id', '=', pid),
        ),
      );
    }
    const rows = await query
      .orderBy('id')
      .limit(q.limit + 1)
      .execute();
    const items = rows.slice(0, q.limit);
    const partners = await partnersOf(
      trx,
      items.map((i) => i.id),
    );
    const last = items[items.length - 1];
    return {
      items: items.map((r) => summaryOf(r, partners)),
      nextCursor: rows.length > q.limit && last ? encodeKey(last.id) : null,
    };
  });
}

async function load(trx: Tx, id: string, lock = false): Promise<Row> {
  let q = trx.selectFrom('catalogue.product').selectAll().where('id', '=', id);
  if (lock) q = q.forUpdate();
  const r = await q.executeTakeFirst();
  if (!r) throw notFound('Product');
  return r;
}

export async function productDetail(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<Detail> {
  guard(req, ROLES.catalogueRead);
  return runAs(ctx, req, async (trx) => {
    const r = await load(trx, id);
    const partners = await partnersOf(trx, [id]);
    const offers = await trx
      .selectFrom('catalogue.seller_offer')
      .select([
        'id',
        'partner_id',
        'selling_price_fils',
        'availability',
        'stock_qty',
        'offer_status',
      ])
      .where('product_id', '=', id)
      .orderBy('id')
      .execute();
    const history = await trx
      .selectFrom('audit.event')
      .select(['at', 'from_state', 'to_state', 'actor_type', 'actor_id', 'reason'])
      .where('entity_type', '=', 'product')
      .where('entity_id', '=', id)
      .orderBy('at', 'desc')
      .limit(100)
      .execute();
    return {
      ...summaryOf(r, partners),
      parentId: r.parent_id,
      widthCm: r.width_cm,
      depthCm: r.depth_cm,
      heightCm: r.height_cm,
      primaryColour: r.primary_colour,
      secondaryColour: r.secondary_colour,
      material: r.material_family,
      primaryStyle: r.primary_style,
      secondaryStyle: r.secondary_style,
      attributes: scalarAttrs(r.attributes),
      verifiedAt: r.verified_at ? iso(r.verified_at) : null,
      offers: offers.map((o) => ({
        id: o.id,
        partnerId: o.partner_id,
        sellingPrice: Number(o.selling_price_fils),
        availability: o.availability,
        stockQty: o.stock_qty,
        status: o.offer_status,
      })),
      history: history.map((h) => ({
        at: iso(h.at),
        from: h.from_state,
        to: h.to_state,
        actorType: h.actor_type,
        actorId: h.actor_id,
        reason: h.reason,
      })),
    };
  });
}

/**
 * Ops may correct any field. Changing a Verified product never leaves it Verified: it drops to
 * Ready for Review through the machine, so the correction is itself reviewed.
 */
export async function patchProduct(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  b: z.infer<typeof PatchProductBodySchema>,
): Promise<Detail> {
  guard(req, ROLES.catalogueWrite);
  await runAs(ctx, req, async (trx) => {
    const r = await load(trx, id, true);
    const set: Record<string, unknown> = {};
    if (b.name !== undefined) set['name'] = b.name;
    if (b.type !== undefined) set['product_type'] = b.type;
    if (b.widthCm !== undefined) set['width_cm'] = b.widthCm;
    if (b.depthCm !== undefined) set['depth_cm'] = b.depthCm;
    if (b.heightCm !== undefined) set['height_cm'] = b.heightCm;
    if (b.primaryColour !== undefined) set['primary_colour'] = b.primaryColour;
    if (b.secondaryColour !== undefined) set['secondary_colour'] = b.secondaryColour;
    if (b.material !== undefined) set['material_family'] = b.material;
    if (b.primaryStyle !== undefined) set['primary_style'] = b.primaryStyle;
    if (b.secondaryStyle !== undefined) set['secondary_style'] = b.secondaryStyle;
    if (b.attributes !== undefined) set['attributes'] = JSON.stringify(b.attributes);
    const wasVerified = r.data_status === 'Verified';
    if (wasVerified) {
      assertTransition(dataStatus, 'Verified', 'Ready for Review');
      set['data_status'] = 'Ready for Review';
    }
    try {
      await trx.updateTable('catalogue.product').set(set).where('id', '=', id).execute();
    } catch (e) {
      // A value outside its controlled vocabulary is the caller's mistake, not an outage.
      if ((e as { code?: string }).code === '23514')
        throw new HttpError(
          422,
          'invalid_product_value',
          'A value is outside its controlled vocabulary.',
        );
      throw e;
    }
    await recordAudit(trx, {
      entityType: 'product',
      entityId: id,
      from: r.data_status,
      to: wasVerified ? 'Ready for Review' : r.data_status,
      actor: req.actor!,
      reason: 'corrected by ops',
      data: { fields: Object.keys(b) },
    });
  });
  return productDetail(ctx, req, id);
}

export async function verifyProduct(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<Detail> {
  const actor = guard(req, ROLES.catalogueWrite);
  await runAs(ctx, req, async (trx) => {
    const r = await load(trx, id, true);
    assertTransition(dataStatus, r.data_status as DataStatus, 'Verified');
    if (r.data_status === 'Verified') return;
    const report = checkProductCompleteness(draftOf(r));
    if (!report.complete) {
      throw new HttpError(
        422,
        'product_incomplete',
        `Cannot verify: missing ${[...report.missing, ...report.invalid].join(', ')}.`,
        [...report.missing, ...report.invalid].map((f) => ({
          path: f,
          message: 'required for verification',
        })),
      );
    }
    await trx
      .updateTable('catalogue.product')
      .set({
        data_status: 'Verified',
        verified_by: actor.opsUserId,
        verified_at: new Date(ctx.clock.now()),
      })
      .where('id', '=', id)
      .execute();
    await recordAudit(trx, {
      entityType: 'product',
      entityId: id,
      from: r.data_status,
      to: 'Verified',
      actor,
      reason: 'verified',
    });
  });
  return productDetail(ctx, req, id);
}

export async function rejectProduct(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  b: z.infer<typeof RejectProductBodySchema>,
): Promise<Detail> {
  guard(req, ROLES.catalogueWrite);
  const partners = await runAs(ctx, req, async (trx) => {
    const r = await load(trx, id, true);
    if (r.data_status !== 'Ready for Review')
      throw new RuleViolation(
        'illegal_transition',
        `data_status: ${r.data_status} → Incomplete is not allowed`,
      );
    assertTransition(dataStatus, 'Ready for Review', 'Incomplete');
    await trx
      .updateTable('catalogue.product')
      .set({ data_status: 'Incomplete' })
      .where('id', '=', id)
      .execute();
    await recordAudit(trx, {
      entityType: 'product',
      entityId: id,
      from: 'Ready for Review',
      to: 'Incomplete',
      actor: req.actor!,
      reason: 'rejected',
      data: { reasons: b.reasons },
    });
    return partnersOf(trx, [id]);
  });
  // Tell every seller who offers it, after the decision is durable.
  for (const p of partners.get(id) ?? []) {
    await ctx.notifier.send({
      template: 'product.rejected',
      to: { kind: 'partner', id: p.id },
      data: { productId: id, reasons: b.reasons.join('; ') },
      dedupeKey: `product-rejected:${id}:${p.id}:${ctx.clock.now()}`,
    });
  }
  return productDetail(ctx, req, id);
}

export async function setLifecycle(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  to: 'Active' | 'Inactive',
): Promise<Detail> {
  guard(req, ROLES.catalogueWrite);
  await runAs(ctx, req, async (trx) => {
    const r = await load(trx, id, true);
    if (r.lifecycle === to) return;
    await trx
      .updateTable('catalogue.product')
      .set({ lifecycle: to })
      .where('id', '=', id)
      .execute();
    await recordAudit(trx, {
      entityType: 'product',
      entityId: id,
      from: r.lifecycle,
      to,
      actor: req.actor!,
      reason: 'lifecycle',
    });
  });
  return productDetail(ctx, req, id);
}

export async function productStats(ctx: AppContext, req: FastifyRequest) {
  guard(req, ROLES.catalogueRead);
  return runAs(ctx, req, async (trx) => {
    const counts = await trx
      .selectFrom('catalogue.product')
      .select(['data_status', (e) => e.fn.countAll<string>().as('n')])
      .groupBy('data_status')
      .execute();
    const n = (s: string) => Number(counts.find((c) => c.data_status === s)?.n ?? 0);
    const age = await sql<{ h: number | null }>`
      SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY greatest(0, extract(epoch FROM ${new Date(ctx.clock.now())}::timestamptz - updated_at))) / 3600)::float8 AS h
        FROM catalogue.product WHERE data_status = 'Ready for Review'`.execute(trx);
    const per = await sql<{
      partner_id: string;
      trade_name: string;
      rejected: string;
      verified: string;
    }>`
      SELECT pt.id AS partner_id, pt.trade_name,
             count(DISTINCT o.product_id) FILTER (WHERE EXISTS (
               SELECT 1 FROM audit.event e WHERE e.entity_type = 'product' AND e.entity_id = o.product_id
                  AND e.from_state = 'Ready for Review' AND e.to_state = 'Incomplete')) AS rejected,
             count(DISTINCT o.product_id) FILTER (WHERE pr.data_status = 'Verified') AS verified
        FROM catalogue.seller_offer o
        JOIN catalogue.partner pt ON pt.id = o.partner_id
        JOIN catalogue.product pr ON pr.id = o.product_id
       GROUP BY pt.id, pt.trade_name ORDER BY pt.trade_name`.execute(trx);
    return {
      queue: {
        readyForReview: n('Ready for Review'),
        incomplete: n('Incomplete'),
        medianAgeHours: age.rows[0]?.h ?? null,
      },
      rejectionByPartner: per.rows.map((r) => {
        const rejected = Number(r.rejected);
        const verified = Number(r.verified);
        const decided = rejected + verified;
        return {
          partnerId: r.partner_id,
          tradeName: r.trade_name,
          rejected,
          verified,
          rejectionRate: decided === 0 ? 0 : rejected / decided,
        };
      }),
    };
  });
}
