import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../src');
const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((f) => ({ name: f, text: readFileSync(path.join(SRC, f), 'utf8') }));

/** Strip comments so prose cannot trip the scans. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('design-system discipline (AID-DATA-015)', () => {
  it('scans real files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('GATE: no component hard-codes a colour — every colour comes from the tokens', () => {
    const offenders = files.flatMap((f) => {
      const hits = code(f.text).match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? [];
      return hits.map((h) => `${f.name}: ${h}`);
    });
    expect(offenders).toEqual([]);
  });

  it('GATE: spacing, radius and type sizes are token expressions, not raw numbers (0 and 1 aside)', () => {
    const raw =
      /\b(margin\w*|padding\w*|gap|rowGap|columnGap|borderRadius|border\w*Radius|fontSize|lineHeight|top|bottom|insetInline\w*)\s*:\s*(\d+(\.\d+)?)\b/g;
    const offenders = files
      .filter((f) => f.name !== 'planLayout.ts')
      .flatMap((f) =>
        [...code(f.text).matchAll(raw)]
          .filter((m) => Number(m[2]) > 1)
          .map((m) => `${f.name}: ${m[0]}`),
      );
    expect(offenders).toEqual([]);
  });

  it('GATE: styles are direction-aware — no physical left/right properties outside the plan geometry', () => {
    const physical =
      /\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth|borderLeftColor|borderRightColor|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)\b|\b(left|right)\s*:|textAlign:\s*'(left|right)'/g;
    const offenders = files
      .filter((f) => f.name !== 'ConceptPlan.tsx') // physical drawing coordinates, deliberately not mirrored
      .flatMap((f) => [...code(f.text).matchAll(physical)].map((m) => `${f.name}: ${m[0]}`));
    expect(offenders).toEqual([]);
  });

  it('no component fixes a font family: type goes through Text and the locale-aware font picker', () => {
    const offenders = files
      .filter(
        (f) =>
          !['Text.tsx', 'Field.tsx', 'OtpField.tsx', 'fonts.ts'].includes(path.basename(f.name)),
      )
      .filter((f) => /fontFamily\s*:\s*['"]/.test(code(f.text)))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});
