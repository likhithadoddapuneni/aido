import { ProjectInputSchema, type ProjectInput } from '@aidooi/contracts';
import { toLatinDigits } from '@aidooi/ui-native';

/** The eight AID-SPC paths, in the order a buyer is offered them. */
export const PATH_IDS = [
  'livingRoom',
  'bedroom',
  'diningRoom',
  'homeOffice',
  'studio',
  'fullApartment',
  'villa',
  'individualProduct',
] as const;
export type PathId = (typeof PATH_IDS)[number];

export const isPathId = (v: string): v is PathId => (PATH_IDS as readonly string[]).includes(v);

/** Paths that are a whole property: they take a total budget, and rooms are budgeted from it. */
export const MULTI_ROOM: readonly PathId[] = ['studio', 'fullApartment', 'villa'];
export const isMultiRoom = (p: PathId): boolean => MULTI_ROOM.includes(p);

export const BED_SIZES = ['Single', 'Queen', 'King', 'Super King'] as const;
export const SLEEPING_SETUPS = ['Sofa Bed', 'Single Bed', 'Queen Bed', 'King Bed'] as const;
export const TIER_NAMES = ['Essential', 'Value', 'Standard', 'Premium', 'Luxury'] as const;
export const STYLE_OPTIONS = [
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
export const COLOUR_OPTIONS = [
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

/** What the buyer is typing. Numbers stay as text until validation so half-typed values are not mangled. */
export interface Draft {
  lengthM?: string;
  widthM?: string;
  bedSize?: string;
  capacity?: string;
  users?: string;
  totalAreaM2?: string;
  sleepingSetup?: string;
  bedrooms?: string;
  bedroomAreasM2?: string[];
  bedSizes?: string[];
  livingAreaM2?: string;
  diningCapacity?: string;
  office?: boolean;
  masterBedSize?: string;
  bedroomConsistency?: boolean;
  floors?: string;
  productType?: string;
  branch?: string;
  style?: string;
  colour?: string;
  tier?: string;
  totalBudgetAed?: string;
}
export type DraftKey = keyof Draft;

export const SPACE_FIELDS: Readonly<Record<PathId, readonly DraftKey[]>> = {
  livingRoom: ['lengthM', 'widthM'],
  bedroom: ['lengthM', 'widthM', 'bedSize'],
  diningRoom: ['lengthM', 'widthM', 'capacity'],
  homeOffice: ['lengthM', 'widthM', 'users'],
  studio: ['totalAreaM2', 'sleepingSetup'],
  fullApartment: [
    'bedrooms',
    'bedroomAreasM2',
    'bedSizes',
    'livingAreaM2',
    'diningCapacity',
    'office',
    'bedroomConsistency',
  ],
  villa: [
    'floors',
    'bedrooms',
    'bedroomAreasM2',
    'bedSizes',
    'livingAreaM2',
    'diningCapacity',
    'office',
    'bedroomConsistency',
  ],
  individualProduct: ['productType', 'branch'],
};

/** A multi-room path or an individual product chooses its tier in the wizard; rooms choose it on the budget screen. */
export const wizardSteps = (p: PathId): readonly ('space' | 'taste' | 'budget')[] =>
  isMultiRoom(p) || p === 'individualProduct' ? ['space', 'taste', 'budget'] : ['space', 'taste'];

export const STEP_FIELDS = {
  space: (p: PathId) => SPACE_FIELDS[p],
  taste: () => ['style', 'colour'] as const,
  budget: (p: PathId) =>
    isMultiRoom(p) ? (['tier', 'totalBudgetAed'] as const) : (['tier'] as const),
} as const;

export type FieldProblem = 'required' | 'invalid' | 'range';
export type FieldErrors = Partial<Record<DraftKey, FieldProblem>>;

const BLANK = (s: string | undefined): boolean => s === undefined || s.trim() === '';

/** "4,5" and Arabic-Indic digits are both normal ways to type a measurement. */
export function parseNumber(s: string | undefined): number | undefined {
  if (BLANK(s)) return undefined;
  const n = Number(
    toLatinDigits(s as string)
      .trim()
      .replace(',', '.'),
  );
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Positional list (master first). Trailing blanks are dropped; a blank before a filled entry is an error. */
function positional<T>(
  list: readonly string[] | undefined,
  map: (s: string) => T,
): { value?: T[]; bad: boolean } {
  if (!list) return { bad: false };
  let last = list.length - 1;
  while (last >= 0 && BLANK(list[last])) last--;
  if (last < 0) return { bad: false };
  const out: T[] = [];
  for (let i = 0; i <= last; i++) {
    if (BLANK(list[i])) return { bad: true };
    out.push(map(list[i] as string));
  }
  return { value: out, bad: false };
}

const FIELD_OF_ISSUE: Readonly<Record<string, DraftKey>> = { totalBudgetFils: 'totalBudgetAed' };

export type BuildResult = { ok: true; input: ProjectInput } | { ok: false; errors: FieldErrors };

/** The request body for a draft, validated by the SAME schema the server uses. */
export function buildInput(pathId: PathId, d: Draft): BuildResult {
  const bad: FieldErrors = {};
  const n = (key: DraftKey, value: string | undefined): number | undefined => {
    const v = parseNumber(value);
    if (v !== undefined && Number.isNaN(v)) {
      bad[key] = 'invalid';
      return undefined;
    }
    return v;
  };
  const areas = positional(d.bedroomAreasM2, (s) => parseNumber(s) ?? Number.NaN);
  if (areas.bad || areas.value?.some(Number.isNaN)) bad.bedroomAreasM2 = 'invalid';
  const sizes = positional(d.bedSizes, (s) => s);
  if (sizes.bad) bad.bedSizes = 'invalid';
  const budgetAed = n('totalBudgetAed', d.totalBudgetAed);

  const candidate: Record<string, unknown> = {
    pathId,
    style: d.style,
    colour: d.colour,
    tier: d.tier,
    lengthM: n('lengthM', d.lengthM),
    widthM: n('widthM', d.widthM),
    bedSize: d.bedSize,
    capacity: n('capacity', d.capacity),
    users: n('users', d.users),
    totalAreaM2: n('totalAreaM2', d.totalAreaM2),
    sleepingSetup: d.sleepingSetup,
    bedrooms: n('bedrooms', d.bedrooms),
    livingAreaM2: n('livingAreaM2', d.livingAreaM2),
    diningCapacity: n('diningCapacity', d.diningCapacity),
    office: d.office ?? false,
    masterBedSize: d.masterBedSize,
    bedroomConsistency: d.bedroomConsistency ?? false,
    floors: n('floors', d.floors),
    productType: d.productType,
    branch: BLANK(d.branch) ? null : d.branch,
    bedroomAreasM2: areas.value,
    bedSizes: sizes.value,
    totalBudgetFils: budgetAed === undefined ? undefined : Math.round(budgetAed * 100),
  };
  for (const k of Object.keys(candidate)) if (candidate[k] === undefined) delete candidate[k];

  const parsed = ProjectInputSchema.safeParse(candidate);
  if (parsed.success && Object.keys(bad).length === 0) return { ok: true, input: parsed.data };

  const errors: FieldErrors = { ...bad };
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const head = String(issue.path[0] ?? '');
      const key = (FIELD_OF_ISSUE[head] ?? head) as DraftKey;
      if (errors[key]) continue;
      // Absent from what we sent is "required", whatever kind of check the schema failed.
      errors[key] =
        candidate[head] === undefined
          ? 'required'
          : issue.code === 'too_small' || issue.code === 'too_big'
            ? 'range'
            : 'invalid';
    }
  }
  return { ok: false, errors };
}

/** Defaults for the steps not reached yet, so validating one step reports only that step's problems. */
const LATER_DEFAULTS: Draft = {
  style: 'assisted',
  colour: 'assisted',
  tier: 'Standard',
  totalBudgetAed: '1000',
};

export function validateStep(
  pathId: PathId,
  d: Draft,
  step: 'space' | 'taste' | 'budget',
): FieldErrors {
  const merged: Draft = { ...LATER_DEFAULTS, ...stripUndefined(d) };
  const r = buildInput(pathId, merged);
  if (r.ok) return {};
  const mine = new Set<DraftKey>(STEP_FIELDS[step](pathId));
  return Object.fromEntries(Object.entries(r.errors).filter(([k]) => mine.has(k as DraftKey)));
}

const stripUndefined = (d: Draft): Draft =>
  Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as Draft;

/** The finished draft, ready to send. Rooms start at Standard; their tier is chosen next, with the real ranges. */
export function finalInput(pathId: PathId, d: Draft): BuildResult {
  return buildInput(pathId, { tier: 'Standard', totalBudgetAed: '1000', ...stripUndefined(d) });
}
