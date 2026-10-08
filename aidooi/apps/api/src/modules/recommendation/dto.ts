import type { Selectable } from 'kysely';
import type { z } from 'zod';
import type {
  CompositionItemSchema,
  CompositionSchema,
  OfferSummarySchema,
  ProductSummarySchema,
} from '@aidooi/contracts';
import type { DB } from '@aidooi/db';
import { classifyMatch } from '@aidooi/domain';
import type { Rehydrated } from './rehydrate.ts';

type Composition = z.infer<typeof CompositionSchema>;
type Item = z.infer<typeof CompositionItemSchema>;
type Product = z.infer<typeof ProductSummarySchema>;
type Offer = z.infer<typeof OfferSummarySchema>;
type CompositionRow = Selectable<DB['recommendation.composition']>;
type ItemRow = Selectable<DB['recommendation.composition_item']>;
type VisualizationRow = Selectable<DB['recommendation.visualization']>;

export interface Cards {
  readonly products: ReadonlyMap<string, Product>;
  readonly offers: ReadonlyMap<string, Offer>;
}

/** Slot keys look like `Sofa#0`; the suffix is the slot's position in the room's default composition. */
const slotIndex = (key: string): number => Number(key.slice(key.lastIndexOf('#') + 1));

const MATCH_CLASSES = [
  'Excellent Match',
  'Strong Match',
  'Good Match',
  'Acceptable Match',
] as const;
const matchClass = (score: number): (typeof MATCH_CLASSES)[number] => {
  const c = classifyMatch(score);
  return (MATCH_CLASSES as readonly string[]).includes(c)
    ? (c as (typeof MATCH_CLASSES)[number])
    : 'Acceptable Match';
};

export const toMatch = (c: {
  total: number;
  fit: number;
  style: number;
  colour: number;
  budget: number;
}) => ({
  score: c.total,
  classification: matchClass(c.total),
  fit: c.fit,
  style: c.style,
  colour: c.colour,
  budget: Math.max(0, c.budget),
});

/** Persisted composition + live re-score → the contract shape. Stored prices are shown; live changes are flagged. */
export function compositionDto(args: {
  composition: CompositionRow;
  items: readonly ItemRow[];
  visualization: VisualizationRow | undefined;
  rehydrated: Rehydrated;
  cards: Cards;
}): Composition {
  const { composition, items, visualization, rehydrated, cards } = args;
  const { option, stale } = rehydrated;
  const scoredBySlot = new Map(option.items.map((i) => [i.slot.key, i]));

  const dtoItems: Item[] = [];
  for (const row of [...items].sort((a, b) => slotIndex(a.slot_key) - slotIndex(b.slot_key))) {
    const product = cards.products.get(row.product_id);
    const offer = cards.offers.get(row.offer_id);
    if (!product || !offer) continue; // the product record itself is gone; nothing sensible to show
    const scored = scoredBySlot.get(row.slot_key);
    const unit = Number(row.unit_price_fils);
    dtoItems.push({
      slotKey: row.slot_key,
      role: row.role as Item['role'],
      essential: row.essential,
      quantity: row.quantity,
      unitPrice: unit,
      lineTotal: unit * row.quantity,
      match: scored && !stale.has(row.slot_key) ? toMatch(scored) : null,
      product,
      offer,
      stale: stale.get(row.slot_key) ?? null,
    });
  }

  const b = option.valid ? option.breakdown : null;
  return {
    id: composition.id,
    runId: composition.run_id,
    objective: composition.objective as Composition['objective'],
    label: option.label,
    blurb: option.blurb,
    state: composition.state as Composition['state'],
    score: composition.score,
    classification: option.valid ? option.classification : null,
    total: Number(composition.total_price_fils),
    ceiling: option.ceiling,
    modifiedByCustomer: composition.modified_by_customer,
    breakdown: b
      ? {
          productMatchQuality: b.productMatchQuality,
          harmonyStyle: b.harmony.style,
          harmonyColour: b.harmony.colour,
          harmonyMaterial: b.harmony.material,
          functionalCompleteness: b.completeness,
          budgetPerformance: b.budgetPerformance,
        }
      : composition.product_match_quality === null
        ? null
        : {
            productMatchQuality: Number(composition.product_match_quality),
            harmonyStyle: Number(composition.harmony_style),
            harmonyColour: Number(composition.harmony_colour),
            harmonyMaterial: Number(composition.harmony_material),
            functionalCompleteness: Number(composition.functional_completeness),
            budgetPerformance: Number(composition.budget_performance),
          },
    items: dtoItems,
    unfilled: option.slots
      .filter((s) => !items.some((i) => i.slot_key === s.key))
      .map((s) => s.type),
    stale: stale.size > 0,
    room: roomOf(rehydrated),
    visualization: {
      fidelity: (visualization?.fidelity ?? 'Concept') as 'Concept' | 'Product-Faithful',
      state:
        stale.size > 0
          ? 'Refresh Required'
          : ((visualization?.state ?? 'Current') as 'Current' | 'Refresh Required'),
      hotspots: (visualization?.hotspots ?? {}) as Composition['visualization']['hotspots'],
    },
  };
}

/** Longer side first; null when the project carries no dimensions (it never does for a composed room). */
function roomOf(r: Rehydrated): Composition['room'] {
  const { lengthM, widthM } = r.project.spec;
  if (!lengthM || !widthM) return null;
  const [a, b] = [Math.round(lengthM * 100), Math.round(widthM * 100)];
  return { widthCm: Math.max(a, b), depthCm: Math.min(a, b) };
}
