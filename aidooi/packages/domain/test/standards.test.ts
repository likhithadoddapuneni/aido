import { describe, expect, it } from 'vitest';
import {
  COMPOSITION_WEIGHTS,
  MATCH_WEIGHTS,
  PRICE_MATRIX,
  ROOM_PATHS,
  SIZE_CLASSES,
  STYLE_IDS,
  TIERS,
  aed,
  apartmentBudget,
  capacityBranch,
  colourScore,
  compositionFor,
  priceRange,
  roomBudget,
  sizeClass,
  studioBudget,
  styleScore,
  tierOfPrice,
  villaBudget,
  villaModules,
  materialPairScore,
} from '../src/index.ts';

describe('weights', () => {
  it('Match Score and Composition Score weights each sum to 1', () => {
    expect(Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(Object.values(COMPOSITION_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe('AID-LOG-001 price matrix', () => {
  it.each(Object.entries(PRICE_MATRIX))('%s: five contiguous, increasing tiers', (_k, rows) => {
    expect(rows).toHaveLength(TIERS.length);
    rows.forEach(([lo, hi], i) => {
      expect(hi).toBeGreaterThan(lo);
      if (i > 0) expect(lo).toBe((rows[i - 1] as readonly [number, number])[1]);
    });
  });

  it('tierOfPrice is the inverse of priceRange at every boundary', () => {
    for (const [key, rows] of Object.entries(PRICE_MATRIX)) {
      const [type, branch] = key.split(':') as [string, string | undefined];
      rows.forEach(([lo, hi], i) => {
        expect(tierOfPrice(type, branch ?? null, lo)).toBe(TIERS[i]);
        if (i < rows.length - 1) expect(tierOfPrice(type, branch ?? null, hi)).toBe(TIERS[i + 1]);
      });
    }
    expect(priceRange('Sofa', '3', 'Standard')).toEqual([aed(3000), aed(5000)]);
    expect(tierOfPrice('Sofa', '3', aed(99_999))).toBe('Luxury');
  });
});

describe('size classification', () => {
  it.each([
    ['livingRoom', 11.99, 'Compact'],
    ['livingRoom', 12, 'Small'],
    ['livingRoom', 44.99, 'Large'],
    ['livingRoom', 45, 'Extra Large'],
    ['bedroom', 8.99, 'Compact'],
    ['bedroom', 9, 'Small'],
    ['diningRoom', 25, 'Extra Large'],
    ['homeOffice', 6, 'Small'],
  ] as const)('%s %s m² → %s', (path, area, expected) => {
    expect(sizeClass(path, area)).toBe(expected);
  });

  it('class is monotonic in area', () => {
    for (const path of ROOM_PATHS) {
      let last = -1;
      for (let a = 1; a <= 80; a += 0.5) {
        const idx = SIZE_CLASSES.indexOf(sizeClass(path, a));
        expect(idx).toBeGreaterThanOrEqual(last);
        last = idx;
      }
    }
  });
});

describe('room tables are internally consistent', () => {
  it.each(ROOM_PATHS)('%s: budgets rise with tier and with size class', (path) => {
    for (const cls of SIZE_CLASSES) {
      TIERS.slice(1).forEach((t, i) => {
        const prev = roomBudget(path, cls, TIERS[i] as (typeof TIERS)[number]);
        const cur = roomBudget(path, cls, t);
        expect(cur[0]).toBeGreaterThanOrEqual(prev[1] - 1);
      });
    }
    SIZE_CLASSES.slice(1).forEach((cls, i) => {
      const prev = roomBudget(path, SIZE_CLASSES[i] as (typeof SIZE_CLASSES)[number], 'Standard');
      expect(roomBudget(path, cls, 'Standard')[1]).toBeGreaterThan(prev[1]);
    });
  });

  it.each(ROOM_PATHS)(
    '%s: every composition has exactly one anchor kind and covers essentials',
    (path) => {
      for (const cls of SIZE_CLASSES) {
        const slots = compositionFor(path, cls, { bedSize: 'King', capacity: 6, users: 2 });
        expect(slots.some((s) => s.role === 'anchor' && s.essential)).toBe(true);
        expect(slots.every((s) => s.qty >= 1)).toBe(true);
        // Every priced type used by a composition has a price row at every tier.
        for (const s of slots) {
          for (const tier of TIERS)
            expect(priceRange(s.type, s.branch, tier), `${s.type}:${s.branch}`).not.toBeNull();
        }
      }
    },
  );

  it('dining capacity rounds up to the priced branch; chairs keep the exact capacity (gap #11)', () => {
    expect(capacityBranch(1)).toBe(2);
    expect(capacityBranch(5)).toBe(6);
    expect(capacityBranch(12)).toBe(10);
    const slots = compositionFor('diningRoom', 'Medium', { capacity: 5 });
    expect(slots.find((s) => s.type === 'Dining Table')?.branch).toBe('6');
    expect(slots.find((s) => s.type === 'Dining Chair')?.qty).toBe(5);
  });

  it('beds fit on the selected bed size', () => {
    const queen = compositionFor('bedroom', 'Medium', { bedSize: 'Queen' }).find(
      (s) => s.type === 'Bed',
    );
    const king = compositionFor('bedroom', 'Medium', { bedSize: 'King' }).find(
      (s) => s.type === 'Bed',
    );
    expect(queen?.branch).toBe('Queen');
    expect(king?.w).toEqual([180, 215]);
  });
});

describe('project budgets', () => {
  it('apartment: base by bedroom count + additional-bedroom and office modifiers', () => {
    const base = apartmentBudget({ bedrooms: 2 }, 'Standard');
    expect(base).toEqual([aed(26_000), aed(40_000)]);
    const withOffice = apartmentBudget({ bedrooms: 2, office: true }, 'Standard');
    expect(withOffice[1]).toBeGreaterThan(base[1]);
    const five = apartmentBudget({ bedrooms: 5 }, 'Standard');
    const four = apartmentBudget({ bedrooms: 4 }, 'Standard');
    expect(five[1]).toBeGreaterThan(four[1]);
  });

  it('studio uses the size-class table', () => {
    expect(studioBudget({ totalAreaM2: 30 }, 'Value')).toEqual([aed(8_000), aed(12_000)]);
  });

  it('villa is the sum of its own room modules (no published table, by design)', () => {
    const spec = { bedrooms: 4, floors: 2, office: true };
    const total = villaModules(spec).reduce(
      (t, m) => t + roomBudget(m.path, sizeClass(m.path, m.areaM2), 'Premium')[1],
      0,
    );
    expect(villaBudget(spec, 'Premium')[1]).toBe(total);
  });
});

describe('controlled compatibility maps', () => {
  it('same style 100, secondary 85, conflict 0, assisted 85', () => {
    expect(styleScore('modern', 'modern', null)).toBe(100);
    expect(styleScore('modern', 'classic', 'modern')).toBe(85);
    expect(styleScore('modern', 'classic', null)).toBe(0);
    expect(styleScore('modern', 'contemporary', null)).toBe(70);
    expect(styleScore('modern', 'industrial', null)).toBe(50);
    expect(styleScore('assisted', 'classic', null)).toBe(85);
    expect(styleScore(undefined, 'classic', null)).toBe(85);
  });

  it('every ordered style pair resolves to a defined score', () => {
    for (const a of STYLE_IDS)
      for (const b of STYLE_IDS) expect([0, 50, 70, 85, 100]).toContain(styleScore(a, b, null));
  });

  it('colour: exact 100, compatible 70, neutral 50, conflict 0', () => {
    expect(colourScore('grey', 'grey', null)).toBe(100);
    expect(colourScore('grey', 'blue', null)).toBe(70);
    expect(colourScore('red', 'white', null)).toBe(50);
    expect(colourScore('red', 'green', null)).toBe(0);
    expect(colourScore('assisted', 'green', null)).toBe(85);
  });

  it('material compatibility is symmetric and bounded', () => {
    expect(materialPairScore('Wood', 'Wood')).toBe(100);
    expect(materialPairScore('Wood', 'Fabric')).toBe(materialPairScore('Fabric', 'Wood'));
    expect(materialPairScore('Glass', 'Rattan')).toBe(40);
  });
});

describe('compatibility maps as data', () => {
  it('are exported complete and JSON-serialisable for persistence', async () => {
    const { COMPAT_MAPS, COMPAT_MAP_VERSION } = await import('../src/index.ts');
    expect(COMPAT_MAP_VERSION).toMatch(/^\d{4}\.\d+/);
    expect(Object.keys(COMPAT_MAPS.style).sort()).toEqual([...STYLE_IDS].sort());
    expect(Object.keys(COMPAT_MAPS.colour.compatible)).toHaveLength(18);
    expect(Object.keys(COMPAT_MAPS.material)).toHaveLength(8);
    expect(JSON.parse(JSON.stringify(COMPAT_MAPS))).toEqual(COMPAT_MAPS);
  });
});
