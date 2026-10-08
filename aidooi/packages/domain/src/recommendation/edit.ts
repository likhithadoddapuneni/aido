import type { Catalogue } from '../catalogue/types.ts';
import { err, ok, type Result, RuleViolation } from '../kernel/errors.ts';
import { MIN_COMPOSITION, MIN_FIT, MIN_PRODUCT_MATCH } from '../standards/constants.ts';
import { scoreComposition } from './composition.ts';
import { slotCandidates } from './pools.ts';
import type { ScoringContext } from './scoring.ts';
import type { Item, Option, RoomProject, RunResult, ScoredCandidate } from './types.ts';
import { geometryOf } from './run.ts';

const MAX_ALTERNATIVES = 24;

function contextOf(project: RoomProject): ScoringContext {
  return {
    style: project.style,
    colour: project.colour,
    spec: project.spec,
    room: geometryOf(project),
  };
}

/**
 * WF-03 — replacement candidates for one slot, re-scored against the *current* catalogue so a
 * product that sold out or changed price since the run is never offered.
 */
export function alternativesFor(
  project: RoomProject,
  option: Option,
  slotKey: string,
  catalogue: Catalogue,
): ScoredCandidate[] {
  const current = option.items.find((i) => i.slot.key === slotKey);
  const slot = current?.slot ?? option.slots.find((s) => s.key === slotKey);
  if (!slot) return [];
  return slotCandidates(slot, contextOf(project), catalogue)
    .filter((c) => c.eligible && c.offer.id !== current?.offer.id)
    .slice(0, MAX_ALTERNATIVES);
}

/**
 * Apply a replacement with full revalidation: the new product must itself meet the minimum
 * match and fit, and the revised composition must still be a valid composition.
 */
export function applyReplacement(
  run: Pick<RunResult, 'range'>,
  option: Option,
  slotKey: string,
  candidate: ScoredCandidate,
): Result<Option> {
  const idx = option.items.findIndex((i) => i.slot.key === slotKey);
  const existing = option.items[idx];
  if (!existing)
    return err(new RuleViolation('item_not_found', 'Item is not part of this composition'));
  if (candidate.total < MIN_PRODUCT_MATCH) {
    return err(
      new RuleViolation(
        'below_min_match',
        `Replacement Match Score ${candidate.total} is below ${MIN_PRODUCT_MATCH}`,
      ),
    );
  }
  if (candidate.fit < MIN_FIT) {
    return err(
      new RuleViolation('fails_fit', 'Replacement fails the fit requirement for this space'),
    );
  }
  const trial: Item[] = option.items.map((it, i) =>
    i === idx ? { ...candidate, slot: existing.slot, qty: existing.slot.qty } : it,
  );
  const scored = scoreComposition(trial, option.slots, run.range, option.ceiling);
  if (!scored.valid) {
    return err(
      new RuleViolation(
        'composition_invalid',
        scored.reason || `Revised composition is below ${MIN_COMPOSITION}`,
      ),
    );
  }
  return ok({ ...option, items: trial, modified: true, ...scored });
}

/**
 * The customer removes a non-essential product; the total recalculates immediately and need not
 * stay inside the original tier range (AID-LOG-002 §9). Removal is the customer's choice, not a
 * rebuild, so the option stays shown even if its score now reads below the system minimum.
 */
export function removeItem(
  run: Pick<RunResult, 'range'>,
  option: Option,
  slotKey: string,
): Result<Option> {
  const target = option.items.find((i) => i.slot.key === slotKey);
  if (!target)
    return err(new RuleViolation('item_not_found', 'Item is not part of this composition'));
  if (target.slot.essential) {
    return err(
      new RuleViolation(
        'essential_item',
        'This product covers an essential function and cannot be removed',
      ),
    );
  }
  const items = option.items.filter((i) => i.slot.key !== slotKey);
  return ok({
    ...option,
    items,
    modified: true,
    ...scoreComposition(items, option.slots, run.range, option.ceiling),
  });
}
