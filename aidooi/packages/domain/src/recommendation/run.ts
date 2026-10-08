import type { Catalogue } from '../catalogue/types.ts';
import { fils, sum, type Fils } from '../kernel/money.ts';
import { COMPAT_MAP_VERSION } from '../standards/compatibility.ts';
import {
  ENGINE_VERSION,
  PREMIUM_MIN_SCORE_GAIN,
  PREMIUM_MIN_TOTAL_GAIN,
  PREMIUM_STRETCH,
  STANDARDS_VERSION,
  WALL_FROM_AREA_FACTOR_CM,
} from '../standards/constants.ts';
import { priceRange } from '../standards/price-matrix.ts';
import {
  apartmentBudget,
  apartmentModules,
  roomBudget,
  sizeClass,
  studioBudget,
  studioModules,
  villaBudget,
  villaModules,
  type ApartmentSpec,
  type ProjectModule,
  type StudioSpec,
  type VillaSpec,
} from '../standards/rooms.ts';
import type { ColourPreference, StylePreference, Tier } from '../standards/vocab.ts';
import { buildOption } from './options.ts';
import { buildPools, buildSlots, slotCandidates, toFils } from './pools.ts';
import type { ScoringContext } from './scoring.ts';
import type {
  EvaluatedCandidate,
  ObjectiveKey,
  Option,
  RoomGeometry,
  RoomProject,
  RunResult,
  ScoredCandidate,
  Slot,
} from './types.ts';

const OBJECTIVE_ORDER: readonly ObjectiveKey[] = [
  'bestOverall',
  'bestValue',
  'bestStyle',
  'premium',
];

export function geometryOf(project: RoomProject): RoomGeometry | null {
  const { lengthM, widthM, areaM2 } = project.spec;
  const area = areaM2 ?? (lengthM ?? 0) * (widthM ?? 0);
  if (!Number.isFinite(area) || area <= 0) return null;
  // When only an area is known the longest wall is approximated (gap #6).
  const longestWallCm =
    Math.max(lengthM ?? 0, widthM ?? 0) * 100 || Math.sqrt(area) * WALL_FROM_AREA_FACTOR_CM;
  return { areaM2: area, sizeClass: sizeClass(project.path, area), longestWallCm };
}

const evaluate = (pools: ReadonlyMap<string, readonly ScoredCandidate[]>): EvaluatedCandidate[] =>
  [...pools].flatMap(([slotKey, cands]) =>
    cands.map((c) => ({
      slotKey,
      productId: c.product.id,
      offerId: c.offer.id,
      fit: c.fit,
      style: c.style,
      colour: c.colour,
      budget: c.budget,
      practical: c.practical,
      avail: c.avail,
      total: c.total,
      quality: c.quality,
      eligible: c.eligible,
      rejectedFor: c.rejectedFor,
    })),
  );

const failed = (
  catalogue: Catalogue,
  reason: string,
  extra: Partial<RunResult> = {},
): RunResult => ({
  status: 'Failed',
  engineVersion: ENGINE_VERSION,
  standardsVersion: STANDARDS_VERSION,
  compatMapVersion: COMPAT_MAP_VERSION,
  catalogueVersion: catalogue.version,
  geometry: extra.geometry ?? { areaM2: 0, sizeClass: 'Compact', longestWallCm: 0 },
  range: extra.range ?? [fils(0), fils(0)],
  ceiling: extra.ceiling ?? fils(0),
  slots: extra.slots ?? [],
  evaluated: extra.evaluated ?? [],
  options: [],
  suppressed: [],
  reason,
});

/**
 * WF-02 — generate up to four differentiated compositions for one room.
 * Pure: the same project, catalogue version and standards version always give the same result.
 */
export function runRecommendation(project: RoomProject, catalogue: Catalogue): RunResult {
  const geometry = geometryOf(project);
  if (!geometry) return failed(catalogue, 'Room dimensions are required to fit furniture.');

  const range =
    project.budgetOverride ?? roomBudget(project.path, geometry.sizeClass, project.tier);
  const ceilingBase = range[1];
  const ceilingPremium = toFils(ceilingBase * (1 + PREMIUM_STRETCH));
  const ctx: ScoringContext = {
    style: project.style,
    colour: project.colour,
    spec: project.spec,
    room: geometry,
  };

  // Pools are allocation-sensitive: Budget/Value compares each offer with its own slot allocation,
  // so Premium needs its own pass at the stretched ceiling (AID-LOG-010 §7).
  const base = buildSlots(
    project.path,
    geometry.sizeClass,
    project.spec,
    ceilingBase,
    project.tier,
  );
  const basePools = buildPools(base, ctx, catalogue);
  const stretched = buildSlots(
    project.path,
    geometry.sizeClass,
    project.spec,
    ceilingPremium,
    project.tier,
  );
  const stretchedPools = buildPools(stretched, ctx, catalogue);

  // An essential slot with no eligible candidate is reported, never silently dropped (AID-LOG-002 §12).
  const blocked = base.filter(
    (s) => s.essential && !(basePools.get(s.key) ?? []).some((c) => c.eligible),
  );
  if (blocked.length) {
    return failed(
      catalogue,
      `No eligible product for essential ${blocked.map((s) => s.type).join(', ')} within this budget and fit envelope.`,
      { geometry, range, ceiling: ceilingBase, slots: base, evaluated: evaluate(basePools) },
    );
  }

  const built: Option[] = [];
  const usedAnchorParents = new Set<string>();
  for (const key of OBJECTIVE_ORDER) {
    const premium = key === 'premium';
    const option = buildOption({
      key,
      slots: premium ? stretched : base,
      pools: premium ? stretchedPools : basePools,
      range,
      ceiling: premium ? ceilingPremium : ceilingBase,
      avoidAnchorParents: key === 'bestOverall' ? undefined : usedAnchorParents,
      preferParents: project.preferParents,
    });
    if (option.valid) {
      const anchor = option.items.find((i) => i.slot.role === 'anchor');
      if (anchor) usedAnchorParents.add(anchor.product.parentId);
    }
    built.push(option);
  }

  // §7 — if Premium brings no meaningful improvement, do not manufacture it.
  const overall = built.find((o) => o.key === 'bestOverall');
  const withPremiumGate = built.map((o): Option => {
    if (o.key !== 'premium' || !o.valid || !overall?.valid) return o;
    const meaningful =
      o.score > overall.score + PREMIUM_MIN_SCORE_GAIN ||
      o.total > overall.total * (1 + PREMIUM_MIN_TOTAL_GAIN);
    return meaningful ? o : { ...o, suppressed: 'No meaningful premium upgrade available' };
  });

  const shown = withPremiumGate.filter((o) => o.valid && !o.suppressed);
  return {
    status: shown.length === 0 ? 'Failed' : shown.length < 4 ? 'Limited Inventory' : 'Completed',
    engineVersion: ENGINE_VERSION,
    standardsVersion: STANDARDS_VERSION,
    compatMapVersion: COMPAT_MAP_VERSION,
    catalogueVersion: catalogue.version,
    geometry,
    range,
    ceiling: ceilingBase,
    slots: base,
    evaluated: evaluate(basePools),
    options: shown,
    suppressed: withPremiumGate.filter((o) => !o.valid || o.suppressed),
    ...(shown.length === 0
      ? { reason: 'No complete composition met the minimum standards for this space and budget.' }
      : {}),
  };
}

/* ---------------- Multi-module projects (AID-LOG-006/007/008) ---------------- */

export interface ProjectInput {
  /** Whether bedrooms after the master should look related (gap #12). A recommendation modifier only. */
  readonly bedroomConsistency?: boolean;
  readonly tier: Tier;
  readonly style: StylePreference;
  readonly colour: ColourPreference;
  readonly totalBudget: Fils;
}
export type MultiRoomProject =
  | (ProjectInput & { readonly kind: 'apartment'; readonly spec: ApartmentSpec })
  | (ProjectInput & { readonly kind: 'villa'; readonly spec: VillaSpec })
  | (ProjectInput & { readonly kind: 'studio'; readonly spec: StudioSpec });

export interface ModuleRun extends ProjectModule {
  readonly share: Fils;
  readonly run: RunResult;
}
export interface ProjectRun {
  readonly status: RunResult['status'];
  readonly projectCeiling: Fils;
  /** Reference target range for the project at the chosen tier (LOG-006/007; summed modules for villa). */
  readonly targetRange: readonly [Fils, Fils];
  readonly modules: readonly ModuleRun[];
  readonly total: Fils;
  readonly constraint: string | null;
}

export function modulesOf(project: MultiRoomProject): ProjectModule[] {
  switch (project.kind) {
    case 'apartment':
      return apartmentModules(project.spec);
    case 'villa':
      return villaModules(project.spec);
    case 'studio':
      return studioModules(project.spec);
  }
}

export function projectTargetRange(project: MultiRoomProject): readonly [Fils, Fils] {
  switch (project.kind) {
    case 'apartment':
      return apartmentBudget(project.spec, project.tier);
    case 'villa':
      return villaBudget(project.spec, project.tier);
    case 'studio':
      return studioBudget(project.spec, project.tier);
  }
}

/**
 * Each module is budgeted from its relative cost weight — its own tier midpoint — against the
 * project total (AID-LOG-007 §4: dynamic allocation, never fixed room percentages).
 */
export function runProject(project: MultiRoomProject, catalogue: Catalogue): ProjectRun {
  const mods = modulesOf(project);
  const weighted = mods.map((m) => {
    const [lo, hi] = roomBudget(m.path, sizeClass(m.path, m.areaM2), project.tier);
    return { m, mid: (lo + hi) / 2 };
  });
  const weightSum = weighted.reduce((t, w) => t + w.mid, 0) || 1;

  // Bedroom consistency: the first bedroom after the master sets the reference; later ones lean toward
  // the same product families. They are solved in order so the reference exists when it is needed.
  let reference: ReadonlyMap<string, string> | undefined;
  const isGuestBedroom = (m: ProjectModule) =>
    m.path === 'bedroom' && m.label !== 'Master Bedroom' && m.label !== 'Sleeping Zone';

  const modules: ModuleRun[] = weighted.map(({ m, mid }) => {
    const share = toFils((mid / weightSum) * project.totalBudget);
    const length = Math.sqrt(m.areaM2 * 1.35);
    const width = Math.sqrt(m.areaM2 / 1.35);
    const lean = project.bedroomConsistency === true && isGuestBedroom(m) ? reference : undefined;
    const run = runRecommendation(
      {
        path: m.path,
        tier: project.tier,
        style: project.style,
        colour: project.colour,
        // The allocated share is this module's budget, not the generic room tier table.
        budgetOverride: [toFils(share * 0.72), share],
        spec: {
          areaM2: m.areaM2,
          lengthM: length,
          widthM: width,
          ...(m.bedSize ? { bedSize: m.bedSize } : {}),
          ...(m.capacity ? { capacity: m.capacity } : {}),
          ...(m.users ? { users: m.users } : {}),
        },
        ...(lean ? { preferParents: lean } : {}),
      },
      catalogue,
    );
    if (project.bedroomConsistency === true && isGuestBedroom(m) && !reference) {
      const best = run.options[0];
      if (best) reference = new Map(best.items.map((i) => [i.product.type, i.product.parentId]));
    }
    return { ...m, share, run };
  });

  const total = sum(modules.map((m) => m.run.options[0]?.total ?? fils(0)));
  const solved = modules.filter((m) => m.run.options.length > 0).length;
  return {
    status: solved === modules.length ? 'Completed' : solved === 0 ? 'Failed' : 'Limited Inventory',
    projectCeiling: project.totalBudget,
    targetRange: projectTargetRange(project),
    modules,
    total,
    constraint:
      total > project.totalBudget
        ? 'Budget Constraint: the selected total budget cannot cover every essential room requirement at this tier.'
        : null,
  };
}

/* ---------------- AID-SPC-009 — Individual Product path ---------------- */

export interface IndividualQuery {
  readonly type: string;
  readonly branch: string | null;
  readonly style: StylePreference;
  readonly colour: ColourPreference;
  readonly tier: Tier;
}

export function rankIndividual(
  q: IndividualQuery,
  catalogue: Catalogue,
): {
  range: readonly [Fils, Fils] | null;
  slot: Slot;
  results: ScoredCandidate[];
  rejected: ScoredCandidate[];
} {
  const range = priceRange(q.type, q.branch, q.tier);
  const target = range ? (range[0] + range[1]) / 2 : 0;
  const slot: Slot = {
    type: q.type,
    branch: q.branch,
    qty: 1,
    w: null,
    role: 'anchor',
    key: `${q.type}#0`,
    allocatedTotalFils: target,
    allocatedFils: target,
  };
  const ctx: ScoringContext = {
    style: q.style,
    colour: q.colour,
    spec: {
      ...(q.branch && /^\d+$/.test(q.branch) ? { capacity: Number(q.branch) } : {}),
      ...(q.branch && !/^\d+$/.test(q.branch) ? { bedSize: q.branch } : {}),
    },
    room: null,
  };
  // Within ±10% of the tier range, so a tier choice means what it says.
  const pool = slotCandidates(slot, ctx, catalogue).filter(
    (c) =>
      !range || (c.offer.sellingPrice >= range[0] * 0.9 && c.offer.sellingPrice <= range[1] * 1.1),
  );
  return {
    range,
    slot,
    results: pool.filter((c) => c.eligible),
    rejected: pool.filter((c) => !c.eligible),
  };
}
