import { createHash } from 'node:crypto';
import type { Selectable } from 'kysely';
import type { z } from 'zod';
import {
  ProjectInputSchema,
  type BudgetCardsSchema,
  type CompositionSchema,
  type ProjectSchema,
  type RankingSchema,
  type RecommendationResponseSchema,
  type RunSchema,
} from '@aidooi/contracts';
import type { DB } from '@aidooi/db';
import {
  ENGINE_VERSION,
  STANDARDS_VERSION,
  TIERS,
  alternativesFor,
  applyReplacement,
  fils,
  rankIndividual,
  removeItem,
  runProject,
  runRecommendation,
  type Option,
  type RunResult,
  type SnapshotCatalogue,
} from '@aidooi/domain';
import { canonicalJson, requireApprovedMaps } from '../catalogue/compat-maps.ts';
import { loadOfferSummaries, loadProductSummaries } from '../catalogue/cards.ts';
import { loadSnapshot } from '../catalogue/snapshot.ts';
import type { AppContext, Tx } from '../../context.ts';
import { runAs } from '../../context.ts';
import { recordAudit } from '../../audit.ts';
import { conflict, notFound } from '../../http/problem.ts';
import { requireBuyer } from '../../http/actor.ts';
import { compositionDto, toMatch, type Cards } from './dto.ts';
import {
  isMultiRoomInput,
  isRoomInput,
  summarise,
  toMultiRoomProject,
  toRoomProject,
  typesNeeded,
} from './project-mapping.ts';
import { OBJECTIVE_COLUMNS, rehydrate, roomProjectFor } from './rehydrate.ts';
import type { FastifyRequest } from 'fastify';

type Project = z.infer<typeof ProjectSchema>;
type Composition = z.infer<typeof CompositionSchema>;
type Run = z.infer<typeof RunSchema>;
type RecommendationResponse = z.infer<typeof RecommendationResponseSchema>;
type BudgetCards = z.infer<typeof BudgetCardsSchema>;
type Ranking = z.infer<typeof RankingSchema>;
type ProjectRow = Selectable<DB['recommendation.project']>;
type RunRow = Selectable<DB['recommendation.recommendation_run']>;

const TIER_BLURB: Record<(typeof TIERS)[number], string> = {
  Essential: 'Covers the essentials well, with no unnecessary spend.',
  Value: 'The strongest quality-per-dirham balance.',
  Standard: 'Well-made pieces with more choice of style and finish.',
  Premium: 'Higher-grade materials and more considered design.',
  Luxury: 'Statement pieces and the best available craftsmanship.',
};

/* ------------------------------ ownership ------------------------------ */

interface Owner {
  readonly customerId: string | null;
  readonly guestSessionId: string | null;
}

function ownerOf(req: FastifyRequest): Owner {
  const a = requireBuyer(req);
  return { customerId: a.customerId, guestSessionId: a.guestSessionId };
}

/** Recommendation tables carry no RLS; ownership is enforced here, in every query that reaches a project. */
async function loadOwnedProject(trx: Tx, owner: Owner, projectId: string): Promise<ProjectRow> {
  const row = await trx
    .selectFrom('recommendation.project')
    .selectAll()
    .where('id', '=', projectId)
    .executeTakeFirst();
  const mine =
    row &&
    ((owner.customerId !== null && row.customer_id === owner.customerId) ||
      (owner.guestSessionId !== null && row.guest_session_id === owner.guestSessionId));
  // A project that exists but is someone else's is indistinguishable from one that does not exist.
  if (!row || !mine) throw notFound('Project');
  return row;
}

function toProject(row: ProjectRow): Project {
  const input = ProjectInputSchema.parse(row.spec);
  const s = summarise(input);
  return {
    id: row.id,
    input,
    sizeClass: s.sizeClass,
    budgetRange: s.range ? { lowFils: s.range[0], highFils: s.range[1] } : null,
    state: row.state as Project['state'],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const columnsOf = (input: z.infer<typeof ProjectInputSchema>) => {
  const s = summarise(input);
  return {
    path_id: input.pathId,
    spec: JSON.stringify(input),
    style_preference: input.style,
    colour_preference: input.colour,
    budget_tier: input.tier,
    project_budget_fils: 'totalBudgetFils' in input ? input.totalBudgetFils : null,
    size_class: s.sizeClass,
    state: 'Ready for Recommendation',
  };
};

/* ------------------------------ projects ------------------------------ */

export async function createProject(
  ctx: AppContext,
  req: FastifyRequest,
  input: z.infer<typeof ProjectInputSchema>,
): Promise<Project> {
  const owner = ownerOf(req);
  return runAs(ctx, req, async (trx) => {
    const row = await trx
      .insertInto('recommendation.project')
      .values({
        ...columnsOf(input),
        customer_id: owner.customerId,
        guest_session_id: owner.customerId ? null : owner.guestSessionId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      entityType: 'project',
      entityId: row.id,
      from: null,
      to: row.state,
      actor: req.actor!,
      data: { path: input.pathId },
    });
    return toProject(row);
  });
}

export async function updateProject(
  ctx: AppContext,
  req: FastifyRequest,
  projectId: string,
  input: z.infer<typeof ProjectInputSchema>,
): Promise<Project> {
  const owner = ownerOf(req);
  return runAs(ctx, req, async (trx) => {
    const existing = await loadOwnedProject(trx, owner, projectId);
    if (existing.path_id !== input.pathId)
      throw conflict(
        'path_change_not_allowed',
        'Start a new project to change what you are furnishing.',
      );
    const row = await trx
      .updateTable('recommendation.project')
      .set(columnsOf(input))
      .where('id', '=', projectId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toProject(row);
  });
}

export async function getProject(
  ctx: AppContext,
  req: FastifyRequest,
  projectId: string,
): Promise<Project> {
  const owner = ownerOf(req);
  return runAs(ctx, req, async (trx) => toProject(await loadOwnedProject(trx, owner, projectId)));
}

export async function listProjects(ctx: AppContext, req: FastifyRequest): Promise<Project[]> {
  const owner = ownerOf(req);
  return runAs(ctx, req, async (trx) => {
    let q = trx.selectFrom('recommendation.project').selectAll();
    q = owner.customerId
      ? q.where('customer_id', '=', owner.customerId)
      : q.where(
          'guest_session_id',
          '=',
          owner.guestSessionId ?? '00000000-0000-0000-0000-000000000000',
        );
    return (await q.orderBy('created_at', 'desc').limit(50).execute()).map(toProject);
  });
}

/** The five budget cards for the project's path: tier name, AED range and a one-line promise. */
export async function budgetCards(
  ctx: AppContext,
  req: FastifyRequest,
  projectId: string,
): Promise<BudgetCards> {
  const project = await getProject(ctx, req, projectId);
  const input = project.input;
  const cards = TIERS.map((tier) => {
    const s = summarise({ ...input, tier } as typeof input);
    return s.range
      ? { tier, lowFils: s.range[0], highFils: s.range[1], blurb: TIER_BLURB[tier] }
      : null;
  }).filter((c): c is NonNullable<typeof c> => c !== null);
  return { cards };
}

/* ------------------------------ running ------------------------------ */

const hashOf = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');

interface Persisted {
  readonly runId: string;
}

async function persistRun(
  trx: Tx,
  ctx: AppContext,
  args: {
    projectId: string;
    moduleId: string | null;
    result: RunResult;
    maps: Awaited<ReturnType<typeof requireApprovedMaps>>;
    inputHash: string;
    durationMs: number;
    actor: NonNullable<FastifyRequest['actor']>;
  },
): Promise<Persisted> {
  const { result, maps } = args;
  const run = await trx
    .insertInto('recommendation.recommendation_run')
    .values({
      project_id: args.projectId,
      project_module_id: args.moduleId,
      state: result.status,
      size_class: result.geometry.areaM2 > 0 ? result.geometry.sizeClass : null,
      budget_low_fils: result.range[0],
      budget_high_fils: result.range[1],
      catalogue_version: result.catalogueVersion,
      standards_version: result.standardsVersion,
      engine_version: result.engineVersion,
      style_map_id: maps.ids.style,
      colour_map_id: maps.ids.colour,
      material_map_id: maps.ids.material,
      input_hash: args.inputHash,
      failure_reason:
        result.status === 'Failed'
          ? (result.reason ?? 'No composition met the minimum standards.')
          : null,
      duration_ms: args.durationMs,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  // Every scored candidate, rejections included: this is what makes a result explainable.
  for (const batch of chunks(result.evaluated, 400)) {
    if (batch.length === 0) continue;
    await trx
      .insertInto('recommendation.candidate_score')
      .values(
        batch.map((c) => ({
          run_id: run.id,
          slot_key: c.slotKey,
          offer_id: c.offerId,
          product_id: c.productId,
          fit: c.fit,
          style: c.style,
          colour: c.colour,
          // The engine uses -1 for "rejected on this factor"; the table stores 0–100 plus the reason.
          budget: Math.max(0, c.budget),
          practical: Math.max(0, c.practical),
          availability: Math.max(0, c.avail),
          total: c.total,
          quality: c.quality,
          eligible: c.eligible,
          rejected_reason: c.eligible ? null : (c.rejectedFor ?? 'Not eligible'),
        })),
      )
      .execute();
  }

  for (const option of [...result.options, ...result.suppressed]) {
    const shown = result.options.includes(option);
    const b = option.valid ? option.breakdown : null;
    const comp = await trx
      .insertInto('recommendation.composition')
      .values({
        run_id: run.id,
        objective: OBJECTIVE_COLUMNS[option.key],
        score: option.valid ? option.score : (option.score ?? null),
        product_match_quality: b ? round2(b.productMatchQuality) : null,
        harmony_style: b ? round2(b.harmony.style) : null,
        harmony_colour: b ? round2(b.harmony.colour) : null,
        harmony_material: b ? round2(b.harmony.material) : null,
        functional_completeness: b ? round2(b.completeness) : null,
        budget_performance: b ? round2(b.budgetPerformance) : null,
        total_price_fils: option.total,
        state: shown && option.valid ? 'Valid' : 'Rejected',
        modified_by_customer: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (!shown) continue;
    await trx
      .insertInto('recommendation.composition_item')
      .values(
        option.items.map((i) => ({
          composition_id: comp.id,
          slot_key: i.slot.key,
          role: i.slot.role,
          essential: i.slot.essential === true,
          quantity: i.qty,
          product_id: i.product.id,
          offer_id: i.offer.id,
          unit_price_fils: i.offer.sellingPrice,
        })),
      )
      .execute();
    await trx
      .insertInto('recommendation.visualization')
      .values({
        composition_id: comp.id,
        fidelity: 'Concept',
        state: 'Current',
        hotspots: JSON.stringify(hotspotsOf(option)),
      })
      .execute();
  }
  await recordAudit(trx, {
    entityType: 'recommendation_run',
    entityId: run.id,
    from: null,
    to: result.status,
    actor: args.actor,
    data: { projectId: args.projectId, catalogueVersion: result.catalogueVersion },
  });
  return { runId: run.id };
}

const hotspotsOf = (o: Option) =>
  Object.fromEntries(
    o.items.map((i) => [i.slot.key, { productId: i.product.id, offerId: i.offer.id }]),
  );
const round2 = (n: number) => Math.round(n * 100) / 100;
function* chunks<T>(xs: readonly T[], n: number): Generator<T[]> {
  for (let i = 0; i < xs.length; i += n) yield xs.slice(i, i + n) as T[];
}

/**
 * WF-02. Loads the eligible catalogue slice, runs the pure engine, persists the run with every
 * candidate score and the (up to four) compositions, and returns them rendered against live data.
 */
export async function recommend(
  ctx: AppContext,
  req: FastifyRequest,
  projectId: string,
): Promise<RecommendationResponse> {
  const owner = ownerOf(req);
  const actor = req.actor!;
  return runAs(ctx, req, async (trx) => {
    const row = await loadOwnedProject(trx, owner, projectId);
    const project = toProject(row);
    const input = project.input;
    if (input.pathId === 'individualProduct') {
      throw conflict(
        'use_ranking',
        'Individual products are ranked, not composed. Use the ranking endpoint.',
      );
    }
    const maps = await requireApprovedMaps(trx);
    const snapshot = await loadSnapshot(trx, typesNeeded(input));
    const started = performance.now();
    const runs: { persisted: Persisted; moduleId: string | null; moduleLabel: string | null }[] =
      [];
    let projectSummary: RecommendationResponse['project'] = null;

    if (isRoomInput(input)) {
      const result = runRecommendation(toRoomProject(input), snapshot);
      const inputHash = hashOf({
        input,
        catalogue: snapshot.version,
        engine: ENGINE_VERSION,
        standards: STANDARDS_VERSION,
        maps: maps.version,
      });
      const persisted = await persistRun(trx, ctx, {
        projectId,
        moduleId: null,
        result,
        maps,
        inputHash,
        durationMs: Math.round(performance.now() - started),
        actor,
      });
      runs.push({ persisted, moduleId: null, moduleLabel: null });
    } else if (isMultiRoomInput(input)) {
      const multi = toMultiRoomProject(input);
      const res = runProject(multi, snapshot);
      for (const m of res.modules) {
        const mod = await trx
          .insertInto('recommendation.project_module')
          .values({
            project_id: projectId,
            room_path: m.path,
            label: m.label,
            area_m2: round2(m.areaM2),
            floor: m.floor ?? null,
            bed_size: m.bedSize ?? null,
            capacity: m.capacity ?? null,
            users_count: m.users ?? null,
            allocated_budget_fils: m.share,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const inputHash = hashOf({
          input,
          module: m.label,
          catalogue: snapshot.version,
          engine: ENGINE_VERSION,
          standards: STANDARDS_VERSION,
          maps: maps.version,
        });
        const persisted = await persistRun(trx, ctx, {
          projectId,
          moduleId: mod.id,
          result: m.run,
          maps,
          inputHash,
          durationMs: Math.round(performance.now() - started),
          actor,
        });
        runs.push({ persisted, moduleId: mod.id, moduleLabel: m.label });
      }
      projectSummary = {
        totalBudgetFils: multi.totalBudget,
        bestOverallTotalFils: res.total,
        constraint: res.constraint,
      };
    }

    const dtos: Run[] = [];
    for (const r of runs)
      dtos.push(await runDto(trx, ctx, owner, r.persisted.runId, r.moduleLabel, snapshot));
    return { runs: dtos, project: projectSummary };
  });
}

async function runDto(
  trx: Tx,
  ctx: AppContext,
  owner: Owner,
  runId: string,
  moduleLabel: string | null,
  snapshot: SnapshotCatalogue,
): Promise<Run> {
  const run = await trx
    .selectFrom('recommendation.recommendation_run')
    .selectAll()
    .where('id', '=', runId)
    .executeTakeFirstOrThrow();
  const project = await loadOwnedProject(trx, owner, run.project_id);
  const mod = run.project_module_id
    ? ((await trx
        .selectFrom('recommendation.project_module')
        .selectAll()
        .where('id', '=', run.project_module_id)
        .executeTakeFirst()) ?? null)
    : null;
  const comps = await trx
    .selectFrom('recommendation.composition')
    .selectAll()
    .where('run_id', '=', runId)
    .where('state', '=', 'Valid')
    .execute();
  const order = ['best_overall', 'best_value', 'best_style', 'premium'];
  comps.sort((a, b) => order.indexOf(a.objective) - order.indexOf(b.objective));
  const compositions: Composition[] = [];
  for (const c of comps)
    compositions.push(await buildCompositionDto(trx, ctx, project, run, mod, c.id, snapshot));
  return {
    id: run.id,
    projectId: run.project_id,
    moduleId: run.project_module_id,
    moduleLabel: moduleLabel ?? mod?.label ?? null,
    status: run.state as Run['status'],
    reason: run.failure_reason,
    sizeClass: run.size_class,
    range:
      run.budget_low_fils === null || run.budget_high_fils === null
        ? null
        : { lowFils: Number(run.budget_low_fils), highFils: Number(run.budget_high_fils) },
    compositions,
    createdAt: new Date(run.created_at).toISOString(),
  };
}

async function buildCompositionDto(
  trx: Tx,
  ctx: AppContext,
  project: ProjectRow,
  run: RunRow,
  mod: Selectable<DB['recommendation.project_module']> | null,
  compositionId: string,
  snapshot: SnapshotCatalogue,
): Promise<Composition> {
  const composition = await trx
    .selectFrom('recommendation.composition')
    .selectAll()
    .where('id', '=', compositionId)
    .executeTakeFirstOrThrow();
  const items = await trx
    .selectFrom('recommendation.composition_item')
    .selectAll()
    .where('composition_id', '=', compositionId)
    .execute();
  const visualization = await trx
    .selectFrom('recommendation.visualization')
    .selectAll()
    .where('composition_id', '=', compositionId)
    .executeTakeFirst();
  const input = ProjectInputSchema.parse(project.spec);
  const rehydrated = rehydrate(roomProjectFor(input, mod, run), run, composition, items, snapshot);
  const cards: Cards = {
    products: await loadProductSummaries(
      trx,
      items.map((i) => i.product_id),
      ctx.config.MEDIA_BASE_URL,
    ),
    offers: await loadOfferSummaries(
      trx,
      items.map((i) => i.offer_id),
    ),
  };
  return compositionDto({ composition, items, visualization, rehydrated, cards });
}

/* ------------------------------ compositions ------------------------------ */

interface EditContext {
  readonly project: ProjectRow;
  readonly run: RunRow;
  readonly mod: Selectable<DB['recommendation.project_module']> | null;
  readonly snapshot: SnapshotCatalogue;
}

/** Load a composition the caller owns, and the live catalogue slice it needs. */
async function loadOwnedComposition(
  trx: Tx,
  owner: Owner,
  compositionId: string,
): Promise<
  EditContext & {
    composition: Selectable<DB['recommendation.composition']>;
    items: Selectable<DB['recommendation.composition_item']>[];
  }
> {
  const composition = await trx
    .selectFrom('recommendation.composition')
    .selectAll()
    .where('id', '=', compositionId)
    .executeTakeFirst();
  if (!composition) throw notFound('Composition');
  const run = await trx
    .selectFrom('recommendation.recommendation_run')
    .selectAll()
    .where('id', '=', composition.run_id)
    .executeTakeFirstOrThrow();
  const project = await loadOwnedProject(trx, owner, run.project_id);
  const mod = run.project_module_id
    ? ((await trx
        .selectFrom('recommendation.project_module')
        .selectAll()
        .where('id', '=', run.project_module_id)
        .executeTakeFirst()) ?? null)
    : null;
  const items = await trx
    .selectFrom('recommendation.composition_item')
    .selectAll()
    .where('composition_id', '=', compositionId)
    .execute();
  const types = await typesOfProducts(
    trx,
    items.map((i) => i.product_id),
  );
  const snapshot = await loadSnapshot(trx, types);
  return { composition, run, project, mod, items, snapshot };
}

async function typesOfProducts(trx: Tx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await trx
    .selectFrom('catalogue.product')
    .select('product_type')
    .where('id', 'in', [...new Set(ids)])
    .execute();
  return [...new Set(rows.map((r) => r.product_type))];
}

export async function getComposition(
  ctx: AppContext,
  req: FastifyRequest,
  compositionId: string,
): Promise<Composition> {
  const owner = ownerOf(req);
  return runAs(ctx, req, async (trx) => {
    const c = await loadOwnedComposition(trx, owner, compositionId);
    return buildCompositionDto(trx, ctx, c.project, c.run, c.mod, compositionId, c.snapshot);
  });
}

function assertEditable(rehydrated: ReturnType<typeof rehydrate>) {
  if (rehydrated.stale.size > 0) {
    throw conflict(
      'composition_stale',
      'Prices or availability changed since this was created. Refresh your recommendations to continue.',
    );
  }
}

export async function alternatives(
  ctx: AppContext,
  req: FastifyRequest,
  compositionId: string,
  slotKey: string,
) {
  const owner = ownerOf(req);
  return runAs(ctx, req, async (trx) => {
    const c = await loadOwnedComposition(trx, owner, compositionId);
    const input = ProjectInputSchema.parse(c.project.spec);
    const rh = rehydrate(
      roomProjectFor(input, c.mod, c.run),
      c.run,
      c.composition,
      c.items,
      c.snapshot,
    );
    if (!c.items.some((i) => i.slot_key === slotKey)) throw notFound('Item');
    const current = rh.option.items.find((i) => i.slot.key === slotKey);
    const found = alternativesFor(rh.project, rh.option, slotKey, c.snapshot);
    const cards: Cards = {
      products: await loadProductSummaries(
        trx,
        found.map((f) => f.product.id),
        ctx.config.MEDIA_BASE_URL,
      ),
      offers: await loadOfferSummaries(
        trx,
        found.map((f) => f.offer.id),
      ),
    };
    const alternatives = found.flatMap((f) => {
      const product = cards.products.get(f.product.id);
      const offer = cards.offers.get(f.offer.id);
      if (!product || !offer) return [];
      const { score, classification, fit } = toMatch(f);
      return [
        {
          match: { score, classification, fit },
          product,
          offer,
          priceDelta: f.offer.sellingPrice - (current?.offer.sellingPrice ?? f.offer.sellingPrice),
        },
      ];
    });
    return { alternatives };
  });
}

/** Persist an edited option back onto its composition rows. */
async function saveOption(trx: Tx, compositionId: string, option: Option): Promise<void> {
  const b = option.valid ? option.breakdown : null;
  await trx
    .updateTable('recommendation.composition')
    .set({
      score: option.valid ? option.score : (option.score ?? null),
      total_price_fils: option.total,
      modified_by_customer: true,
      ...(b
        ? {
            product_match_quality: round2(b.productMatchQuality),
            harmony_style: round2(b.harmony.style),
            harmony_colour: round2(b.harmony.colour),
            harmony_material: round2(b.harmony.material),
            functional_completeness: round2(b.completeness),
            budget_performance: round2(b.budgetPerformance),
          }
        : {}),
    })
    .where('id', '=', compositionId)
    .execute();
  await trx
    .deleteFrom('recommendation.composition_item')
    .where('composition_id', '=', compositionId)
    .execute();
  if (option.items.length > 0) {
    await trx
      .insertInto('recommendation.composition_item')
      .values(
        option.items.map((i) => ({
          composition_id: compositionId,
          slot_key: i.slot.key,
          role: i.slot.role,
          essential: i.slot.essential === true,
          quantity: i.qty,
          product_id: i.product.id,
          offer_id: i.offer.id,
          unit_price_fils: i.offer.sellingPrice,
        })),
      )
      .execute();
  }
  await trx
    .updateTable('recommendation.visualization')
    .set({ hotspots: JSON.stringify(hotspotsOf(option)), state: 'Current' })
    .where('composition_id', '=', compositionId)
    .execute();
}

export async function replaceItem(
  ctx: AppContext,
  req: FastifyRequest,
  compositionId: string,
  slotKey: string,
  offerId: string,
): Promise<Composition> {
  const owner = ownerOf(req);
  return runAs(ctx, req, async (trx) => {
    const c = await loadOwnedComposition(trx, owner, compositionId);
    const input = ProjectInputSchema.parse(c.project.spec);
    const rh = rehydrate(
      roomProjectFor(input, c.mod, c.run),
      c.run,
      c.composition,
      c.items,
      c.snapshot,
    );
    assertEditable(rh);
    if (!c.items.some((i) => i.slot_key === slotKey)) throw notFound('Item');
    // The replacement is re-scored against the live catalogue; the client cannot assert its own score.
    const candidate = alternativesFor(rh.project, rh.option, slotKey, c.snapshot).find(
      (a) => a.offer.id === offerId,
    );
    if (!candidate)
      throw conflict(
        'replacement_not_available',
        'That product is not an eligible replacement for this item.',
      );
    const result = applyReplacement(
      { range: [fils(Number(c.run.budget_low_fils)), fils(Number(c.run.budget_high_fils))] },
      rh.option,
      slotKey,
      candidate,
    );
    if (!result.ok) throw result.error;
    await saveOption(trx, compositionId, result.value);
    await recordAudit(trx, {
      entityType: 'composition',
      entityId: compositionId,
      from: 'Valid',
      to: 'Valid',
      actor: req.actor!,
      reason: 'replace',
      data: { slotKey, offerId },
    });
    return buildCompositionDto(trx, ctx, c.project, c.run, c.mod, compositionId, c.snapshot);
  });
}

export async function removeSlot(
  ctx: AppContext,
  req: FastifyRequest,
  compositionId: string,
  slotKey: string,
): Promise<Composition> {
  const owner = ownerOf(req);
  return runAs(ctx, req, async (trx) => {
    const c = await loadOwnedComposition(trx, owner, compositionId);
    const input = ProjectInputSchema.parse(c.project.spec);
    const rh = rehydrate(
      roomProjectFor(input, c.mod, c.run),
      c.run,
      c.composition,
      c.items,
      c.snapshot,
    );
    assertEditable(rh);
    if (!c.items.some((i) => i.slot_key === slotKey)) throw notFound('Item');
    const result = removeItem(
      { range: [fils(Number(c.run.budget_low_fils)), fils(Number(c.run.budget_high_fils))] },
      rh.option,
      slotKey,
    );
    if (!result.ok) throw result.error;
    await saveOption(trx, compositionId, result.value);
    await recordAudit(trx, {
      entityType: 'composition',
      entityId: compositionId,
      from: 'Valid',
      to: 'Valid',
      actor: req.actor!,
      reason: 'remove',
      data: { slotKey },
    });
    return buildCompositionDto(trx, ctx, c.project, c.run, c.mod, compositionId, c.snapshot);
  });
}

/* ------------------------------ individual product ------------------------------ */

export async function rank(
  ctx: AppContext,
  req: FastifyRequest,
  projectId: string,
): Promise<Ranking> {
  const owner = ownerOf(req);
  return runAs(ctx, req, async (trx) => {
    const project = toProject(await loadOwnedProject(trx, owner, projectId));
    const input = project.input;
    if (input.pathId !== 'individualProduct')
      throw conflict('use_recommend', 'This project is composed, not ranked.');
    await requireApprovedMaps(trx);
    const snapshot = await loadSnapshot(trx, [input.productType]);
    const ranked = rankIndividual(
      {
        type: input.productType,
        branch: input.branch,
        style: input.style,
        colour: input.colour,
        tier: input.tier,
      },
      snapshot,
    );
    const top = ranked.results.slice(0, 30);
    const cards: Cards = {
      products: await loadProductSummaries(
        trx,
        top.map((r) => r.product.id),
        ctx.config.MEDIA_BASE_URL,
      ),
      offers: await loadOfferSummaries(
        trx,
        top.map((r) => r.offer.id),
      ),
    };
    return {
      tier: input.tier,
      priceRange: ranked.range ? { lowFils: ranked.range[0], highFils: ranked.range[1] } : null,
      results: top.flatMap((r) => {
        const product = cards.products.get(r.product.id);
        const offer = cards.offers.get(r.offer.id);
        return product && offer ? [{ match: toMatch(r), product, offer }] : [];
      }),
    };
  });
}
