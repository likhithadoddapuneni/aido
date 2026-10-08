import { describe, expect, it } from 'vitest';
import { branchOf, hasPriceRow, priceRange, TIERS } from '../src/index.ts';
import { seedCatalogue } from '../src/testing/index.ts';

describe('branchOf', () => {
  it('derives the price-matrix branch from practical attributes', () => {
    expect(branchOf('Sofa', { seats: 3 })).toBe('3');
    expect(branchOf('Bed', { bedSize: 'King' })).toBe('King');
    expect(branchOf('Dining Table', { capacity: 6 })).toBe('6');
    expect(branchOf('Wardrobe', { doorGroup: 'Large' })).toBe('Large');
    expect(branchOf('Rug', { rugSize: 'Extra Large' })).toBe('Extra Large');
    expect(branchOf('Floor Lamp', {})).toBeNull();
    expect(branchOf('Sofa', {})).toBeNull();
  });

  it('agrees with every product in the seed catalogue (one source of truth)', () => {
    const { catalogue } = seedCatalogue();
    for (const p of catalogue.products) {
      expect(branchOf(p.type, p.attrs), p.name).toBe(p.branch);
      expect(hasPriceRow(p.type), p.type).toBe(true);
      for (const t of TIERS)
        expect(priceRange(p.type, p.branch, t), `${p.type}:${p.branch}`).not.toBeNull();
    }
  });
});
