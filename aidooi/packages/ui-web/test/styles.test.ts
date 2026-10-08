import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(import.meta.dirname, '../src/styles.css'), 'utf8');
/** Comments may legitimately mention the forbidden things; only real declarations count. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('GATE: the stylesheet follows the design system', () => {
  it('uses no raw colours: everything comes from the design tokens', () => {
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(code.match(/\b(?:rgb|rgba|hsl|hsla)\(/g) ?? []).toEqual([]);
  });

  it('uses only logical properties, so one stylesheet serves LTR and RTL', () => {
    const physical = [
      /\b(?:margin|padding|border)-(?:left|right)\b/,
      /\b(?:border-(?:top|bottom)-(?:left|right)-radius)\b/,
      /(?:^|[;{\s])(?:left|right|top|bottom)\s*:/,
      /\btext-align\s*:\s*(?:left|right)\b/,
      /\bfloat\s*:\s*(?:left|right)\b/,
      /(?:^|[;{\s])(?:width|height|min-width|min-height|max-width|max-height)\s*:/,
      /\b(?:margin|padding)\s*:\s*[^;]*\b(?:left|right)\b/,
    ];
    for (const re of physical) {
      const lines = code.split('\n').filter((l) => re.test(l));
      expect(lines, `physical property matched ${re}`).toEqual([]);
    }
  });

  it('every referenced token variable exists in the generated tokens.css', () => {
    const tokens = readFileSync(
      path.resolve(import.meta.dirname, '../../ui-tokens/tokens.css'),
      'utf8',
    );
    const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
    const used = [
      ...new Set([...code.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1] as string)),
    ];
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });

  it('overlays give a sheet a definite track, so a tall drawer scrolls its body and keeps its footer on screen', () => {
    // Found by the seller portal's browser test: jsdom has no layout, so this is pinned in the source.
    const overlay = /\.ui-overlay\s*\{([^}]*)\}/.exec(code)?.[1] ?? '';
    expect(overlay).toMatch(/grid-template\s*:\s*minmax\(0,\s*1fr\)\s*\/\s*minmax\(0,\s*1fr\)/);
  });

  it('respects reduced motion and defines a visible focus style', () => {
    expect(code).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(code).toMatch(/:focus-visible\s*\{[^}]*outline/);
  });

  it('component sources do not hard-code colours or physical directions in inline styles', () => {
    const dir = path.resolve(import.meta.dirname, '../src/components');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], f).toEqual([]);
      expect(
        src.match(/\b(?:marginLeft|marginRight|paddingLeft|paddingRight|left:|right:)/g) ?? [],
        f,
      ).toEqual([]);
    }
  });
});
