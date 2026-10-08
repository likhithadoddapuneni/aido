import type { Selectable } from 'kysely';
import type { DB } from '@aidooi/db';
import {
  OBJECTIVES,
  PREMIUM_STRETCH,
  RuleViolation,
  buildSlots,
  fils,
  geometryOf,
  scoreComposition,
  scoreProduct,
  toFils,
  type Item,
  type ObjectiveKey,
  type Option,
  type RoomProject,
  type ScoringContext,
  type SnapshotCatalogue,
} from '@aidooi/domain';
import type { ProjectInput } from '@aidooi/contracts';
import { isRoomInput, toRoomProject, type RoomInput } from './project-mapping.ts';

type RunRow = Selectable<DB['recommendation.recommendation_run']>;
type ModuleRow = Selectable<DB['recommendation.project_module']>;
type CompositionRow = Selectable<DB['recommendation.composition']>;
type ItemRow = Selectable<DB['recommendation.composition_item']>;

const OBJECTIVE_KEYS: Readonly<Record<string, ObjectiveKey>> = {
  best_overall: 'bestOverall',
  best_value: 'bestValue',
  best_style: 'bestStyle',
  premium: 'premium',
};
export function objectiveKey(column: string): ObjectiveKey {
  const k = OBJECTIVE_KEYS[column];
  if (!k) throw new Error(`Unknown composition objective ${column}`);
  return k;
}
export const OBJECTIVE_COLUMNS: Record<ObjectiveKey, string> = {
  bestOverall: 'best_overall',
  bestValue: 'best_value',
  bestStyle: 'best_style',
  premium: 'premium',
};

/**
 * The room a run was generated for. A module of a larger project is a room whose budget is its
 * allocated share, which the run recorded; its dimensions follow the same proportions runProject used.
 */
export function roomProjectFor(
  input: ProjectInput,
  mod: ModuleRow | null,
  run: RunRow,
): RoomProject {
  if (!mod) {
    if (!isRoomInput(input))
      throw new RuleViolation(
        'not_a_room_project',
        'This project has no single room to recommend for.',
      );
    return toRoomProject(input as RoomInput);
  }
  if (input.pathId === 'individualProduct')
    throw new RuleViolation(
      'not_a_room_project',
      'This project has no single room to recommend for.',
    );
  const area = Number(mod.area_m2);
  const path = mod.room_path as RoomProject['path'];
  return {
    path,
    tier: input.tier,
    style: input.style,
    colour: input.colour,
    budgetOverride: [fils(Number(run.budget_low_fils)), fils(Number(run.budget_high_fils))],
    spec: {
      areaM2: area,
      lengthM: Math.sqrt(area * 1.35),
      widthM: Math.sqrt(area / 1.35),
      ...(mod.bed_size ? { bedSize: mod.bed_size } : {}),
      ...(mod.capacity ? { capacity: mod.capacity } : {}),
      ...(mod.users_count ? { users: mod.users_count } : {}),
    },
  };
}

export interface Rehydrated {
  readonly project: RoomProject;
  readonly ctx: ScoringContext;
  readonly option: Option;
  /** Items whose offer is gone from the live catalogue, or whose price moved since the run. */
  readonly stale: ReadonlyMap<string, 'price_changed' | 'unavailable' | 'below_standard'>;
}

/**
 * Rebuild the engine's view of a stored composition against the **current** catalogue: slots are
 * re-derived deterministically from the project, items re-scored. Anything that changed since the run
 * is reported as stale, and a stale composition may be viewed but not edited.
 */
export function rehydrate(
  project: RoomProject,
  run: RunRow,
  composition: CompositionRow,
  itemRows: readonly ItemRow[],
  snapshot: SnapshotCatalogue,
): Rehydrated {
  const geometry = geometryOf(project);
  if (!geometry)
    throw new RuleViolation('invalid_project', 'The stored project has no usable dimensions.');
  const key = objectiveKey(composition.objective);
  const base = fils(Number(run.budget_high_fils));
  const ceiling = key === 'premium' ? toFils(base * (1 + PREMIUM_STRETCH)) : base;
  const range = [fils(Number(run.budget_low_fils)), base] as const;
  const slots = buildSlots(project.path, geometry.sizeClass, project.spec, ceiling, project.tier);
  const ctx: ScoringContext = {
    style: project.style,
    colour: project.colour,
    spec: project.spec,
    room: geometry,
  };

  const stale = new Map<string, 'price_changed' | 'unavailable' | 'below_standard'>();
  const items: Item[] = [];
  for (const row of itemRows) {
    const slot = slots.find((s) => s.key === row.slot_key);
    const product = snapshot.productById(row.product_id);
    const offer = snapshot.offerById(row.offer_id);
    if (!slot || !product || !offer) {
      stale.set(row.slot_key, 'unavailable');
      continue;
    }
    const scored = scoreProduct(product, offer, slot, ctx);
    if (!scored.eligible) stale.set(row.slot_key, 'below_standard');
    else if (Number(row.unit_price_fils) !== offer.sellingPrice)
      stale.set(row.slot_key, 'price_changed');
    items.push({ ...scored, slot, qty: row.quantity });
  }

  const option: Option = {
    key,
    label: OBJECTIVES[key].label,
    blurb: OBJECTIVES[key].blurb,
    items,
    droppedSlots: slots
      .filter((s) => !itemRows.some((r) => r.slot_key === s.key))
      .map((s) => s.key),
    ceiling,
    slots,
    modified: composition.modified_by_customer,
    ...scoreComposition(items, slots, range, ceiling),
  };
  return { project, ctx, option, stale };
}
