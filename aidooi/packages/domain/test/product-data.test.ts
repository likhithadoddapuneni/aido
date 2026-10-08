import { describe, expect, it } from 'vitest';
import {
  COLOUR_IDS,
  MATERIAL_FAMILIES,
  PRODUCT_TYPES,
  STYLE_IDS,
  initialDataStatus,
  validateProductData,
  type ProductDataInput,
} from '../src/index.ts';
import { seedCatalogue } from '../src/testing/index.ts';

const good: ProductDataInput = {
  name: 'Kano Floor Lamp',
  type: 'Floor Lamp',
  widthCm: 35,
  depthCm: 35,
  heightCm: 155,
  primaryColour: 'natural',
  primaryStyle: 'japandi',
  material: 'Wood',
  attributes: {},
};
const paths = (i: ProductDataInput) => validateProductData(i).errors.map((e) => e.path);

describe('product data validation', () => {
  it('accepts a complete, valid product', () => {
    const r = validateProductData(good);
    expect(r).toEqual({ errors: [], missing: [] });
    expect(initialDataStatus(r)).toBe('Ready for Review');
  });

  it('accepts every product in the seed catalogue (the standard agrees with its own data)', () => {
    for (const p of seedCatalogue().catalogue.products) {
      const r = validateProductData({
        name: p.name,
        type: p.type,
        widthCm: p.widthCm,
        depthCm: p.depthCm,
        heightCm: p.heightCm,
        primaryColour: p.primaryColour,
        secondaryColour: p.secondaryColour,
        primaryStyle: p.primaryStyle,
        secondaryStyle: p.secondaryStyle,
        material: p.material,
        attributes: { ...p.attrs },
      });
      expect(r, p.name).toEqual({ errors: [], missing: [] });
    }
  });

  it('missing mandatory fields are not errors: the product is Incomplete', () => {
    const r = validateProductData({ name: 'Orla Sofa', type: 'Sofa' });
    expect(r.errors).toEqual([]);
    expect(r.missing).toEqual(
      expect.arrayContaining([
        'widthCm',
        'depthCm',
        'heightCm',
        'primaryColour',
        'primaryStyle',
        'material',
        'attributes.seats',
      ]),
    );
    expect(initialDataStatus(r)).toBe('Incomplete');
    expect(validateProductData({}).missing).toEqual(
      expect.arrayContaining([
        'name',
        'type',
        'widthCm',
        'primaryColour',
        'primaryStyle',
        'material',
      ]),
    );
  });

  describe('name (AID-DATA-001)', () => {
    it.each([
      ['too short', 'ab'],
      ['too long', 'x'.repeat(121)],
      ['a price', 'Sofa 1200 AED'],
      ['a currency symbol', 'Sofa $99'],
      ['a colour', 'Grey Sofa'],
      ['a control character', 'Sofa\u0007Bell'],
    ])('rejects %s', (_label, name) => {
      expect(paths({ ...good, name })).toEqual(['name']);
    });
    it('does not mistake a model name that merely contains a colour as a substring', () => {
      expect(paths({ ...good, name: 'Greyhound Lamp' })).toEqual([]);
    });
  });

  describe('type', () => {
    it('every priced type is accepted; anything else is refused', () => {
      for (const type of PRODUCT_TYPES) {
        expect(paths({ ...good, type, attributes: {} })).toEqual([]);
      }
      expect(paths({ ...good, type: 'Hovercraft' })).toEqual(['type']);
    });
  });

  describe('dimensions (AID-DATA-006)', () => {
    it.each([
      ['zero', 0],
      ['negative', -5],
      ['fractional', 12.5],
      ['too large', 601],
      ['NaN', Number.NaN],
    ])('rejects a %s width', (_l, widthCm) => {
      expect(paths({ ...good, widthCm })).toEqual(['widthCm']);
    });
    it('accepts the envelope edges', () => {
      expect(paths({ ...good, widthCm: 1, depthCm: 600, heightCm: 1 })).toEqual([]);
    });
  });

  describe('controlled vocabularies', () => {
    it.each(COLOUR_IDS)('colour family %s is accepted', (c) => {
      expect(paths({ ...good, primaryColour: c })).toEqual([]);
    });
    it.each(STYLE_IDS)('style %s is accepted', (s) => {
      expect(paths({ ...good, primaryStyle: s })).toEqual([]);
    });
    it.each(MATERIAL_FAMILIES)('material %s is accepted', (m) => {
      expect(paths({ ...good, material: m })).toEqual([]);
    });
    it('rejects values outside the vocabulary, and a secondary equal to the primary', () => {
      expect(paths({ ...good, primaryColour: 'cognac' })).toEqual(['primaryColour']);
      expect(paths({ ...good, secondaryColour: 'cognac' })).toEqual(['secondaryColour']);
      expect(paths({ ...good, secondaryColour: 'natural' })).toEqual(['secondaryColour']);
      expect(paths({ ...good, primaryStyle: 'baroque' })).toEqual(['primaryStyle']);
      expect(paths({ ...good, secondaryStyle: 'japandi' })).toEqual(['secondaryStyle']);
      expect(paths({ ...good, material: 'Plastic' })).toEqual(['material']);
      expect(paths({ ...good, secondaryColour: null, secondaryStyle: null })).toEqual([]);
    });
  });

  describe('practical attributes (AID-CAT)', () => {
    it.each([
      ['Sofa', { seats: 3 }],
      ['Sofa', { seats: 5 }],
      ['Bed', { bedSize: 'King' }],
      ['Dining Table', { capacity: 8 }],
      ['Wardrobe', { doorGroup: 'Large' }],
      ['Rug', { rugSize: 'Extra Large' }],
      ['Office Chair', { adjustable: true }],
      ['Desk', { cableManagement: false }],
    ])('%s accepts %j', (type, attributes) => {
      expect(validateProductData({ ...good, type, attributes })).toEqual({
        errors: [],
        missing: [],
      });
    });

    it.each([
      ['Sofa', { seats: 7 }, 'attributes.seats'],
      ['Sofa', { seats: 'three' }, 'attributes.seats'],
      ['Bed', { bedSize: 'Emperor' }, 'attributes.bedSize'],
      ['Dining Table', { capacity: 5 }, 'attributes.capacity'],
      ['Wardrobe', { doorGroup: 'Huge' }, 'attributes.doorGroup'],
      ['Rug', { rugSize: 'Tiny' }, 'attributes.rugSize'],
      ['Office Chair', { adjustable: 'yes' }, 'attributes.adjustable'],
      ['Desk', { cableManagement: 1 }, 'attributes.cableManagement'],
      ['Floor Lamp', { seats: 3 }, 'attributes.seats'],
      ['Bed', { capacity: 2 }, 'attributes.capacity'],
      ['Sofa', { colourTemperature: 'warm' }, 'attributes.colourTemperature'],
    ])('%s with %j is refused at %s', (type, attributes, path) => {
      expect(paths({ ...good, type, attributes })).toContain(path);
    });

    it('a branched type without its branch is missing, not wrong', () => {
      for (const [type, attr] of [
        ['Sofa', 'seats'],
        ['Bed', 'bedSize'],
        ['Dining Table', 'capacity'],
        ['Wardrobe', 'doorGroup'],
        ['Rug', 'rugSize'],
      ]) {
        const r = validateProductData({ ...good, type, attributes: {} });
        expect(r.errors).toEqual([]);
        expect(r.missing).toContain(`attributes.${attr}`);
      }
    });
  });

  it('reports every problem at once, with field paths', () => {
    const r = validateProductData({
      ...good,
      name: 'Grey Sofa',
      widthCm: 0,
      primaryColour: 'x',
      material: 'y',
    });
    expect(r.errors.map((e) => e.path).sort()).toEqual([
      'material',
      'name',
      'primaryColour',
      'widthCm',
    ]);
    expect(r.errors.every((e) => e.message.length > 5)).toBe(true);
  });
});
