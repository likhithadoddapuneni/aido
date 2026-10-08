import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { color, font, fontSize, gradient, motion, radius, shadow, space } from '../src/index.ts';

const kebab = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
const vars: string[] = [];
for (const [k, v] of Object.entries(color)) vars.push(`--color-${kebab(k)}: ${v};`);
for (const [k, v] of Object.entries(space)) vars.push(`--space-${k}: ${v}px;`);
for (const [k, v] of Object.entries(radius)) vars.push(`--radius-${k}: ${v}px;`);
for (const [k, v] of Object.entries(shadow)) vars.push(`--shadow-${k}: ${v};`);
for (const [k, v] of Object.entries(font)) vars.push(`--font-${kebab(k)}: ${v};`);
for (const [k, v] of Object.entries(fontSize)) vars.push(`--font-size-${kebab(k)}: ${v}px;`);
for (const [k, v] of Object.entries(gradient))
  vars.push(`--gradient-${k}: linear-gradient(180deg, ${v[0]}, ${v[1]});`);
vars.push(`--motion-easing: ${motion.easing};`);

const css = `/* Generated from src/index.ts by scripts/generate-css.ts. Do not edit. */\n:root {\n  ${vars.join('\n  ')}\n}\n`;
const target = path.resolve(import.meta.dirname, '../tokens.css');

if (process.argv.includes('--check')) {
  const current = (() => {
    try {
      return readFileSync(target, 'utf8');
    } catch {
      return '';
    }
  })();
  if (current !== css) {
    console.error('tokens.css is out of date; run `pnpm --filter @aidooi/ui-tokens generate`');
    process.exit(1);
  }
  console.log('tokens.css is up to date');
} else {
  writeFileSync(target, css);
  console.log(`wrote ${target}`);
}
