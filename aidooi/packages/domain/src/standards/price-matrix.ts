/**
 * AID-LOG-001 §4 — Product Price Range Matrix, in AED.
 * Each row is [Essential, Value, Standard, Premium, Luxury] as [low, high). Luxury's high bound
 * is a planning figure; Luxury is open-ended in the standard.
 * Key = product type, plus `:branch` where the standard branches by capacity/size.
 */
import { aed, type Fils } from '../kernel/money.ts';
import { TIERS, type Tier } from './vocab.ts';

type Row = readonly [number, number];
type Rows = readonly [Row, Row, Row, Row, Row];

const MATRIX_AED: Readonly<Record<string, Rows>> = {
  'Sofa:2': [
    [500, 1500],
    [1500, 2500],
    [2500, 4000],
    [4000, 7000],
    [7000, 14000],
  ],
  'Sofa:3': [
    [500, 1750],
    [1750, 3000],
    [3000, 5000],
    [5000, 8000],
    [8000, 16000],
  ],
  'Sofa:4': [
    [1500, 2500],
    [2500, 4000],
    [4000, 6000],
    [6000, 10000],
    [10000, 20000],
  ],
  'Sofa:5': [
    [1500, 3000],
    [3000, 5000],
    [5000, 8000],
    [8000, 13000],
    [13000, 26000],
  ],
  'Dining Chair': [
    [50, 200],
    [200, 400],
    [400, 700],
    [700, 1200],
    [1200, 2400],
  ],
  'Accent Chair': [
    [200, 600],
    [600, 1000],
    [1000, 1600],
    [1600, 3000],
    [3000, 6000],
  ],
  'Office Chair': [
    [100, 300],
    [300, 600],
    [600, 1000],
    [1000, 2000],
    [2000, 4000],
  ],
  Bench: [
    [100, 400],
    [400, 700],
    [700, 1200],
    [1200, 2500],
    [2500, 5000],
  ],
  'Dining Table:2': [
    [150, 500],
    [500, 900],
    [900, 1500],
    [1500, 3000],
    [3000, 6000],
  ],
  'Dining Table:4': [
    [150, 500],
    [500, 1000],
    [1000, 1750],
    [1750, 3500],
    [3500, 7000],
  ],
  'Dining Table:6': [
    [300, 700],
    [700, 1200],
    [1200, 2000],
    [2000, 4000],
    [4000, 8000],
  ],
  'Dining Table:8': [
    [400, 800],
    [800, 1500],
    [1500, 2500],
    [2500, 5000],
    [5000, 10000],
  ],
  'Dining Table:10': [
    [600, 1200],
    [1200, 2000],
    [2000, 3500],
    [3500, 7000],
    [7000, 14000],
  ],
  'Coffee Table': [
    [75, 250],
    [250, 500],
    [500, 1000],
    [1000, 2000],
    [2000, 4000],
  ],
  'Side Table': [
    [30, 150],
    [150, 300],
    [300, 600],
    [600, 1200],
    [1200, 2400],
  ],
  'Console Table': [
    [200, 500],
    [500, 900],
    [900, 1500],
    [1500, 3000],
    [3000, 6000],
  ],
  'Bed:Single': [
    [250, 500],
    [500, 800],
    [800, 1200],
    [1200, 2000],
    [2000, 4000],
  ],
  'Bed:Queen': [
    [400, 700],
    [700, 1100],
    [1100, 1700],
    [1700, 3000],
    [3000, 6000],
  ],
  'Bed:King': [
    [500, 800],
    [800, 1300],
    [1300, 2000],
    [2000, 3500],
    [3500, 7000],
  ],
  'Bed:Super King': [
    [600, 1000],
    [1000, 1500],
    [1500, 2500],
    [2500, 4000],
    [4000, 8000],
  ],
  'Wardrobe:Small': [
    [300, 600],
    [600, 1000],
    [1000, 1500],
    [1500, 3000],
    [3000, 6000],
  ],
  'Wardrobe:Medium': [
    [500, 900],
    [900, 1500],
    [1500, 2500],
    [2500, 4000],
    [4000, 8000],
  ],
  'Wardrobe:Large': [
    [900, 1500],
    [1500, 2500],
    [2500, 3500],
    [3500, 5500],
    [5500, 11000],
  ],
  'Chest of Drawers': [
    [150, 400],
    [400, 700],
    [700, 1200],
    [1200, 2500],
    [2500, 5000],
  ],
  'Bedside Table': [
    [50, 200],
    [200, 400],
    [400, 700],
    [700, 1200],
    [1200, 2400],
  ],
  'TV Unit': [
    [100, 400],
    [400, 800],
    [800, 1500],
    [1500, 3000],
    [3000, 6000],
  ],
  Sideboard: [
    [200, 600],
    [600, 1000],
    [1000, 1800],
    [1800, 3000],
    [3000, 6000],
  ],
  Bookcase: [
    [100, 300],
    [300, 600],
    [600, 1000],
    [1000, 2000],
    [2000, 4000],
  ],
  'Storage Cabinet': [
    [200, 600],
    [600, 1000],
    [1000, 1800],
    [1800, 3000],
    [3000, 6000],
  ],
  'Table Lamp': [
    [20, 100],
    [100, 200],
    [200, 400],
    [400, 800],
    [800, 1600],
  ],
  'Floor Lamp': [
    [30, 150],
    [150, 300],
    [300, 600],
    [600, 1200],
    [1200, 2400],
  ],
  'Pendant Light': [
    [30, 150],
    [150, 300],
    [300, 600],
    [600, 1200],
    [1200, 2400],
  ],
  Chandelier: [
    [100, 400],
    [400, 800],
    [800, 1500],
    [1500, 3000],
    [3000, 6000],
  ],
  'Wall Light': [
    [30, 100],
    [100, 200],
    [200, 400],
    [400, 800],
    [800, 1600],
  ],
  'Task Lamp': [
    [20, 100],
    [100, 200],
    [200, 400],
    [400, 800],
    [800, 1600],
  ],
  'Rug:Small': [
    [30, 150],
    [150, 300],
    [300, 600],
    [600, 1200],
    [1200, 2400],
  ],
  'Rug:Medium': [
    [100, 250],
    [250, 450],
    [450, 800],
    [800, 1500],
    [1500, 3000],
  ],
  'Rug:Large': [
    [150, 350],
    [350, 650],
    [650, 1200],
    [1200, 2500],
    [2500, 5000],
  ],
  'Rug:Extra Large': [
    [300, 600],
    [600, 1000],
    [1000, 1800],
    [1800, 3500],
    [3500, 7000],
  ],
  Cushion: [
    [20, 50],
    [50, 100],
    [100, 200],
    [200, 400],
    [400, 800],
  ],
  Throw: [
    [30, 80],
    [80, 150],
    [150, 300],
    [300, 600],
    [600, 1200],
  ],
  Mirror: [
    [50, 200],
    [200, 400],
    [400, 800],
    [800, 1500],
    [1500, 3000],
  ],
  'Wall Art': [
    [30, 150],
    [150, 300],
    [300, 600],
    [600, 1200],
    [1200, 2400],
  ],
  Vase: [
    [20, 80],
    [80, 150],
    [150, 300],
    [300, 600],
    [600, 1200],
  ],
  'Decorative Object': [
    [30, 100],
    [100, 250],
    [250, 500],
    [500, 1000],
    [1000, 2000],
  ],
  Planter: [
    [20, 100],
    [100, 250],
    [250, 500],
    [500, 1000],
    [1000, 2000],
  ],
  // Not in LOG-001; priced with the console/storage market band (docs/adrs.md, section G).
  Desk: [
    [200, 500],
    [500, 900],
    [900, 1600],
    [1600, 3000],
    [3000, 6000],
  ],
};

export type PriceRange = readonly [low: Fils, high: Fils];

export const PRICE_MATRIX: Readonly<Record<string, readonly PriceRange[]>> = Object.fromEntries(
  Object.entries(MATRIX_AED).map(([k, rows]) => [
    k,
    rows.map(([lo, hi]) => [aed(lo), aed(hi)] as const),
  ]),
);

const rowsFor = (type: string, branch: string | null | undefined) =>
  (branch ? PRICE_MATRIX[`${type}:${branch}`] : undefined) ?? PRICE_MATRIX[type];

/** The AID-LOG-001 range for a product type + optional branch + tier. */
export function priceRange(
  type: string,
  branch: string | null | undefined,
  tier: Tier,
): PriceRange | null {
  return rowsFor(type, branch)?.[TIERS.indexOf(tier)] ?? null;
}

/**
 * Which tier does a Current Selling Price fall in? Always derived from price — an offer's
 * original (struck-through) price never decides its tier (AID-DATA-010).
 */
export function tierOfPrice(type: string, branch: string | null | undefined, price: Fils): Tier {
  const rows = rowsFor(type, branch);
  if (!rows) return 'Standard';
  for (let i = 0; i < rows.length; i++)
    if (price < (rows[i] as PriceRange)[1]) return TIERS[i] as Tier;
  return 'Luxury';
}

export const hasPriceRow = (type: string): boolean =>
  type in PRICE_MATRIX || Object.keys(PRICE_MATRIX).some((k) => k.startsWith(`${type}:`));
