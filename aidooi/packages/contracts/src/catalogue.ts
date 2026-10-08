import { z } from 'zod';
import { FilsSchema } from './common.ts';

export const STYLE_IDS = [
  'modern',
  'contemporary',
  'mcm',
  'scandinavian',
  'minimalist',
  'japandi',
  'industrial',
  'classic',
  'traditional',
] as const;
export const COLOUR_IDS = [
  'white',
  'beige',
  'grey',
  'black',
  'brown',
  'natural',
  'green',
  'blue',
  'red',
  'orange',
  'yellow',
  'pink',
  'purple',
  'gold',
  'silver',
  'brass',
  'bronze',
  'multicolour',
] as const;
export const TIERS = ['Essential', 'Value', 'Standard', 'Premium', 'Luxury'] as const;
export const AVAILABILITY = ['In Stock', 'Low Stock', 'Out of Stock'] as const;
export const VIEWING_STATUS = ['On Display', 'Viewable on Request', 'Not Viewable'] as const;

export const StyleSchema = z.enum(STYLE_IDS);
export const ColourSchema = z.enum(COLOUR_IDS);
export const TierSchema = z.enum(TIERS);

export const ProductSummarySchema = z.object({
  id: z.string().regex(/^AID-\d{8}$/),
  name: z.string(),
  type: z.string(),
  widthCm: z.number().int(),
  depthCm: z.number().int(),
  heightCm: z.number().int(),
  primaryColour: ColourSchema,
  secondaryColour: ColourSchema.nullable(),
  primaryStyle: StyleSchema,
  secondaryStyle: StyleSchema.nullable(),
  material: z.string(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  imageUrls: z.array(z.string().url()),
});

export const OfferSummarySchema = z.object({
  id: z.string().regex(/^AIO-\d{8}$/),
  sellingPrice: FilsSchema,
  /** Shown struck-through at most; never used to rank or tier (AID-DATA-010). */
  originalPrice: FilsSchema.nullable(),
  availability: z.enum(AVAILABILITY),
  viewingStatus: z.enum(VIEWING_STATUS),
  deliveryDays: z.number().int().nonnegative(),
  partner: z.object({
    id: z.uuid(),
    tradeName: z.string(),
    afterSalesTerms: z.string().nullable(),
  }),
  location: z.object({ id: z.uuid(), name: z.string(), area: z.string(), emirate: z.string() }),
});

/** AID-DATA-015 Product Card: what a buyer sees when they tap a product. */
export const ProductCardSchema = z.object({
  product: ProductSummarySchema,
  offers: z.array(OfferSummarySchema),
});
export type ProductCard = z.infer<typeof ProductCardSchema>;

export const ProductParamsSchema = z.object({ id: z.string().regex(/^AID-\d{8}$/) });
