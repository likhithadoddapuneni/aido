/**
 * Differential test against the reviewed MVP prototype (../../../../mvp). The prototype is the
 * only executable reading of the standards we have, so the production engine must agree with it
 * everywhere except where a prototype defect was deliberately fixed (docs/adrs.md,
 * ADR-032 and ADR-034). Skipped when the prototype is not checked out next to this repo.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runRecommendation, type RoomProject } from '../src/index.ts';
import { seedCatalogue } from '../src/testing/index.ts';

const MVP_DIR = path.resolve(import.meta.dirname, '../../../../mvp/js');
const available = existsSync(path.join(MVP_DIR, 'engine.js'));

interface MvpItem {
  product: { id: string };
  offer: { id: string };
  total: number;
  slot: { key: string };
}
interface MvpOption {
  key: string;
  valid: boolean;
  score?: number;
  total: number;
  items: MvpItem[];
}
interface MvpRun {
  status: string;
  options: MvpOption[];
  cls: string;
  range: [number, number];
}

const CASES: { name: string; mvp: Record<string, unknown>; next: RoomProject }[] = [];
const rooms = [
  ['livingRoom', 5, 4, {}],
  ['livingRoom', 7, 5, {}],
  ['livingRoom', 4, 3, {}],
  ['livingRoom', 9, 6, {}],
  ['bedroom', 4, 3.5, { bedSize: 'Queen' }],
  ['bedroom', 5, 4, { bedSize: 'King' }],
  ['bedroom', 3.2, 3, { bedSize: 'Single' }],
  ['diningRoom', 4, 3.5, { capacity: 4 }],
  ['diningRoom', 5, 4, { capacity: 6 }],
  ['diningRoom', 6, 5, { capacity: 8 }],
  ['homeOffice', 3, 3, { users: 1 }],
  ['homeOffice', 4, 3.5, { users: 2 }],
] as const;
const tiers = ['Essential', 'Value', 'Standard', 'Premium', 'Luxury'] as const;
const prefs = [
  ['modern', 'grey'],
  ['scandinavian', 'beige'],
  ['classic', 'brown'],
  ['assisted', 'assisted'],
] as const;
for (const [p, l, w, extra] of rooms) {
  for (const tier of tiers) {
    const [style, colour] = prefs[(CASES.length + tiers.indexOf(tier)) % prefs.length] as readonly [
      string,
      string,
    ];
    CASES.push({
      name: `${p} ${l}x${w} ${tier} ${style}/${colour}`,
      mvp: { pathId: p, tier, style, colour, spec: { length: l, width: w, ...extra } },
      next: {
        path: p,
        tier,
        style,
        colour,
        spec: { lengthM: l, widthM: w, ...extra },
      } as RoomProject,
    });
  }
}

describe.skipIf(!available)('engine vs MVP prototype', async () => {
  const mvp = available
    ? ((await import(pathToFileURL(path.join(MVP_DIR, 'engine.js')).href)) as {
        runRecommendation(p: unknown): MvpRun;
      })
    : null;
  const { catalogue } = seedCatalogue();

  if (mvp) {
    const dir = pathToFileURL(MVP_DIR).href;
    const eng = (await import(`${dir}/engine.js`)) as {
      OBJECTIVES: {
        premium: {
          pick: (c: {
            total: number;
            product: { type: string; branch: string | null };
            offer: { sellingPrice: number };
          }) => number;
        };
      };
    };
    const std = (await import(`${dir}/standards.js`)) as {
      TIERS: string[];
      tierOfPrice: (type: string, branch: string | null, price: number) => string;
    };
    eng.OBJECTIVES.premium.pick = (c) =>
      c.total +
      std.TIERS.indexOf(std.tierOfPrice(c.product.type, c.product.branch, c.offer.sellingPrice)) *
        4;
  }

  it('seed catalogue is identical to the prototype catalogue', async () => {
    const cat = (await import(pathToFileURL(path.join(MVP_DIR, 'catalogue.js')).href)) as {
      PRODUCTS: { id: string; width: number; basePrice: number }[];
      OFFERS: { id: string; sellingPrice: number; productId: string }[];
    };
    expect(catalogue.products.length).toBe(cat.PRODUCTS.length);
    expect(catalogue.offers.length).toBe(cat.OFFERS.length);
    for (let i = 0; i < cat.PRODUCTS.length; i++) {
      expect(catalogue.products[i]?.id).toBe(cat.PRODUCTS[i]?.id);
      expect(catalogue.products[i]?.widthCm).toBe(cat.PRODUCTS[i]?.width);
    }
    for (let i = 0; i < cat.OFFERS.length; i++) {
      expect(catalogue.offers[i]?.id).toBe(cat.OFFERS[i]?.id);
      expect(catalogue.offers[i]?.sellingPrice).toBe((cat.OFFERS[i]?.sellingPrice ?? 0) * 100);
    }
  });

  for (const c of CASES) {
    it(c.name, () => {
      const a = mvp!.runRecommendation(c.mvp);
      const b = runRecommendation(c.next, catalogue);
      expect(b.geometry.sizeClass).toBe(a.cls);
      expect(b.status).toBe(a.status);
      const aOpts = a.options;
      const bOpts = b.options;
      expect(bOpts.map((o) => o.key)).toEqual(aOpts.map((o) => o.key));
      for (const [i, o] of bOpts.entries()) {
        const m = aOpts[i] as MvpOption;
        expect(o.valid && o.score).toBe(m.score);
        expect(o.total).toBe(m.total * 100);
        expect(o.items.map((it) => [it.slot.key, it.product.id, it.offer.id])).toEqual(
          m.items.map((it) => [it.slot.key, it.product.id, it.offer.id]),
        );
      }
    });
  }
});
