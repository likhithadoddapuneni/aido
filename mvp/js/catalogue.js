/* ============================================================
   catalogue.js — Seed product intelligence for the MVP demo.
   Implements the record architecture of:
     AID-DATA-005  AIP / AID / AIO identification
     AID-DATA-001  Product Name Standard
     AID-DATA-002  Parent Product & Variant relationship
     AID-DATA-004  Classification & Taxonomy
     AID-DATA-006  Dimensions      AID-DATA-007 Colour
     AID-DATA-008  Material        AID-DATA-009 Style
     AID-DATA-010  Pricing (Current Selling Price)
     AID-DATA-011  Availability & Inventory
     AID-DATA-014  Data Status & Data Quality
   Only Verified + Active products and eligible offers may enter
   recommendation (MVP Acceptance Gate — Product Data).
   ============================================================ */

import { priceRange, TIERS, tierOfPrice } from './standards.js';

/* Deterministic PRNG so the demo catalogue is identical on every load. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- Partner stores (AID-LOG-013) ---------------- */
export const PARTNERS = [
  { id: 'PRT-001', name: 'Marina Living',      location: 'Dubai Marina, Dubai',          commission: 0.14, status: 'Active' },
  { id: 'PRT-002', name: 'Al Quoz Furniture',  location: 'Al Quoz 1, Dubai',             commission: 0.16, status: 'Active' },
  { id: 'PRT-003', name: 'Saadiyat Interiors', location: 'Saadiyat Island, Abu Dhabi',   commission: 0.13, status: 'Active' },
  { id: 'PRT-004', name: 'Deira Home Store',   location: 'Deira, Dubai',                 commission: 0.18, status: 'Active' },
  { id: 'PRT-005', name: 'Jumeirah Atelier',   location: 'Jumeirah 3, Dubai',            commission: 0.12, status: 'Active' },
  { id: 'PRT-006', name: 'Sharjah Furnishings',location: 'Al Majaz, Sharjah',            commission: 0.17, status: 'Active' }
];

/* ---------------- Product type master spec ----------------
   dims: [width, depth, height] in cm for the default branch.
   families: one model family = one AIP; each colour = one AID.   */
const T = (main, cat, dims, families, opts = {}) => ({ main, cat, dims, families, ...opts });

const F = (n, style, sec, mat, cols, tier) => ({ n, style, sec, mat, cols, tier });

export const TYPE_SPEC = {
  /* ---- Seating ---- */
  'Sofa': T('Seating', 'Sofa', { '2': [165, 90, 80], '3': [215, 92, 82], '4': [270, 95, 84], '5': [320, 98, 85] }, [
    F('Mesa',      'modern',       'contemporary', 'Fabric',  ['grey', 'beige'],            'Essential'),
    F('Orla',      'scandinavian', 'minimalist',   'Fabric',  ['beige', 'white', 'green'],  'Value'),
    F('Kano',      'japandi',      'minimalist',   'Fabric',  ['natural', 'beige'],         'Value'),
    F('Vallon',    'contemporary', 'modern',       'Fabric',  ['blue', 'grey'],             'Standard'),
    F('Hale',      'mcm',          'modern',       'Leather', ['brown', 'black'],           'Standard'),
    F('Belcourt',  'classic',      'traditional',  'Fabric',  ['beige', 'green'],           'Premium'),
    F('Rivage',    'contemporary', 'modern',       'Leather', ['white', 'brown'],           'Premium'),
    F('Monterosso','modern',       'contemporary', 'Leather', ['grey', 'brown'],            'Luxury')
  ], { branchKey: 'seats' }),

  'Accent Chair': T('Seating', 'Chair', { '': [72, 78, 82] }, [
    F('Pico',   'modern',       'contemporary', 'Fabric',  ['grey', 'beige'],   'Essential'),
    F('Lund',   'scandinavian', 'mcm',          'Fabric',  ['beige', 'green'],  'Value'),
    F('Hale',   'mcm',          'modern',       'Leather', ['brown', 'black'],  'Standard'),
    F('Nori',   'japandi',      'minimalist',   'Rattan',  ['natural'],         'Standard'),
    F('Belvoir','classic',      'traditional',  'Fabric',  ['green', 'blue'],   'Premium'),
    F('Aurelio','contemporary', 'modern',       'Leather', ['white', 'brown'],  'Luxury')
  ]),

  'Dining Chair': T('Seating', 'Chair', { '': [46, 52, 86] }, [
    F('Stac',    'modern',       'minimalist',   'Metal',   ['black', 'white'],  'Essential'),
    F('Lund',    'scandinavian', 'mcm',          'Wood',    ['natural', 'beige'],'Value'),
    F('Kano',    'japandi',      'minimalist',   'Wood',    ['natural'],         'Value'),
    F('Hale',    'mcm',          'modern',       'Leather', ['brown', 'black'],  'Standard'),
    F('Belvoir', 'classic',      'traditional',  'Fabric',  ['beige', 'green'],  'Premium'),
    F('Aurelio', 'contemporary', 'modern',       'Leather', ['white', 'grey'],   'Luxury')
  ]),

  'Office Chair': T('Seating', 'Chair', { '': [64, 64, 112] }, [
    F('Task One','modern',       'contemporary', 'Fabric', ['black', 'grey'],   'Essential'),
    F('Ergo',    'contemporary', 'modern',       'Fabric', ['grey', 'blue'],    'Value'),
    F('Lund',    'scandinavian', 'minimalist',   'Fabric', ['beige', 'white'],  'Standard'),
    F('Aurelio', 'contemporary', 'modern',       'Leather',['black', 'brown'],  'Premium'),
    F('Monterosso','modern',     'contemporary', 'Leather',['black'],           'Luxury')
  ]),

  'Bench': T('Seating', 'Bench', { '': [120, 40, 45] }, [
    F('Stac', 'modern', 'minimalist', 'Wood', ['natural', 'black'], 'Value'),
    F('Kano', 'japandi', 'scandinavian', 'Wood', ['natural'], 'Standard')
  ]),

  /* ---- Tables ---- */
  'Coffee Table': T('Tables', 'Coffee Table', { '': [110, 60, 42] }, [
    F('Mesa',    'modern',       'contemporary', 'Wood',  ['natural', 'black'],  'Essential'),
    F('Orla',    'scandinavian', 'minimalist',   'Wood',  ['natural', 'white'],  'Value'),
    F('Kano',    'japandi',      'minimalist',   'Wood',  ['natural', 'brown'],  'Standard'),
    F('Vallon',  'contemporary', 'modern',       'Glass', ['silver', 'black'],   'Standard'),
    F('Belcourt','classic',      'traditional',  'Wood',  ['brown'],             'Premium'),
    F('Aurelio', 'contemporary', 'modern',       'Stone', ['white', 'grey'],     'Luxury')
  ]),

  'Side Table': T('Tables', 'Side Table', { '': [45, 45, 55] }, [
    F('Pico',   'modern',       'minimalist',   'Metal', ['black', 'white'],   'Essential'),
    F('Orla',   'scandinavian', 'mcm',          'Wood',  ['natural', 'beige'], 'Value'),
    F('Kano',   'japandi',      'minimalist',   'Wood',  ['natural'],          'Standard'),
    F('Aurelio','contemporary', 'modern',       'Stone', ['white', 'grey'],    'Premium')
  ]),

  'Console Table': T('Tables', 'Console Table', { '': [130, 38, 80] }, [
    F('Mesa',    'modern',  'contemporary', 'Wood',  ['natural', 'black'], 'Value'),
    F('Belcourt','classic', 'traditional',  'Wood',  ['brown'],            'Premium'),
    F('Aurelio', 'contemporary', 'modern',  'Stone', ['white'],            'Luxury')
  ]),

  'Dining Table': T('Tables', 'Dining Table',
    { '2': [80, 80, 75], '4': [140, 85, 75], '6': [180, 90, 75], '8': [220, 95, 75], '10': [280, 100, 75] }, [
      F('Mesa',    'modern',       'contemporary', 'Wood',  ['natural', 'white'],  'Essential'),
      F('Orla',    'scandinavian', 'minimalist',   'Wood',  ['natural', 'white'],  'Value'),
      F('Kano',    'japandi',      'minimalist',   'Wood',  ['natural', 'brown'],  'Standard'),
      F('Vallon',  'contemporary', 'modern',       'Glass', ['silver', 'black'],   'Standard'),
      F('Belcourt','classic',      'traditional',  'Wood',  ['brown'],             'Premium'),
      F('Aurelio', 'contemporary', 'modern',       'Stone', ['white', 'grey'],     'Luxury')
    ], { branchKey: 'capacity' }),

  'Desk': T('Tables', 'Desk', { '': [130, 65, 75] }, [
    F('Task One','modern',       'contemporary', 'Wood',  ['white', 'black'],    'Essential'),
    F('Orla',    'scandinavian', 'minimalist',   'Wood',  ['natural', 'white'],  'Value'),
    F('Kano',    'japandi',      'minimalist',   'Wood',  ['natural'],           'Standard'),
    F('Vallon',  'industrial',   'modern',       'Metal', ['black', 'brown'],    'Standard'),
    F('Aurelio', 'contemporary', 'modern',       'Wood',  ['brown', 'grey'],     'Premium')
  ]),

  /* ---- Beds ---- */
  'Bed': T('Beds', 'Bed',
    { 'Single': [105, 205, 100], 'Queen': [165, 215, 110], 'King': [195, 215, 115], 'Super King': [215, 220, 120] }, [
      F('Mesa',    'modern',       'contemporary', 'Fabric', ['grey', 'beige'],     'Essential'),
      F('Orla',    'scandinavian', 'minimalist',   'Wood',   ['natural', 'white'],  'Value'),
      F('Kano',    'japandi',      'minimalist',   'Wood',   ['natural', 'brown'],  'Standard'),
      F('Vallon',  'contemporary', 'modern',       'Fabric', ['blue', 'grey'],      'Standard'),
      F('Belcourt','classic',      'traditional',  'Fabric', ['beige', 'green'],    'Premium'),
      F('Aurelio', 'contemporary', 'modern',       'Leather',['white', 'brown'],    'Luxury')
    ], { branchKey: 'bedSize' }),

  /* ---- Storage & casegoods ---- */
  'Wardrobe': T('Storage', 'Wardrobe',
    { 'Small': [100, 58, 200], 'Medium': [165, 60, 210], 'Large': [280, 62, 230] }, [
      F('Mesa',    'modern',       'contemporary', 'Wood', ['white', 'grey'],    'Essential'),
      F('Orla',    'scandinavian', 'minimalist',   'Wood', ['natural', 'white'], 'Value'),
      F('Vallon',  'contemporary', 'modern',       'Wood', ['grey', 'black'],    'Standard'),
      F('Belcourt','classic',      'traditional',  'Wood', ['brown', 'white'],   'Premium'),
      F('Aurelio', 'contemporary', 'modern',       'Wood', ['brown'],            'Luxury')
    ], { branchKey: 'doorGroup' }),

  'Bedside Table': T('Storage', 'Bedside Table', { '': [45, 40, 55] }, [
    F('Mesa',    'modern',       'contemporary', 'Wood', ['white', 'black'],   'Essential'),
    F('Orla',    'scandinavian', 'minimalist',   'Wood', ['natural', 'white'], 'Value'),
    F('Kano',    'japandi',      'minimalist',   'Wood', ['natural'],          'Standard'),
    F('Belcourt','classic',      'traditional',  'Wood', ['brown'],            'Premium')
  ]),

  'Chest of Drawers': T('Storage', 'Chest of Drawers', { '': [100, 45, 85] }, [
    F('Mesa',    'modern',       'contemporary', 'Wood', ['white', 'grey'],    'Essential'),
    F('Orla',    'scandinavian', 'minimalist',   'Wood', ['natural', 'white'], 'Value'),
    F('Vallon',  'contemporary', 'modern',       'Wood', ['grey', 'black'],    'Standard'),
    F('Belcourt','classic',      'traditional',  'Wood', ['brown'],            'Premium')
  ]),

  'TV Unit': T('Storage', 'TV Unit', { '': [180, 40, 50] }, [
    F('Mesa',    'modern',       'contemporary', 'Wood',  ['white', 'black'],   'Essential'),
    F('Orla',    'scandinavian', 'minimalist',   'Wood',  ['natural', 'white'], 'Value'),
    F('Kano',    'japandi',      'minimalist',   'Wood',  ['natural'],          'Standard'),
    F('Vallon',  'industrial',   'modern',       'Metal', ['black'],            'Standard'),
    F('Aurelio', 'contemporary', 'modern',       'Wood',  ['brown', 'grey'],    'Premium')
  ]),

  'Sideboard': T('Storage', 'Sideboard', { '': [160, 45, 80] }, [
    F('Mesa',    'modern',       'contemporary', 'Wood', ['white', 'black'],   'Essential'),
    F('Orla',    'scandinavian', 'mcm',          'Wood', ['natural', 'white'], 'Value'),
    F('Belcourt','classic',      'traditional',  'Wood', ['brown'],            'Premium'),
    F('Aurelio', 'contemporary', 'modern',       'Wood', ['grey'],             'Luxury')
  ]),

  'Bookcase': T('Storage', 'Bookcase', { '': [90, 35, 180] }, [
    F('Stac',   'modern',       'minimalist', 'Metal', ['black', 'white'],   'Essential'),
    F('Orla',   'scandinavian', 'minimalist', 'Wood',  ['natural', 'white'], 'Value'),
    F('Kano',   'japandi',      'minimalist', 'Wood',  ['natural'],          'Standard'),
    F('Vallon', 'industrial',   'modern',     'Metal', ['black', 'brown'],   'Premium')
  ]),

  'Storage Cabinet': T('Storage', 'Cabinet', { '': [110, 45, 120] }, [
    F('Mesa',   'modern',       'contemporary', 'Wood', ['white', 'grey'],    'Essential'),
    F('Orla',   'scandinavian', 'minimalist',   'Wood', ['natural', 'white'], 'Value'),
    F('Vallon', 'contemporary', 'modern',       'Wood', ['grey', 'black'],    'Standard'),
    F('Aurelio','contemporary', 'modern',       'Wood', ['brown'],            'Premium')
  ]),

  /* ---- Lighting ---- */
  'Floor Lamp': T('Lighting', 'Floor Lamp', { '': [35, 35, 155] }, [
    F('Pico',   'modern',       'minimalist', 'Metal', ['black', 'white'],  'Essential'),
    F('Lund',   'scandinavian', 'mcm',        'Metal', ['beige', 'brass'],  'Value'),
    F('Nori',   'japandi',      'minimalist', 'Wood',  ['natural'],         'Standard'),
    F('Aurelio','contemporary', 'modern',     'Metal', ['brass', 'black'],  'Premium')
  ]),

  'Table Lamp': T('Lighting', 'Table Lamp', { '': [25, 25, 45] }, [
    F('Pico',   'modern',       'minimalist', 'Metal',   ['black', 'white'],  'Essential'),
    F('Lund',   'scandinavian', 'mcm',        'Ceramic', ['beige', 'white'],  'Value'),
    F('Nori',   'japandi',      'minimalist', 'Ceramic', ['natural', 'green'],'Standard'),
    F('Aurelio','contemporary', 'modern',     'Metal',   ['brass'],           'Premium')
  ]),

  'Task Lamp': T('Lighting', 'Task Lamp', { '': [18, 18, 48] }, [
    F('Task One','modern',       'minimalist', 'Metal', ['black', 'white'], 'Essential'),
    F('Lund',    'scandinavian', 'modern',     'Metal', ['beige', 'brass'], 'Value'),
    F('Vallon',  'industrial',   'modern',     'Metal', ['black'],          'Standard')
  ]),

  'Pendant Light': T('Lighting', 'Pendant Light', { '': [40, 40, 45] }, [
    F('Pico',   'modern',       'minimalist', 'Metal',   ['black', 'white'],  'Essential'),
    F('Lund',   'scandinavian', 'mcm',        'Metal',   ['brass', 'white'],  'Value'),
    F('Nori',   'japandi',      'minimalist', 'Rattan',  ['natural'],         'Standard'),
    F('Aurelio','contemporary', 'modern',     'Glass',   ['silver', 'brass'], 'Premium')
  ]),

  'Chandelier': T('Lighting', 'Chandelier', { '': [70, 70, 80] }, [
    F('Vallon',  'contemporary', 'modern',      'Metal', ['black', 'brass'], 'Value'),
    F('Belcourt','classic',      'traditional', 'Glass', ['gold', 'silver'], 'Premium'),
    F('Aurelio', 'contemporary', 'modern',      'Glass', ['brass'],          'Luxury')
  ]),

  'Wall Light': T('Lighting', 'Wall Light', { '': [20, 15, 30] }, [
    F('Pico', 'modern', 'minimalist', 'Metal', ['black', 'white'], 'Essential'),
    F('Lund', 'scandinavian', 'mcm',  'Metal', ['brass'],          'Value')
  ]),

  /* ---- Rugs & soft furnishings ---- */
  'Rug': T('Rugs', 'Rug',
    { 'Small': [120, 180, 1], 'Medium': [160, 230, 1], 'Large': [200, 300, 1], 'Extra Large': [250, 350, 1] }, [
      F('Mesa',   'modern',       'contemporary', 'Fabric', ['grey', 'beige'],    'Essential'),
      F('Orla',   'scandinavian', 'minimalist',   'Fabric', ['white', 'beige'],   'Value'),
      F('Nori',   'japandi',      'minimalist',   'Fabric', ['natural', 'green'], 'Standard'),
      F('Belvoir','classic',      'traditional',  'Fabric', ['blue', 'red'],      'Premium'),
      F('Aurelio','contemporary', 'modern',       'Fabric', ['beige', 'grey'],    'Luxury')
    ], { branchKey: 'rugSize' }),

  'Cushion': T('Rugs', 'Cushion', { '': [45, 45, 12] }, [
    F('Mesa', 'modern', 'contemporary', 'Fabric', ['grey', 'beige'], 'Essential'),
    F('Nori', 'japandi', 'minimalist',  'Fabric', ['natural', 'green'], 'Value')
  ]),

  'Throw': T('Rugs', 'Throw', { '': [130, 170, 2] }, [
    F('Orla', 'scandinavian', 'minimalist', 'Fabric', ['white', 'beige'], 'Value'),
    F('Nori', 'japandi', 'minimalist', 'Fabric', ['natural'], 'Standard')
  ]),

  /* ---- Decor & accessories ---- */
  'Wall Art': T('Decor', 'Wall Art', { '': [90, 3, 70] }, [
    F('Form',   'modern',       'minimalist',  'Wood',  ['black', 'white'],   'Essential'),
    F('Lund',   'scandinavian', 'minimalist',  'Wood',  ['natural', 'beige'], 'Value'),
    F('Nori',   'japandi',      'minimalist',  'Wood',  ['natural'],          'Standard'),
    F('Belvoir','classic',      'traditional', 'Wood',  ['gold', 'brown'],    'Premium')
  ]),

  'Mirror': T('Decor', 'Mirror', { '': [80, 4, 110] }, [
    F('Form',   'modern',       'minimalist',  'Metal', ['black', 'silver'], 'Essential'),
    F('Lund',   'scandinavian', 'mcm',         'Wood',  ['natural'],         'Value'),
    F('Belvoir','classic',      'traditional', 'Metal', ['gold', 'brass'],   'Premium')
  ]),

  'Vase': T('Decor', 'Vase', { '': [20, 20, 35] }, [
    F('Form', 'modern',   'minimalist', 'Ceramic', ['white', 'black'],   'Essential'),
    F('Nori', 'japandi',  'minimalist', 'Ceramic', ['natural', 'green'], 'Value'),
    F('Lund', 'scandinavian', 'mcm',    'Glass',   ['white', 'beige'],   'Standard')
  ]),

  'Decorative Object': T('Decor', 'Decorative Object', { '': [22, 18, 28] }, [
    F('Form', 'modern', 'minimalist', 'Stone',   ['white', 'black'], 'Value'),
    F('Nori', 'japandi', 'minimalist', 'Ceramic',['natural'],        'Standard')
  ]),

  'Planter': T('Decor', 'Planter', { '': [35, 35, 45] }, [
    F('Form', 'modern',   'minimalist', 'Ceramic', ['white', 'black'],   'Essential'),
    F('Nori', 'japandi',  'minimalist', 'Ceramic', ['natural'],          'Value'),
    F('Lund', 'scandinavian', 'mcm',    'Rattan',  ['natural', 'beige'], 'Standard')
  ])
};

/* Types whose real-world width varies enough that one size is not
   enough to satisfy the preferred-fit bands across room sizes.
   Each scale becomes its own Parent Product (AIP) + variants. */
const SCALED = {
  'Coffee Table': [0.72, 1, 1.3], 'TV Unit': [0.68, 1, 1.42], 'Sideboard': [0.62, 1, 1.42],
  'Console Table': [0.78, 1, 1.3], 'Desk': [0.72, 1, 1.35], 'Chest of Drawers': [0.68, 1, 1.4],
  'Bookcase': [0.68, 1, 1.5], 'Storage Cabinet': [0.62, 1, 1.5], 'Wall Art': [0.5, 1, 1.75],
  'Mirror': [0.6, 1, 1.5], 'Side Table': [0.72, 1, 1.3], 'Bedside Table': [0.72, 1, 1.3],
  'Accent Chair': [0.86, 1, 1.25]
};
const SCALE_SUFFIX = ['Compact', '', 'Wide'];

/* ---------------- Catalogue build ---------------- */

let _seq = { aip: 0, aid: 0, aio: 0 };
const pad = (p, n) => `${p}-${String(n).padStart(8, '0')}`;   // AID-DATA-005 §3

export const PRODUCTS = [];   // canonical variants (AID)
export const OFFERS = [];     // seller offers (AIO)
export const PARENTS = [];    // parent products (AIP)

const rand = rng(20260101);

function buildType(type, spec) {
  const branches = Object.keys(spec.dims);
  const scaleList = SCALED[type] || [1];
  for (const fam of spec.families) {
    for (const branch of branches) {
      for (let si = 0; si < scaleList.length; si++) {
        const scale = scaleList[si];
        const sizeWord = scaleList.length > 1 ? SCALE_SUFFIX[si] : '';
        const parentId = pad('AIP', ++_seq.aip);
        const [bw, bd, bh] = spec.dims[branch];
        const famJitter = 0.94 + rand() * 0.12;               // family-specific scale
        const width  = Math.round(bw * scale * famJitter);
        const depth  = Math.round(bd * (scale > 1 ? 1.08 : scale < 1 ? 0.92 : 1) * (0.96 + rand() * 0.08));
        const height = Math.round(bh * (0.96 + rand() * 0.08));
        const branchLabel = branch || null;
        PARENTS.push({ id: parentId, model: fam.n, type, branch: branchLabel, sizeWord });

        for (const colour of fam.cols) {
          const id = pad('AID', ++_seq.aid);
          const range = priceRange(type, branchLabel, fam.tier) || [100, 300];
          const frac = 0.25 + rand() * 0.5;
          /* Larger physical sizes cost more inside the same tier band. */
          const sizeFactor = scale > 1 ? 1.12 : scale < 1 ? 0.9 : 1;
          const raw = (range[0] + frac * (range[1] - range[0])) * sizeFactor;
          const basePrice = Math.max(range[0], Math.round(raw / 5) * 5);

          const attrs = {};
          if (type === 'Sofa') attrs.seats = Number(branch);
          if (type === 'Bed') attrs.bedSize = branch;
          if (type === 'Dining Table') attrs.capacity = Number(branch);
          if (type === 'Wardrobe') attrs.doorGroup = branch;
          if (type === 'Rug') attrs.rugSize = branch;
          if (type === 'Office Chair') attrs.adjustable = true;
          if (type === 'Desk') attrs.cableManagement = rand() > .4;

          const branchWord = branchLabel && !['Rug', 'Wardrobe'].includes(type)
            ? ` ${branchLabel}${type === 'Sofa' ? '-Seater' : type === 'Dining Table' ? '-Person' : ''}`
            : '';

          PRODUCTS.push({
            id, parentId,
            name: `${fam.n} ${type}${branchWord}${sizeWord ? ' ' + sizeWord : ''}`,
            mainCategory: spec.main, category: spec.cat, type,
            branch: branchLabel,
            primaryStyle: fam.style, secondaryStyle: fam.sec,
            primaryColour: colour, secondaryColour: null,
            specificColour: null,
            material: fam.mat,
            width, depth, height,
            attrs,
            priceTier: fam.tier,
            basePrice,
            dataStatus: 'Verified',          // AID-DATA-014
            lifecycle: 'Active'
          });
        }
      }
    }
  }
}

for (const [type, spec] of Object.entries(TYPE_SPEC)) buildType(type, spec);

/* ---------------- Seller offers (AIO) — AID-DATA-010 / 011 ---------------- */
for (const p of PRODUCTS) {
  const n = 1 + (rand() < 0.45 ? 1 : 0);
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let partner;
    do { partner = PARTNERS[Math.floor(rand() * PARTNERS.length)]; } while (used.has(partner.id));
    used.add(partner.id);

    const variance = 0.93 + rand() * 0.16;
    const sellingPrice = Math.max(20, Math.round((p.basePrice * variance) / 5) * 5);
    const hasDiscount = rand() < 0.25;
    const originalPrice = hasDiscount ? Math.round((sellingPrice * (1.1 + rand() * 0.25)) / 5) * 5 : null;

    const r = rand();
    const availability = r < 0.72 ? 'In Stock' : r < 0.9 ? 'Low Stock' : 'Out of Stock';
    const onDisplay = availability !== 'Out of Stock' && rand() < 0.62;
    const viewable = availability !== 'Out of Stock';           // AID-LOG-012: viewable on request
    const deliveryDays = [2, 3, 5, 7, 10, 14][Math.floor(rand() * 6)];

    OFFERS.push({
      id: pad('AIO', ++_seq.aio),
      productId: p.id,
      partnerId: partner.id,
      sellerSku: `${partner.id.slice(-3)}-${p.id.slice(-5)}`,
      sellingPrice, originalPrice,
      currency: 'AED',
      availability,
      stockQty: availability === 'In Stock' ? 2 + Math.floor(rand() * 20) : availability === 'Low Stock' ? 1 : 0,
      onDisplay,
      viewable,
      viewingStatus: onDisplay ? 'On Display' : viewable ? 'Viewable on Request' : 'Not Viewable',
      deliveryDays,
      commissionRate: partner.commission,
      offerStatus: 'Active'
    });
  }
}

/* ---------------- Indexes & lookups ---------------- */
export const productById = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
export const partnerById = Object.fromEntries(PARTNERS.map(p => [p.id, p]));
export const offerById   = Object.fromEntries(OFFERS.map(o => [o.id, o]));

const offersByProduct = {};
for (const o of OFFERS) (offersByProduct[o.productId] ||= []).push(o);

const byType = {};
for (const p of PRODUCTS) (byType[p.type] ||= []).push(p);

/** Verified + Active canonical products of a type (optionally one branch). */
export function candidates(type, branch) {
  return (byType[type] || []).filter(p =>
    p.dataStatus === 'Verified' && p.lifecycle === 'Active' &&
    (branch == null || p.branch === String(branch))
  );
}

/** Eligible seller offers for a product (AID-DATA-011 + MVP acceptance gate). */
export function eligibleOffers(productId) {
  return (offersByProduct[productId] || []).filter(o =>
    o.offerStatus === 'Active' && o.availability !== 'Out of Stock' && o.stockQty > 0
  );
}

/** Cheapest eligible offer, used as the default purchasable offer for a product. */
export function bestOffer(productId) {
  const list = eligibleOffers(productId);
  if (!list.length) return null;
  return list.slice().sort((a, b) =>
    a.sellingPrice - b.sellingPrice ||
    (b.onDisplay - a.onDisplay) ||
    a.deliveryDays - b.deliveryDays
  )[0];
}

export const PRODUCT_TYPES = Object.keys(TYPE_SPEC);

export const catalogueStats = () => ({
  parents: PARENTS.length,
  products: PRODUCTS.length,
  offers: OFFERS.length,
  partners: PARTNERS.length,
  types: PRODUCT_TYPES.length
});

export { tierOfPrice, TIERS };
