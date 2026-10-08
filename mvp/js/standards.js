/* ============================================================
   standards.js — Controlled vocabularies & price intelligence
   Implements:
     AID-DATA-007  Product Colour Standard      (colour families)
     AID-DATA-009  Product Style Standard       (style vocabulary)
     AID-DATA-008  Product Material Standard    (material families)
     AID-LOG-001   Product Price Range Standard (AED tier matrix)
   Per AID-LOG-009 §12, Style and Colour compatibility must come from
   controlled maps — never from free model interpretation.
   ============================================================ */

export const CURRENCY = 'AED';

/* ---------- AID-DATA-009 : customer-facing controlled styles ---------- */
export const STYLES = [
  { id: 'modern',       label: 'Modern',             family: 'Modern' },
  { id: 'contemporary', label: 'Contemporary',       family: 'Contemporary' },
  { id: 'mcm',          label: 'Mid-Century Modern', family: 'Modern' },
  { id: 'scandinavian', label: 'Scandinavian',       family: 'Minimal / Nordic' },
  { id: 'minimalist',   label: 'Minimalist',         family: 'Minimal / Nordic' },
  { id: 'japandi',      label: 'Japandi',            family: 'Japanese / Hybrid' },
  { id: 'industrial',   label: 'Industrial',         family: 'Industrial' },
  { id: 'classic',      label: 'Classic',            family: 'Classic' },
  { id: 'traditional',  label: 'Traditional',        family: 'Traditional' }
];

/* Controlled Style Compatibility Map (AID-LOG-009 §5 / §12).
   1.00 = same standard style, 0.70 = strong/defined compatible,
   0.50 = partially compatible, 0.00 = clear conflict.
   Omitted pairs default to 0.50 within the same family, else conflict. */
const STYLE_COMPAT = {
  modern:       { contemporary: .7, mcm: .7, minimalist: .7, scandinavian: .5, japandi: .5, industrial: .5, classic: 0,  traditional: 0 },
  contemporary: { modern: .7, minimalist: .7, scandinavian: .5, japandi: .5, mcm: .5, industrial: .5, classic: .5, traditional: 0 },
  mcm:          { modern: .7, scandinavian: .7, contemporary: .5, minimalist: .5, japandi: .5, industrial: .5, classic: 0, traditional: 0 },
  scandinavian: { minimalist: .7, japandi: .7, mcm: .7, modern: .5, contemporary: .5, industrial: .5, classic: 0, traditional: 0 },
  minimalist:   { scandinavian: .7, japandi: .7, modern: .7, contemporary: .7, mcm: .5, industrial: .5, classic: 0, traditional: 0 },
  japandi:      { scandinavian: .7, minimalist: .7, modern: .5, contemporary: .5, mcm: .5, industrial: 0, classic: 0, traditional: 0 },
  industrial:   { modern: .5, contemporary: .5, mcm: .5, minimalist: .5, scandinavian: .5, classic: 0, traditional: 0, japandi: 0 },
  classic:      { traditional: .7, contemporary: .5, modern: 0, mcm: 0, scandinavian: 0, minimalist: 0, japandi: 0, industrial: 0 },
  traditional:  { classic: .7, contemporary: 0, modern: 0, mcm: 0, scandinavian: 0, minimalist: 0, japandi: 0, industrial: 0 }
};

/** AID-LOG-009 §5 — Style Match score, 0–100. */
export function styleScore(customerStyle, primary, secondary) {
  if (!customerStyle || customerStyle === 'assisted') return 85; // AIDOOi-assisted: no stated preference to conflict with
  if (primary === customerStyle) return 100;
  if (secondary && secondary === customerStyle) return 85;
  const rel = (STYLE_COMPAT[customerStyle] || {})[primary];
  if (rel === undefined) return 50;
  if (rel >= 1) return 100;
  if (rel >= .7) return 70;
  if (rel >= .5) return 50;
  return 0;                                                       // clear style conflict
}

/* ---------- AID-DATA-007 : controlled colour families ---------- */
export const COLOURS = [
  { id: 'white',  label: 'White',  hex: '#F7F5F1', examples: 'Ivory, Off-White, Cream White' },
  { id: 'beige',  label: 'Beige',  hex: '#D9C9AF', examples: 'Cream, Sand, Taupe, Ecru' },
  { id: 'grey',   label: 'Grey',   hex: '#9AA0A6', examples: 'Light Grey, Charcoal, Graphite' },
  { id: 'black',  label: 'Black',  hex: '#2B2B2B', examples: 'Jet Black, Charcoal Black' },
  { id: 'brown',  label: 'Brown',  hex: '#8B5E3C', examples: 'Cognac, Camel, Chocolate, Mocha' },
  { id: 'natural',label: 'Natural',hex: '#C8A979', examples: 'Natural wood / fibre tone' },
  { id: 'green',  label: 'Green',  hex: '#6B7F63', examples: 'Sage, Olive, Forest, Emerald' },
  { id: 'blue',   label: 'Blue',   hex: '#3B5A7A', examples: 'Navy, Sky Blue, Teal, Cobalt' },
  { id: 'red',    label: 'Red',    hex: '#8C3A3A', examples: 'Burgundy, Wine, Crimson' },
  { id: 'orange', label: 'Orange', hex: '#B5673A', examples: 'Terracotta, Burnt Orange' },
  { id: 'yellow', label: 'Yellow', hex: '#C9A227', examples: 'Mustard, Ochre' },
  { id: 'pink',   label: 'Pink',   hex: '#D5A6A1', examples: 'Blush, Rose, Dusty Pink' },
  { id: 'purple', label: 'Purple', hex: '#7A6490', examples: 'Lavender, Plum' },
  { id: 'gold',   label: 'Gold',   hex: '#C0A062', examples: 'Champagne Gold, Antique Gold' },
  { id: 'silver', label: 'Silver', hex: '#B6BABD', examples: 'Chrome, Brushed Silver' },
  { id: 'brass',  label: 'Brass',  hex: '#B08D3F', examples: 'Antique Brass, Brushed Brass' },
  { id: 'bronze', label: 'Bronze', hex: '#8A6A45', examples: 'Antique Bronze, Copper-Bronze' },
  { id: 'multicolour', label: 'Multicolour', hex: 'linear', examples: 'No single dominant family' }
];
export const COLOUR_HEX = Object.fromEntries(COLOURS.map(c => [c.id, c.hex]));

/* Neutrals harmonize with any selected palette (AID-LOG-009 §6, score 50 floor). */
const NEUTRALS = new Set(['white', 'beige', 'grey', 'black', 'natural', 'silver']);

/* Controlled Colour Compatibility Map — compatible families (score 70). */
const COLOUR_COMPAT = {
  white:  ['beige', 'natural', 'grey', 'blue', 'green'],
  beige:  ['white', 'natural', 'brown', 'green', 'brass', 'gold'],
  grey:   ['white', 'black', 'blue', 'silver', 'natural'],
  black:  ['grey', 'white', 'brass', 'bronze', 'natural'],
  brown:  ['beige', 'natural', 'green', 'brass', 'orange', 'bronze'],
  natural:['beige', 'white', 'brown', 'green', 'black'],
  green:  ['natural', 'beige', 'brown', 'brass', 'white'],
  blue:   ['white', 'grey', 'natural', 'brass', 'beige'],
  red:    ['beige', 'natural', 'brass', 'brown'],
  orange: ['brown', 'beige', 'natural', 'green'],
  yellow: ['grey', 'natural', 'white', 'brown'],
  pink:   ['beige', 'white', 'grey', 'natural'],
  purple: ['grey', 'white', 'silver'],
  gold:   ['beige', 'white', 'black', 'green'],
  silver: ['grey', 'white', 'blue', 'black'],
  brass:  ['beige', 'green', 'brown', 'blue', 'black'],
  bronze: ['brown', 'black', 'beige', 'natural'],
  multicolour: []
};

/** AID-LOG-009 §6 — Colour Match score, 0–100. */
export function colourScore(customerColour, primary, secondary) {
  if (!customerColour || customerColour === 'assisted') return 85;
  if (primary === customerColour) return 100;
  if (secondary && secondary === customerColour) return 85;
  if ((COLOUR_COMPAT[customerColour] || []).includes(primary)) return 70;
  if (NEUTRALS.has(primary)) return 50;                           // harmonizable
  return 0;                                                       // clear conflict
}

/* ---------- AID-DATA-008 : material families + compatibility ---------- */
export const MATERIALS = ['Wood', 'Metal', 'Fabric', 'Leather', 'Glass', 'Stone', 'Rattan', 'Ceramic'];
const MATERIAL_COMPAT = {
  Wood:    ['Wood', 'Fabric', 'Leather', 'Rattan', 'Stone', 'Metal', 'Ceramic', 'Glass'],
  Metal:   ['Metal', 'Glass', 'Wood', 'Leather', 'Stone', 'Fabric'],
  Fabric:  ['Fabric', 'Wood', 'Metal', 'Rattan', 'Leather'],
  Leather: ['Leather', 'Wood', 'Metal', 'Fabric', 'Stone'],
  Glass:   ['Glass', 'Metal', 'Wood', 'Stone'],
  Stone:   ['Stone', 'Wood', 'Metal', 'Glass', 'Leather'],
  Rattan:  ['Rattan', 'Wood', 'Fabric', 'Ceramic'],
  Ceramic: ['Ceramic', 'Wood', 'Rattan', 'Stone', 'Metal']
};
/** Pairwise material compatibility, 0–100 (feeds AID-LOG-010 §11). */
export function materialPairScore(a, b) {
  if (!a || !b) return 70;
  if (a === b) return 100;
  return (MATERIAL_COMPAT[a] || []).includes(b) ? 85 : 40;
}

/* ---------- Budget tiers (shared tier names, AID-SPC §8) ---------- */
export const TIERS = ['Essential', 'Value', 'Standard', 'Premium', 'Luxury'];
export const TIER_BLURB = {
  Essential: 'Covers the essentials well, with no unnecessary spend.',
  Value:     'The strongest quality-per-dirham balance.',
  Standard:  'Well-made pieces with more choice of style and finish.',
  Premium:   'Higher-grade materials and more considered design.',
  Luxury:    'Statement pieces and the best available craftsmanship.'
};

/* ---------- AID-LOG-001 §4 : Product Price Range Matrix (AED) ----------
   Key = product type; where the standard uses a capacity/size branch the
   branch value is appended after a colon. Ranges are
   [Essential, Value, Standard, Premium, Luxury] lower bounds plus an
   upper bound for the 4th tier; Luxury is open-ended. */
export const PRICE_MATRIX = {
  /* 4.1 Sofas — branch: seating capacity */
  'Sofa:2':        [[500,1500],[1500,2500],[2500,4000],[4000,7000],[7000,14000]],
  'Sofa:3':        [[500,1750],[1750,3000],[3000,5000],[5000,8000],[8000,16000]],
  'Sofa:4':        [[1500,2500],[2500,4000],[4000,6000],[6000,10000],[10000,20000]],
  'Sofa:5':        [[1500,3000],[3000,5000],[5000,8000],[8000,13000],[13000,26000]],
  /* 4.2 Seating */
  'Dining Chair':  [[50,200],[200,400],[400,700],[700,1200],[1200,2400]],
  'Accent Chair':  [[200,600],[600,1000],[1000,1600],[1600,3000],[3000,6000]],
  'Office Chair':  [[100,300],[300,600],[600,1000],[1000,2000],[2000,4000]],
  'Bench':         [[100,400],[400,700],[700,1200],[1200,2500],[2500,5000]],
  /* 4.3 Dining tables — branch: seating capacity */
  'Dining Table:2':  [[150,500],[500,900],[900,1500],[1500,3000],[3000,6000]],
  'Dining Table:4':  [[150,500],[500,1000],[1000,1750],[1750,3500],[3500,7000]],
  'Dining Table:6':  [[300,700],[700,1200],[1200,2000],[2000,4000],[4000,8000]],
  'Dining Table:8':  [[400,800],[800,1500],[1500,2500],[2500,5000],[5000,10000]],
  'Dining Table:10': [[600,1200],[1200,2000],[2000,3500],[3500,7000],[7000,14000]],
  /* 4.4 Other tables */
  'Coffee Table':  [[75,250],[250,500],[500,1000],[1000,2000],[2000,4000]],
  'Side Table':    [[30,150],[150,300],[300,600],[600,1200],[1200,2400]],
  'Console Table': [[200,500],[500,900],[900,1500],[1500,3000],[3000,6000]],
  /* 4.5 Beds — branch: bed size */
  'Bed:Single':    [[250,500],[500,800],[800,1200],[1200,2000],[2000,4000]],
  'Bed:Queen':     [[400,700],[700,1100],[1100,1700],[1700,3000],[3000,6000]],
  'Bed:King':      [[500,800],[800,1300],[1300,2000],[2000,3500],[3500,7000]],
  'Bed:Super King':[[600,1000],[1000,1500],[1500,2500],[2500,4000],[4000,8000]],
  /* 4.7 Wardrobes — branch: door group */
  'Wardrobe:Small':  [[300,600],[600,1000],[1000,1500],[1500,3000],[3000,6000]],
  'Wardrobe:Medium': [[500,900],[900,1500],[1500,2500],[2500,4000],[4000,8000]],
  'Wardrobe:Large':  [[900,1500],[1500,2500],[2500,3500],[3500,5500],[5500,11000]],
  /* 4.8 Storage & casegoods */
  'Chest of Drawers': [[150,400],[400,700],[700,1200],[1200,2500],[2500,5000]],
  'Bedside Table':    [[50,200],[200,400],[400,700],[700,1200],[1200,2400]],
  'TV Unit':          [[100,400],[400,800],[800,1500],[1500,3000],[3000,6000]],
  'Sideboard':        [[200,600],[600,1000],[1000,1800],[1800,3000],[3000,6000]],
  'Bookcase':         [[100,300],[300,600],[600,1000],[1000,2000],[2000,4000]],
  'Storage Cabinet':  [[200,600],[600,1000],[1000,1800],[1800,3000],[3000,6000]],
  /* 4.9 Lighting */
  'Table Lamp':    [[20,100],[100,200],[200,400],[400,800],[800,1600]],
  'Floor Lamp':    [[30,150],[150,300],[300,600],[600,1200],[1200,2400]],
  'Pendant Light': [[30,150],[150,300],[300,600],[600,1200],[1200,2400]],
  'Chandelier':    [[100,400],[400,800],[800,1500],[1500,3000],[3000,6000]],
  'Wall Light':    [[30,100],[100,200],[200,400],[400,800],[800,1600]],
  'Task Lamp':     [[20,100],[100,200],[200,400],[400,800],[800,1600]],
  /* 4.10 Rugs — branch: rug size */
  'Rug:Small':      [[30,150],[150,300],[300,600],[600,1200],[1200,2400]],
  'Rug:Medium':     [[100,250],[250,450],[450,800],[800,1500],[1500,3000]],
  'Rug:Large':      [[150,350],[350,650],[650,1200],[1200,2500],[2500,5000]],
  'Rug:Extra Large':[[300,600],[600,1000],[1000,1800],[1800,3500],[3500,7000]],
  /* 4.11 Soft furnishings */
  'Cushion':       [[20,50],[50,100],[100,200],[200,400],[400,800]],
  'Throw':         [[30,80],[80,150],[150,300],[300,600],[600,1200]],
  /* 4.12 Decor & accessories */
  'Mirror':            [[50,200],[200,400],[400,800],[800,1500],[1500,3000]],
  'Wall Art':          [[30,150],[150,300],[300,600],[600,1200],[1200,2400]],
  'Vase':              [[20,80],[80,150],[150,300],[300,600],[600,1200]],
  'Decorative Object': [[30,100],[100,250],[250,500],[500,1000],[1000,2000]],
  'Planter':           [[20,100],[100,250],[250,500],[500,1000],[1000,2000]],
  /* Desks (Home Office anchor; priced with Console/Storage market band) */
  'Desk':          [[200,500],[500,900],[900,1600],[1600,3000],[3000,6000]]
};

/** Resolve the AID-LOG-001 range for a product type + optional branch + tier. */
export function priceRange(type, branch, tier) {
  const key = branch ? `${type}:${branch}` : type;
  const rows = PRICE_MATRIX[key] || PRICE_MATRIX[type];
  if (!rows) return null;
  return rows[TIERS.indexOf(tier)] || null;
}

/** Which AID-LOG-001 tier does a given selling price fall into? */
export function tierOfPrice(type, branch, price) {
  const key = branch ? `${type}:${branch}` : type;
  const rows = PRICE_MATRIX[key] || PRICE_MATRIX[type];
  if (!rows) return 'Standard';
  for (let i = 0; i < rows.length; i++) if (price < rows[i][1]) return TIERS[i];
  return 'Luxury';
}

export const fmtAED = n =>
  new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Math.round(n));
