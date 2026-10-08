import fs from 'node:fs';
import path from 'node:path';
import { PRODUCT_TYPES, PRODUCT_TYPE_AR } from '../src/projects/productTypes.ts';
import {
  BED_SIZES,
  COLOUR_OPTIONS,
  PATH_IDS,
  SLEEPING_SETUPS,
  STYLE_OPTIONS,
  TIER_NAMES,
  SPACE_FIELDS,
} from '../src/projects/wizard.ts';
import { ar } from '../src/i18n/catalogue.ar.ts';
import { en } from '../src/i18n/catalogue.en.ts';

const keys = Object.keys(en);
const SRC = path.resolve(__dirname, '../src');
const files = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? files(path.join(dir, e.name))
        : e.name.endsWith('.tsx')
          ? [path.join(dir, e.name)]
          : [],
    );
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catalogue completeness (both languages, every screen)', () => {
  it('English and Arabic have exactly the same keys', () => {
    expect(Object.keys(ar).sort()).toEqual([...keys].sort());
  });

  it('every translation fills the same {placeholders} as the English', () => {
    for (const k of keys)
      expect(placeholders(ar[k as keyof typeof ar])).toEqual(
        placeholders(en[k as keyof typeof en]),
      );
  });

  it('Arabic is Arabic: it contains Arabic script (product names of brands aside)', () => {
    for (const k of keys) {
      const v = ar[k as keyof typeof ar];
      if (/^signIn\.(apple|google)$/.test(k)) continue;
      expect(v).toMatch(/[؀-ۿ]/);
    }
  });

  it("every static t('key') used by a screen exists", () => {
    const used = new Set<string>();
    for (const f of files(SRC)) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g))
        used.add(m[1] as string);
    }
    expect(used.size).toBeGreaterThan(40);
    expect([...used].filter((k) => !(k in en))).toEqual([]);
  });

  it('every value a screen can show through a prefix has a key (styles, colours, tiers, paths…)', () => {
    const need: string[] = [
      ...STYLE_OPTIONS.map((v) => `style.${v}`),
      ...COLOUR_OPTIONS.map((v) => `colour.${v}`),
      ...TIER_NAMES.flatMap((v) => [`tier.${v}`, `tierBlurb.${v}`]),
      ...BED_SIZES.map((v) => `bed.${v}`),
      ...BED_SIZES.map((v) => `branchSize.${v}`),
      ...SLEEPING_SETUPS.map((v) => `setup.${v}`),
      ...PATH_IDS.flatMap((v) => [`path.${v}.title`, `path.${v}.desc`]),
      ...['Compact', 'Small', 'Medium', 'Large', 'Extra Large'].flatMap((v) => [
        `size.${v}`,
        `branchSize.${v}`.replace('Compact', 'Small'),
      ]),
      ...['Draft', 'In Progress', 'Ready for Recommendation'].map((v) => `state.${v}`),
      ...['best_overall', 'best_value', 'best_style', 'premium'].flatMap((v) => [
        `objective.${v}`,
        `objectiveBlurb.${v}`,
      ]),
      ...['price_changed', 'unavailable', 'below_standard'].map((v) => `stale.${v}`),
      ...['On Display', 'Viewable on Request', 'Not Viewable'].map((v) => `viewing.${v}`),
      ...['In Stock', 'Low Stock', 'Out of Stock'].map((v) => `availability.${v}`),
      ...PRODUCT_TYPES.map((p) => `productType.${p.type}`),
      ...['wizard.space', 'wizard.taste', 'wizard.budget'],
      ...['required', 'invalid', 'range'].map((v) => `error.${v}`),
      ...[...new Set(PATH_IDS.flatMap((p) => SPACE_FIELDS[p]))]
        .filter((k) => k !== 'bedSizes' && k !== 'bedroomAreasM2' && k !== 'branch')
        .map((k) => `field.${k}`),
      ...['style', 'colour', 'tier'].map((k) => `field.${k}`),
      ...PRODUCT_TYPES.filter((p) => p.branches).map((p) => `branch.${p.type}`),
    ];
    expect(need.filter((k) => !(k in en))).toEqual([]);
  });

  it('every product type has an Arabic name', () => {
    for (const p of PRODUCT_TYPES) expect(PRODUCT_TYPE_AR[p.type]).toBeTruthy();
  });

  it('no screen hard-codes user-facing text (JSX text and label props must come from the catalogue)', () => {
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      const text = fs.readFileSync(f, 'utf8');
      // Literal text between tags, e.g. <Text>Hello</Text>, or title="Hello" / label="Hello" / message="Hello".
      for (const m of text.matchAll(
        /<[A-Z][A-Za-z.]*[^<>{}]*>\s*([A-Za-z][A-Za-z ,.!?']{2,})\s*<\//g,
      ))
        offenders.push(`${path.basename(f)}: ${m[1]}`);
      for (const m of text.matchAll(
        /\b(?:title|label|message|subtitle|accessibilityLabel)="([A-Za-z][^"]*)"/g,
      ))
        offenders.push(`${path.basename(f)}: ${m[1]}`);
    }
    // The language names are shown in their own language on purpose, and the brand is a wordmark.
    expect(offenders.filter((o) => !/AiDOOi|English|العربية/.test(o))).toEqual([]);
  });
});
