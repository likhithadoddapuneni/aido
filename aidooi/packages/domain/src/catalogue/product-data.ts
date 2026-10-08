import { PRICE_MATRIX } from '../standards/price-matrix.ts';
import { COLOUR_IDS, MATERIAL_FAMILIES, STYLE_IDS } from '../standards/vocab.ts';
import { BRANCHED_TYPES, branchOf } from './branch.ts';
import type { ProductAttrs } from './types.ts';

/**
 * What a seller may state about a product they submit (AID-DATA-001…009, AID-CAT-001…008). Every
 * field is optional here: validation reports what is *wrong* (rejected) separately from what is
 * merely *missing* (the product is saved as Incomplete rather than sent for review).
 */
export interface ProductDataInput {
  readonly name?: string | undefined;
  readonly type?: string | undefined;
  readonly widthCm?: number | undefined;
  readonly depthCm?: number | undefined;
  readonly heightCm?: number | undefined;
  readonly primaryColour?: string | undefined;
  readonly secondaryColour?: string | null | undefined;
  readonly specificColour?: string | null | undefined;
  readonly primaryStyle?: string | undefined;
  readonly secondaryStyle?: string | null | undefined;
  readonly material?: string | undefined;
  readonly attributes?: Readonly<Record<string, unknown>> | undefined;
}

export interface FieldError {
  readonly path: string;
  readonly message: string;
}

export interface ProductDataResult {
  /** Present values that break a rule. Any error means the submission is refused. */
  readonly errors: readonly FieldError[];
  /** Mandatory fields not yet supplied. The product may be saved, but only as Incomplete. */
  readonly missing: readonly string[];
}

const MAX_NAME = 120;
const MIN_DIM_CM = 1;
const MAX_DIM_CM = 600;

/** Practical attributes and the product types they apply to. */
const ATTRIBUTE_TYPES: Readonly<Record<keyof ProductAttrs, readonly string[]>> = {
  seats: ['Sofa'],
  bedSize: ['Bed'],
  capacity: ['Dining Table'],
  doorGroup: ['Wardrobe'],
  rugSize: ['Rug'],
  adjustable: ['Office Chair'],
  cableManagement: ['Desk'],
};
const BOOLEAN_ATTRS: ReadonlySet<string> = new Set(['adjustable', 'cableManagement']);

export const PRODUCT_TYPES: readonly string[] = [
  ...new Set(Object.keys(PRICE_MATRIX).map((k) => k.split(':')[0] as string)),
].sort();

/** The branch values the price matrix prices, per branched type. */
export function branchesOf(type: string): readonly string[] {
  return Object.keys(PRICE_MATRIX)
    .filter((k) => k.startsWith(`${type}:`))
    .map((k) => k.slice(type.length + 1));
}

const COLOUR_WORDS = new RegExp(`\\b(${COLOUR_IDS.join('|')})\\b`, 'i');
const PRICE_IN_NAME = /(\baed\b|\bdhs?\b|د\.إ|\$|€|£)|\d\s*(aed|dhs?)\b/i;

/** Controlled characters make a name unrenderable and are a classic injection vector. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const isIn = (list: readonly string[], v: string) => list.includes(v);

export function validateProductData(input: ProductDataInput): ProductDataResult {
  const errors: FieldError[] = [];
  const missing: string[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  // AID-DATA-001: a name identifies the model; it never carries colour, price or seller.
  if (input.name === undefined || input.name.trim() === '') missing.push('name');
  else {
    const name = input.name.trim();
    if (name.length < 3 || name.length > MAX_NAME)
      err('name', `Name must be 3–${MAX_NAME} characters.`);
    else if (CONTROL_CHARS.test(name)) err('name', 'Name contains control characters.');
    else if (PRICE_IN_NAME.test(name)) err('name', 'Name must not contain a price.');
    else if (COLOUR_WORDS.test(name))
      err('name', 'Name must not contain a colour; record colour in its own field.');
  }

  // AID-DATA-004: the type is one the price standard knows.
  if (input.type === undefined) missing.push('type');
  else if (!isIn(PRODUCT_TYPES, input.type)) err('type', `Unknown product type "${input.type}".`);

  // AID-DATA-006: dimensions in whole centimetres, within a sane envelope.
  for (const [key, label] of [
    ['widthCm', 'Width'],
    ['depthCm', 'Depth'],
    ['heightCm', 'Height'],
  ] as const) {
    const v = input[key];
    if (v === undefined) missing.push(key);
    else if (!Number.isInteger(v) || v < MIN_DIM_CM || v > MAX_DIM_CM) {
      err(
        key,
        `${label} must be a whole number of centimetres between ${MIN_DIM_CM} and ${MAX_DIM_CM}.`,
      );
    }
  }

  // AID-DATA-007: colour families are controlled; the specific shade lives in its own field.
  if (input.primaryColour === undefined) missing.push('primaryColour');
  else if (!isIn(COLOUR_IDS, input.primaryColour))
    err('primaryColour', `"${input.primaryColour}" is not a colour family.`);
  if (input.secondaryColour !== undefined && input.secondaryColour !== null) {
    if (!isIn(COLOUR_IDS, input.secondaryColour))
      err('secondaryColour', `"${input.secondaryColour}" is not a colour family.`);
    else if (input.secondaryColour === input.primaryColour)
      err('secondaryColour', 'Secondary colour must differ from the primary.');
  }
  if (
    input.specificColour !== undefined &&
    input.specificColour !== null &&
    (input.specificColour.length > 60 || CONTROL_CHARS.test(input.specificColour))
  ) {
    err('specificColour', 'Specific colour must be 60 characters or fewer.');
  }

  // AID-DATA-009: styles are the standard vocabulary.
  if (input.primaryStyle === undefined) missing.push('primaryStyle');
  else if (!isIn(STYLE_IDS, input.primaryStyle))
    err('primaryStyle', `"${input.primaryStyle}" is not a standard style.`);
  if (input.secondaryStyle !== undefined && input.secondaryStyle !== null) {
    if (!isIn(STYLE_IDS, input.secondaryStyle))
      err('secondaryStyle', `"${input.secondaryStyle}" is not a standard style.`);
    else if (input.secondaryStyle === input.primaryStyle)
      err('secondaryStyle', 'Secondary style must differ from the primary.');
  }

  // AID-DATA-008: material family.
  if (input.material === undefined) missing.push('material');
  else if (!isIn(MATERIAL_FAMILIES, input.material))
    err('material', `"${input.material}" is not a material family.`);

  validateAttributes(input, err, missing);
  return { errors, missing };
}

function validateAttributes(
  input: ProductDataInput,
  err: (path: string, message: string) => void,
  missing: string[],
): void {
  const attrs = input.attributes ?? {};
  const type = input.type;
  const known = type !== undefined && isIn(PRODUCT_TYPES, type);

  for (const [key, value] of Object.entries(attrs)) {
    const path = `attributes.${key}`;
    const applies = ATTRIBUTE_TYPES[key as keyof ProductAttrs];
    if (!applies) {
      err(path, `"${key}" is not a recognised practical attribute.`);
      continue;
    }
    if (known && !applies.includes(type)) {
      err(path, `"${key}" does not apply to ${type}.`);
      continue;
    }
    if (BOOLEAN_ATTRS.has(key)) {
      if (typeof value !== 'boolean') err(path, `"${key}" must be true or false.`);
      continue;
    }
    // Branch attributes must be a value the price standard actually prices.
    if (known) {
      const branch = branchOf(type, { [key]: value } as ProductAttrs);
      if (branch === null || !branchesOf(type).includes(branch)) {
        err(path, `${type} ${key} must be one of: ${branchesOf(type).join(', ')}.`);
      }
    }
  }

  // A branched type is unpriceable (and so unmatchable) without its branch.
  if (known && (BRANCHED_TYPES as readonly string[]).includes(type)) {
    const attr = Object.entries(ATTRIBUTE_TYPES).find(([, types]) => types.includes(type))?.[0];
    if (attr && attrs[attr] === undefined) missing.push(`attributes.${attr}`);
  }
}

/** The data status a fresh submission earns: Incomplete until everything mandatory is present. */
export const initialDataStatus = (r: ProductDataResult): 'Incomplete' | 'Ready for Review' =>
  r.missing.length === 0 ? 'Ready for Review' : 'Incomplete';
