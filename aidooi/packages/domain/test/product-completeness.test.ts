import { describe, expect, it } from 'vitest';
import { checkProductCompleteness, type ProductDraft } from '../src/index.ts';

const ok: ProductDraft = {
  name: 'Mesa Sofa 3-Seater',
  type: 'Sofa',
  widthCm: 215,
  depthCm: 92,
  heightCm: 82,
  primaryColour: 'grey',
  material: 'Fabric',
  primaryStyle: 'modern',
  attrs: { seats: 3 },
};

describe('checkProductCompleteness (AID-DATA-014)', () => {
  it('accepts a complete product', () => {
    expect(checkProductCompleteness(ok)).toEqual({ missing: [], invalid: [], complete: true });
  });
  it('lists every missing mandatory field', () => {
    const r = checkProductCompleteness({
      ...ok,
      name: ' ',
      widthCm: null,
      primaryColour: null,
      material: null,
      primaryStyle: null,
    });
    expect(r.missing).toEqual(['name', 'widthCm', 'primaryColour', 'material', 'primaryStyle']);
    expect(r.complete).toBe(false);
  });
  it('rejects values outside controlled vocabularies or non-positive dimensions', () => {
    const r = checkProductCompleteness({
      ...ok,
      primaryColour: 'teal',
      material: 'Plastic',
      depthCm: 0,
      secondaryStyle: 'baroque',
    });
    expect([...r.invalid].sort()).toEqual([
      'depthCm',
      'material',
      'primaryColour',
      'secondaryStyle',
    ]);
  });
  it('a type with a price branch must carry it; an unpriced type is invalid', () => {
    expect(checkProductCompleteness({ ...ok, attrs: {} }).missing).toContain('attributes.branch');
    expect(checkProductCompleteness({ ...ok, type: 'Floor Lamp', attrs: {} }).complete).toBe(true);
    expect(checkProductCompleteness({ ...ok, type: 'Hovercraft' }).invalid).toContain('type');
  });
});
