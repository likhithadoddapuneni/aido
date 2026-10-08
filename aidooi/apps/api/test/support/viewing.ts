/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies in HTTP tests are untyped JSON */
import { randomUUID } from 'node:crypto';
import { fixtures } from '@aidooi/db/testing';
import {
  COMPAT_MAP_VERSION,
  STANDARDS_VERSION,
  runRecommendation,
  type RoomProject,
} from '@aidooi/domain';
import { runAsSystem } from '../../src/context.ts';
import { requireApprovedMaps } from '../../src/modules/catalogue/compat-maps.ts';
import { loadSnapshot } from '../../src/modules/catalogue/snapshot.ts';
import { buyer, seller, type Harness } from './harness.ts';

const LIVING_TYPES = [
  'Sofa',
  'Accent Chair',
  'Coffee Table',
  'Side Table',
  'TV Unit',
  'Rug',
  'Floor Lamp',
  'Table Lamp',
  'Wall Art',
  'Vase',
  'Planter',
  'Mirror',
];

export interface CompositionItem {
  readonly slotKey: string;
  readonly offerId: string;
  readonly productId: string;
  readonly partnerId: string;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly viewingStatus: string;
}

export interface TestComposition {
  readonly compositionId: string;
  readonly projectId: string;
  readonly items: readonly CompositionItem[];
}

/**
 * A composition produced by the real engine over the real database catalogue, persisted the way the
 * recommendation module will (project → run → composition → items), so prices and offers are real.
 */
export async function compositionFromRun(
  h: Harness,
  customerId: string,
  project?: Partial<RoomProject>,
): Promise<TestComposition> {
  const maps = await requireApprovedMaps(h.admin);
  const snapshot = await runAsSystem(h.ctx, (trx) => loadSnapshot(trx, LIVING_TYPES));
  const run = runRecommendation(
    {
      path: 'livingRoom',
      tier: 'Standard',
      style: 'modern',
      colour: 'grey',
      spec: { lengthM: 5, widthM: 4 },
      ...project,
    },
    snapshot,
  );
  const option = run.options[0];
  if (!option) throw new Error('the engine produced no option for the test project');

  const proj = await h.admin
    .insertInto('recommendation.project')
    .values({ customer_id: customerId, path_id: 'livingRoom', state: 'Ready for Recommendation' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const runRow = await h.admin
    .insertInto('recommendation.recommendation_run')
    .values({
      project_id: proj.id,
      state: 'Completed',
      size_class: run.geometry.sizeClass,
      budget_low_fils: run.range[0],
      budget_high_fils: run.range[1],
      catalogue_version: run.catalogueVersion,
      standards_version: STANDARDS_VERSION,
      engine_version: `test-${COMPAT_MAP_VERSION}`,
      style_map_id: maps.ids.style,
      colour_map_id: maps.ids.colour,
      material_map_id: maps.ids.material,
      input_hash: randomUUID(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const comp = await h.admin
    .insertInto('recommendation.composition')
    .values({
      run_id: runRow.id,
      objective: 'best_overall',
      score: option.valid ? option.score : 0,
      total_price_fils: option.total,
      state: 'Valid',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.admin
    .insertInto('recommendation.composition_item')
    .values(
      option.items.map((i) => ({
        composition_id: comp.id,
        slot_key: i.slot.key,
        role: i.slot.role,
        essential: Boolean(i.slot.essential),
        quantity: i.qty,
        product_id: i.product.id,
        offer_id: i.offer.id,
        unit_price_fils: i.offer.sellingPrice,
      })),
    )
    .execute();

  const offers = await h.admin
    .selectFrom('catalogue.seller_offer')
    .select(['id', 'partner_id', 'viewing_status'])
    .where(
      'id',
      'in',
      option.items.map((i) => i.offer.id),
    )
    .execute();
  return {
    compositionId: comp.id,
    projectId: proj.id,
    items: option.items.map((i) => {
      const o = offers.find((x) => x.id === i.offer.id)!;
      return {
        slotKey: i.slot.key,
        offerId: i.offer.id,
        productId: i.product.id,
        partnerId: o.partner_id,
        unitPrice: i.offer.sellingPrice,
        quantity: i.qty,
        viewingStatus: o.viewing_status,
      };
    }),
  };
}

export async function newBuyer(h: Harness) {
  const id = await fixtures.customer(h.admin);
  return { id, actor: buyer(id) };
}

export async function newSeller(h: Harness, partnerId: string) {
  const sellerUserId = await fixtures.sellerUser(h.admin, partnerId);
  return seller(partnerId, sellerUserId, 'seller_manager');
}

export const key = () => `test-key-${randomUUID()}`;
export const inDays = (h: Harness, days: number) =>
  new Date(h.clock.now() + days * 86_400_000).toISOString();

/** Σ debits = Σ credits in every entry group, and net balance per account (debit − credit). */
export async function ledger(h: Harness) {
  const rows = await h.admin
    .selectFrom('commerce.ledger_entry')
    .select(['entry_group', 'account', 'direction', 'amount_fils', 'ref_id'])
    .execute();
  const groups = new Map<string, number>();
  const accounts = new Map<string, number>();
  for (const r of rows) {
    const signed = (r.direction === 'debit' ? 1 : -1) * Number(r.amount_fils);
    groups.set(r.entry_group, (groups.get(r.entry_group) ?? 0) + signed);
    accounts.set(r.account, (accounts.get(r.account) ?? 0) + signed);
  }
  return {
    groupCount: groups.size,
    unbalanced: [...groups.entries()].filter(([, v]) => v !== 0),
    balance: (account: string) => accounts.get(account) ?? 0,
    forRef: (refId: string) => rows.filter((r) => r.ref_id === refId),
  };
}

export const auditTrail = async (h: Harness, entityType: string, entityId: string) =>
  (
    await h.admin
      .selectFrom('audit.event')
      .select(['from_state', 'to_state'])
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId)
      .orderBy('at')
      .execute()
  ).map((e) => `${e.from_state ?? '∅'}→${e.to_state ?? '∅'}`);

/* ---------------- Scenario drivers ---------------- */

import { allJobHandlers } from '../../src/jobs/registry.ts';
import { runOnce } from '../../src/jobs/runner.ts';
import type { Viewing } from '@aidooi/contracts';
import type { ApiActor } from '../../src/http/actor.ts';

export const api = async (
  h: Harness,
  method: 'GET' | 'POST',
  url: string,
  actor: ApiActor | null,
  body?: unknown,
  idem?: string,
) => {
  const res = await h.app.inject({
    method,
    url,
    headers: h.as(actor, idem ? { 'idempotency-key': idem } : {}),
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: res.statusCode, body: res.json() as any };
};

/** Make every pending job of `kind` due now and run the worker once. */
export async function runJobs(h: Harness, kind?: string) {
  if (kind)
    await h.admin
      .updateTable('platform.job')
      .set({ run_at: new Date(Date.now() - 1000) })
      .where('kind', '=', kind)
      .where('status', 'in', ['Pending', 'Failed'])
      .execute();
  return runOnce(h.ctx, allJobHandlers(), { limit: 50 });
}

export interface Booked {
  readonly customerId: string;
  readonly buyerActor: ApiActor;
  readonly viewing: Viewing;
  readonly composition: TestComposition;
  readonly sellers: ReadonlyMap<string, ApiActor>;
  readonly scheduledAt: string;
}

/**
 * Drive a viewing from composition to Confirmed: create, every showroom confirms, the deposit is paid.
 * `partnerIds` limits the viewing to items of those partners (default: everything).
 */
export async function bookViewing(
  h: Harness,
  opts: {
    project?: Partial<RoomProject>;
    onlyPartners?: number;
    token?: string;
    visitInHours?: number;
  } = {},
): Promise<Booked> {
  const b = await newBuyer(h);
  const composition = await compositionFromRun(h, b.id, opts.project);
  const partners = [...new Set(composition.items.map((i) => i.partnerId))];
  const chosen = new Set(partners.slice(0, opts.onlyPartners ?? partners.length));
  const itemSlotKeys = composition.items
    .filter((i) => chosen.has(i.partnerId))
    .map((i) => i.slotKey);

  const created = await api(
    h,
    'POST',
    '/v1/viewings',
    b.actor,
    { compositionId: composition.compositionId, itemSlotKeys },
    key(),
  );
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);

  const sellers = new Map<string, ApiActor>();
  for (const p of chosen) sellers.set(p, await newSeller(h, p));
  for (const [p, s] of sellers) {
    const tasks = await api(h, 'GET', '/v1/seller/viewing-tasks', s);
    for (const t of tasks.body as { id: string }[]) {
      const r = await api(h, 'POST', `/v1/seller/viewing-tasks/${t.id}/respond`, s, {
        response: 'Confirmed',
        displayConfirmed: true,
      });
      if (r.status !== 200) throw new Error(`respond failed for ${p}: ${JSON.stringify(r.body)}`);
    }
  }
  const scheduledAt = new Date(h.clock.now() + (opts.visitInHours ?? 2) * 3_600_000).toISOString();
  const paid = await api(
    h,
    'POST',
    `/v1/viewings/${created.body.id}/deposit`,
    b.actor,
    { paymentToken: opts.token ?? 'tok_ok', scheduledAt },
    key(),
  );
  if (paid.status !== 200) throw new Error(`deposit failed: ${JSON.stringify(paid.body)}`);
  return {
    customerId: b.id,
    buyerActor: b.actor,
    viewing: paid.body.viewing as Viewing,
    composition,
    sellers,
    scheduledAt,
  };
}

/** The buyer shows the pass at every confirmed showroom and each marks the visit with `outcome`. */
export async function visit(
  h: Harness,
  booked: Booked,
  outcome: 'Completed' | 'No-show',
): Promise<void> {
  const pass = await api(h, 'GET', `/v1/viewings/${booked.viewing.id}/pass`, booked.buyerActor);
  for (const s of booked.sellers.values()) {
    if (outcome === 'Completed') {
      const scanned = await api(h, 'POST', '/v1/seller/viewings/scan', s, {
        token: pass.body.token,
      });
      if (scanned.status !== 200) throw new Error(`scan failed: ${JSON.stringify(scanned.body)}`);
    }
    const r = await api(h, 'POST', `/v1/seller/viewings/${booked.viewing.id}/outcome`, s, {
      outcome,
    });
    if (r.status !== 200) throw new Error(`outcome failed: ${JSON.stringify(r.body)}`);
  }
}

export const viewingRow = (h: Harness, id: string) =>
  h.admin
    .selectFrom('viewing.viewing_request')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
export const depositRow = (h: Harness, requestId: string) =>
  h.admin
    .selectFrom('viewing.viewing_deposit')
    .selectAll()
    .where('viewing_request_id', '=', requestId)
    .executeTakeFirstOrThrow();
