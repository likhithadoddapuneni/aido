/**
 * Controlled compatibility maps (AID-LOG-009 §5, §6, §12). Style and colour scores come from
 * these maps and nowhere else — never from free model interpretation.
 *
 * These maps are authored by AIDOOi and versioned; the version is stamped on every
 * recommendation run so a result can always be explained against the map that produced it.
 * AIDOOi merchandising must sign off the first-draft values below before launch (docs/adrs.md, gap 5).
 */
import type {
  ColourId,
  ColourPreference,
  MaterialFamily,
  StyleId,
  StylePreference,
} from './vocab.ts';

export const COMPAT_MAP_VERSION = '2026.1-draft';

/** 1.00 same style · 0.70 strong · 0.50 partial · 0.00 clear conflict. Omitted pairs: partial. */
const STYLE_COMPAT: Readonly<Record<StyleId, Partial<Record<StyleId, number>>>> = {
  modern: {
    contemporary: 0.7,
    mcm: 0.7,
    minimalist: 0.7,
    scandinavian: 0.5,
    japandi: 0.5,
    industrial: 0.5,
    classic: 0,
    traditional: 0,
  },
  contemporary: {
    modern: 0.7,
    minimalist: 0.7,
    scandinavian: 0.5,
    japandi: 0.5,
    mcm: 0.5,
    industrial: 0.5,
    classic: 0.5,
    traditional: 0,
  },
  mcm: {
    modern: 0.7,
    scandinavian: 0.7,
    contemporary: 0.5,
    minimalist: 0.5,
    japandi: 0.5,
    industrial: 0.5,
    classic: 0,
    traditional: 0,
  },
  scandinavian: {
    minimalist: 0.7,
    japandi: 0.7,
    mcm: 0.7,
    modern: 0.5,
    contemporary: 0.5,
    industrial: 0.5,
    classic: 0,
    traditional: 0,
  },
  minimalist: {
    scandinavian: 0.7,
    japandi: 0.7,
    modern: 0.7,
    contemporary: 0.7,
    mcm: 0.5,
    industrial: 0.5,
    classic: 0,
    traditional: 0,
  },
  japandi: {
    scandinavian: 0.7,
    minimalist: 0.7,
    modern: 0.5,
    contemporary: 0.5,
    mcm: 0.5,
    industrial: 0,
    classic: 0,
    traditional: 0,
  },
  industrial: {
    modern: 0.5,
    contemporary: 0.5,
    mcm: 0.5,
    minimalist: 0.5,
    scandinavian: 0.5,
    classic: 0,
    traditional: 0,
    japandi: 0,
  },
  classic: {
    traditional: 0.7,
    contemporary: 0.5,
    modern: 0,
    mcm: 0,
    scandinavian: 0,
    minimalist: 0,
    japandi: 0,
    industrial: 0,
  },
  traditional: {
    classic: 0.7,
    contemporary: 0,
    modern: 0,
    mcm: 0,
    scandinavian: 0,
    minimalist: 0,
    japandi: 0,
    industrial: 0,
  },
};

/** AID-LOG-009 §5 — Style Match score, 0–100. */
export function styleScore(
  preferred: StylePreference | undefined,
  primary: StyleId,
  secondary: StyleId | null,
): number {
  if (!preferred || preferred === 'assisted') return 85;
  if (primary === preferred) return 100;
  if (secondary === preferred) return 85;
  const rel = STYLE_COMPAT[preferred][primary] ?? 0.5;
  if (rel >= 0.7) return 70;
  if (rel >= 0.5) return 50;
  return 0;
}

const NEUTRALS: ReadonlySet<ColourId> = new Set([
  'white',
  'beige',
  'grey',
  'black',
  'natural',
  'silver',
]);

const COLOUR_COMPAT: Readonly<Record<ColourId, readonly ColourId[]>> = {
  white: ['beige', 'natural', 'grey', 'blue', 'green'],
  beige: ['white', 'natural', 'brown', 'green', 'brass', 'gold'],
  grey: ['white', 'black', 'blue', 'silver', 'natural'],
  black: ['grey', 'white', 'brass', 'bronze', 'natural'],
  brown: ['beige', 'natural', 'green', 'brass', 'orange', 'bronze'],
  natural: ['beige', 'white', 'brown', 'green', 'black'],
  green: ['natural', 'beige', 'brown', 'brass', 'white'],
  blue: ['white', 'grey', 'natural', 'brass', 'beige'],
  red: ['beige', 'natural', 'brass', 'brown'],
  orange: ['brown', 'beige', 'natural', 'green'],
  yellow: ['grey', 'natural', 'white', 'brown'],
  pink: ['beige', 'white', 'grey', 'natural'],
  purple: ['grey', 'white', 'silver'],
  gold: ['beige', 'white', 'black', 'green'],
  silver: ['grey', 'white', 'blue', 'black'],
  brass: ['beige', 'green', 'brown', 'blue', 'black'],
  bronze: ['brown', 'black', 'beige', 'natural'],
  multicolour: [],
};

/** AID-LOG-009 §6 — Colour Match score, 0–100. */
export function colourScore(
  preferred: ColourPreference | undefined,
  primary: ColourId,
  secondary: ColourId | null,
): number {
  if (!preferred || preferred === 'assisted') return 85;
  if (primary === preferred) return 100;
  if (secondary === preferred) return 85;
  if (COLOUR_COMPAT[preferred].includes(primary)) return 70;
  if (NEUTRALS.has(primary)) return 50;
  return 0;
}

const MATERIAL_COMPAT: Readonly<Record<MaterialFamily, readonly MaterialFamily[]>> = {
  Wood: ['Wood', 'Fabric', 'Leather', 'Rattan', 'Stone', 'Metal', 'Ceramic', 'Glass'],
  Metal: ['Metal', 'Glass', 'Wood', 'Leather', 'Stone', 'Fabric'],
  Fabric: ['Fabric', 'Wood', 'Metal', 'Rattan', 'Leather'],
  Leather: ['Leather', 'Wood', 'Metal', 'Fabric', 'Stone'],
  Glass: ['Glass', 'Metal', 'Wood', 'Stone'],
  Stone: ['Stone', 'Wood', 'Metal', 'Glass', 'Leather'],
  Rattan: ['Rattan', 'Wood', 'Fabric', 'Ceramic'],
  Ceramic: ['Ceramic', 'Wood', 'Rattan', 'Stone', 'Metal'],
};

/** Pairwise material compatibility, 0–100 (feeds AID-LOG-010 §11). */
export function materialPairScore(a: MaterialFamily, b: MaterialFamily): number {
  if (a === b) return 100;
  return MATERIAL_COMPAT[a].includes(b) ? 85 : 40;
}

/**
 * The maps as plain data, for persistence. The API stores each under `catalogue.compat_map_version`,
 * requires a named approver, and refuses to run a recommendation unless the version in this code
 * is the approved, active one — so the sign-off gate is enforced by the system, not a checklist.
 */
export const COMPAT_MAPS = {
  style: STYLE_COMPAT,
  colour: { compatible: COLOUR_COMPAT, neutrals: [...NEUTRALS].sort() },
  material: MATERIAL_COMPAT,
} as const;
