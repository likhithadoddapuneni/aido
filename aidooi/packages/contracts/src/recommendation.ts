import { z } from 'zod';
import { FilsSchema, InstantSchema, UuidSchema } from './common.ts';
import {
  ColourSchema,
  OfferSummarySchema,
  ProductSummarySchema,
  StyleSchema,
  TierSchema,
} from './catalogue.ts';

/** Choice for a style/colour question; `assisted` = "let AIDOOi choose" (no stated preference to conflict with). */
const StylePrefSchema = z.union([StyleSchema, z.literal('assisted')]);
const ColourPrefSchema = z.union([ColourSchema, z.literal('assisted')]);

const Preferences = { style: StylePrefSchema, colour: ColourPrefSchema, tier: TierSchema };
const Dim = z.number().min(1.5).max(30).describe('metres');
const Bed = z.enum(['Single', 'Queen', 'King', 'Super King']);

/**
 * AID-SPC-001…009: each path collects only what it needs. The customer never enters a size class —
 * it is derived from the dimensions.
 */
export const ProjectInputSchema = z.discriminatedUnion('pathId', [
  z.object({ pathId: z.literal('livingRoom'), lengthM: Dim, widthM: Dim, ...Preferences }),
  z.object({
    pathId: z.literal('bedroom'),
    lengthM: Dim,
    widthM: Dim,
    bedSize: Bed,
    ...Preferences,
  }),
  z.object({
    pathId: z.literal('diningRoom'),
    lengthM: Dim,
    widthM: Dim,
    capacity: z.number().int().min(2).max(12),
    ...Preferences,
  }),
  z.object({
    pathId: z.literal('homeOffice'),
    lengthM: Dim,
    widthM: Dim,
    users: z.number().int().min(1).max(6),
    ...Preferences,
  }),
  z.object({
    pathId: z.literal('studio'),
    totalAreaM2: z.number().min(10).max(200),
    sleepingSetup: z.enum(['Sofa Bed', 'Single Bed', 'Queen Bed', 'King Bed']),
    totalBudgetFils: FilsSchema.positive(),
    ...Preferences,
  }),
  z.object({
    pathId: z.literal('fullApartment'),
    bedrooms: z.number().int().min(1).max(8),
    /** AID-SPC-007 bedroom sizes in m², master first. Fewer entries than bedrooms is fine: the rest use defaults. */
    bedroomAreasM2: z.array(z.number().min(6).max(80)).max(8).optional(),
    bedSizes: z.array(Bed).max(8).optional(),
    livingAreaM2: z.number().min(8).max(120).optional(),
    diningCapacity: z.number().int().min(2).max(12).optional(),
    office: z.boolean(),
    masterBedSize: Bed.optional(),
    /** Whether bedrooms after the first should look related (a recommendation modifier, never a budget one). */
    bedroomConsistency: z.boolean().default(false),
    totalBudgetFils: FilsSchema.positive(),
    ...Preferences,
  }),
  z.object({
    pathId: z.literal('villa'),
    floors: z.number().int().min(1).max(5),
    bedrooms: z.number().int().min(1).max(12),
    bedroomAreasM2: z.array(z.number().min(6).max(120)).max(12).optional(),
    bedSizes: z.array(Bed).max(12).optional(),
    livingAreaM2: z.number().min(8).max(200).optional(),
    diningCapacity: z.number().int().min(2).max(14).optional(),
    office: z.boolean(),
    masterBedSize: Bed.optional(),
    bedroomConsistency: z.boolean().default(false),
    totalBudgetFils: FilsSchema.positive(),
    ...Preferences,
  }),
  z.object({
    pathId: z.literal('individualProduct'),
    productType: z.string().min(2).max(60),
    branch: z.string().max(30).nullable().default(null),
    ...Preferences,
  }),
]);
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export const ProjectSchema = z.object({
  id: UuidSchema,
  input: ProjectInputSchema,
  /** System-derived; never entered by the customer. */
  sizeClass: z.enum(['Compact', 'Small', 'Medium', 'Large', 'Extra Large']).nullable(),
  /** Target range for the whole composition at the chosen tier. */
  budgetRange: z.object({ lowFils: FilsSchema, highFils: FilsSchema }).nullable(),
  state: z.enum(['Draft', 'In Progress', 'Ready for Recommendation']),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectBodySchema = z.object({ input: ProjectInputSchema });
export const ProjectParamsSchema = z.object({ projectId: UuidSchema });
export const UpdateProjectBodySchema = z.object({ input: ProjectInputSchema });

/** The five budget cards for a path: tier name + AED range (AID-LOG-001 §6). */
export const BudgetCardsQuerySchema = z.object({ projectId: UuidSchema });
export const BudgetCardsSchema = z.object({
  cards: z.array(
    z.object({ tier: TierSchema, lowFils: FilsSchema, highFils: FilsSchema, blurb: z.string() }),
  ),
});

export const OBJECTIVES = ['best_overall', 'best_value', 'best_style', 'premium'] as const;

const MatchClass = z.enum(['Excellent Match', 'Strong Match', 'Good Match', 'Acceptable Match']);

export const CompositionItemSchema = z.object({
  slotKey: z.string(),
  role: z.enum(['anchor', 'core', 'secondary']),
  essential: z.boolean(),
  quantity: z.number().int().positive(),
  unitPrice: FilsSchema,
  lineTotal: FilsSchema,
  /** AIDOOi Match Score 0–100, and the factors behind it. Present when the item was scored. */
  match: z
    .object({
      score: z.number().int(),
      classification: MatchClass,
      fit: z.number(),
      style: z.number(),
      colour: z.number(),
      budget: z.number(),
    })
    .nullable(),
  product: ProductSummarySchema,
  offer: OfferSummarySchema,
  /** Changed or sold out since the run: re-run the recommendation to continue. */
  stale: z.enum(['price_changed', 'unavailable', 'below_standard']).nullable(),
});

export const CompositionSchema = z.object({
  id: UuidSchema,
  runId: UuidSchema,
  objective: z.enum(OBJECTIVES),
  label: z.string(),
  blurb: z.string(),
  state: z.enum(['Valid', 'Rebuild', 'Rejected']),
  score: z.number().int().nullable(),
  classification: z.string().nullable(),
  total: FilsSchema,
  ceiling: FilsSchema,
  modifiedByCustomer: z.boolean(),
  breakdown: z
    .object({
      productMatchQuality: z.number(),
      harmonyStyle: z.number(),
      harmonyColour: z.number(),
      harmonyMaterial: z.number(),
      functionalCompleteness: z.number(),
      budgetPerformance: z.number(),
    })
    .nullable(),
  items: z.array(CompositionItemSchema),
  /** Slots the engine could not fill (reported, never silently dropped). */
  unfilled: z.array(z.string()),
  stale: z.boolean(),
  /** The room this composition furnishes, in cm (longer side first), so a client can draw the plan. */
  room: z.object({ widthCm: z.number().int(), depthCm: z.number().int() }).nullable(),
  /** A concept visualization: a measured plan drawn from verified dimensions, labelled as such (AID-LOG-011). */
  visualization: z.object({
    fidelity: z.enum(['Product-Faithful', 'Concept']),
    state: z.enum(['Current', 'Refresh Required']),
    hotspots: z.record(z.string(), z.object({ productId: z.string(), offerId: z.string() })),
  }),
});
export type Composition = z.infer<typeof CompositionSchema>;

export const RunSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  moduleId: UuidSchema.nullable(),
  moduleLabel: z.string().nullable(),
  status: z.enum(['Completed', 'Limited Inventory', 'Failed']),
  reason: z.string().nullable(),
  sizeClass: z.string().nullable(),
  range: z.object({ lowFils: FilsSchema, highFils: FilsSchema }).nullable(),
  compositions: z.array(CompositionSchema),
  createdAt: InstantSchema,
});

/** A single room returns one run; a multi-room project returns one run per module and a total. */
export const RecommendationResponseSchema = z.object({
  runs: z.array(RunSchema),
  /** Present for multi-room projects. */
  project: z
    .object({
      totalBudgetFils: FilsSchema,
      bestOverallTotalFils: FilsSchema,
      constraint: z.string().nullable(),
    })
    .nullable(),
});

export const CompositionParamsSchema = z.object({ compositionId: UuidSchema });
export const SlotParamsSchema = z.object({
  compositionId: UuidSchema,
  slotKey: z.string().min(1).max(80),
});
export const ReplaceBodySchema = z.object({ offerId: z.string().regex(/^AIO-\d{8}$/) });

export const AlternativesSchema = z.object({
  alternatives: z.array(
    z.object({
      match: z.object({ score: z.number().int(), classification: MatchClass, fit: z.number() }),
      product: ProductSummarySchema,
      offer: OfferSummarySchema,
      /** Price difference against the current choice, in fils (negative = cheaper). */
      priceDelta: z.number().int(),
    }),
  ),
});

/** AID-SPC-009: one product type ranked against the customer's preferences. */
export const RankingSchema = z.object({
  tier: TierSchema,
  priceRange: z.object({ lowFils: FilsSchema, highFils: FilsSchema }).nullable(),
  results: z.array(
    z.object({
      match: z.object({
        score: z.number().int(),
        classification: MatchClass,
        fit: z.number(),
        style: z.number(),
        colour: z.number(),
        budget: z.number(),
      }),
      product: ProductSummarySchema,
      offer: OfferSummarySchema,
    }),
  ),
});
