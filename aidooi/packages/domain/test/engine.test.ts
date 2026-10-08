import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MIN_COMPOSITION,
  MIN_FIT,
  MIN_PRODUCT_MATCH,
  TIERS,
  aed,
  alternativesFor,
  applyReplacement,
  availabilityScore,
  budgetScore,
  buildSlots,
  compareCandidates,
  completeness,
  fitScore,
  harmony,
  isEligibleOffer,
  practicalScore,
  rankIndividual,
  removeItem,
  runProject,
  runRecommendation,
  scoreComposition,
  scoreProduct,
  type Item,
  type Offer,
  type Product,
  type RoomProject,
  type RunResult,
  type Slot,
} from '../src/index.ts';
import { seedCatalogue, type InMemoryCatalogue } from '../src/testing/index.ts';

const { catalogue }: { catalogue: InMemoryCatalogue } = seedCatalogue();

const living: RoomProject = {
  path: 'livingRoom',
  tier: 'Standard',
  style: 'modern',
  colour: 'grey',
  spec: { lengthM: 5, widthM: 4 },
};

const slot = (over: Partial<Slot> = {}): Slot => ({
  key: 's#0',
  type: 'Sofa',
  branch: '3',
  qty: 1,
  w: [200, 250],
  role: 'anchor',
  essential: true,
  allocatedTotalFils: aed(4000),
  allocatedFils: aed(4000),
  ...over,
});

const product = (over: Partial<Product> = {}): Product => ({
  ...(catalogue.products.find((p) => p.type === 'Sofa' && p.branch === '3') as Product),
  ...over,
});
const offerFor = (p: Product, over: Partial<Offer> = {}): Offer => ({
  ...(catalogue.offersOf(p.id)[0] as Offer),
  availability: 'In Stock',
  stockQty: 5,
  viewingStatus: 'On Display',
  deliveryDays: 3,
  sellingPrice: aed(4000),
  ...over,
});

describe('fit (AID-LOG-009 §4)', () => {
  const p = (widthCm: number) => product({ widthCm });
  it('within the preferred band scores 100; deviation bands step down; far outside is rejected', () => {
    expect(fitScore(p(225), slot(), null)).toBe(100);
    expect(fitScore(p(190), slot(), null)).toBe(85); // 5% under
    expect(fitScore(p(165), slot(), null)).toBe(70); // 17.5% under
    expect(fitScore(p(130), slot(), null)).toBe(50); // 35% under
    expect(fitScore(p(100), slot(), null)).toBe(0);
  });
  it('an anchor wider than 80% of the longest wall can never fit; other products get 92%', () => {
    const room = { areaM2: 20, sizeClass: 'Small', longestWallCm: 300 } as const;
    expect(fitScore(p(241), slot(), room)).toBe(0);
    expect(fitScore(p(239), slot(), room)).toBeGreaterThan(0);
    expect(fitScore(p(270), slot({ role: 'core' }), room)).toBe(85); // 8% over the band, within 92% of the wall
    expect(fitScore(p(280), slot({ role: 'core' }), room)).toBe(0);
  });
  it('no preferred band → neutral', () => {
    expect(fitScore(p(500), slot({ w: null }), null)).toBe(85);
  });
});

describe('budget / value (AID-LOG-009 §7)', () => {
  it.each([
    [0.85, 100],
    [1.0, 100],
    [1.05, 100],
    [0.7, 90],
    [0.84, 90],
    [1.051, 75],
    [1.2, 75],
    [0.69, 65],
    [0.1, 65],
    [1.21, 50],
    [1.35, 50],
    [1.351, -1],
  ])('price/allocation %s → %s', (ratio, expected) => {
    expect(budgetScore(ratio * 100_000, 100_000)).toBe(expected);
  });
  it('no allocation → neutral', () => expect(budgetScore(1, 0)).toBe(85));
});

describe('availability and practical match', () => {
  const p = product();
  it('ranks stock, display and delivery speed', () => {
    expect(availabilityScore(offerFor(p))).toBe(100);
    expect(availabilityScore(offerFor(p, { viewingStatus: 'Viewable on Request' }))).toBe(85);
    expect(availabilityScore(offerFor(p, { viewingStatus: 'Not Viewable' }))).toBe(70);
    expect(availabilityScore(offerFor(p, { deliveryDays: 9 }))).toBe(70);
    expect(availabilityScore(offerFor(p, { availability: 'Low Stock' }))).toBe(50);
    expect(availabilityScore(offerFor(p, { availability: 'Out of Stock' }))).toBe(-1);
  });
  it('mandatory practical attributes reject; optional ones only rank', () => {
    const bed = catalogue.products.find((x) => x.type === 'Bed' && x.branch === 'King') as Product;
    expect(practicalScore(bed, { bedSize: 'King' })).toBe(100);
    expect(practicalScore(bed, { bedSize: 'Queen' })).toBe(-1);
    const table = catalogue.products.find(
      (x) => x.type === 'Dining Table' && x.branch === '4',
    ) as Product;
    expect(practicalScore(table, { capacity: 4 })).toBe(100);
    expect(practicalScore(table, { capacity: 6 })).toBe(-1);
    const desk = catalogue.products.find((x) => x.type === 'Desk') as Product;
    expect(practicalScore({ ...desk, attrs: { cableManagement: false } }, {})).toBe(85);
  });
});

describe('scoreProduct — hard requirements outrank soft preferences', () => {
  const ctx = { style: 'modern', colour: 'grey', spec: {}, room: null } as const;
  it('a perfect style/colour match cannot rescue a failed fit', () => {
    const p = product({ widthCm: 90, primaryStyle: 'modern', primaryColour: 'grey' });
    const s = scoreProduct(p, offerFor(p), slot(), ctx);
    expect(s.eligible).toBe(false);
    expect(s.total).toBe(0);
    expect(s.rejectedFor).toBe('Fit');
  });
  it('ineligible data never scores, even if an adapter leaks it', () => {
    const p = product({ dataStatus: 'Ready for Review' });
    expect(scoreProduct(p, offerFor(p), slot(), ctx).rejectedFor).toBe('Not eligible');
    const q = product();
    expect(scoreProduct(q, offerFor(q, { offerStatus: 'Inactive' }), slot(), ctx).eligible).toBe(
      false,
    );
    expect(scoreProduct(q, offerFor(q, { stockQty: 0 }), slot(), ctx).eligible).toBe(false);
  });
  it('a score below the minimum match is not eligible', () => {
    const p = product({
      widthCm: 225,
      primaryStyle: 'classic',
      primaryColour: 'red',
      secondaryColour: null,
      secondaryStyle: null,
    });
    const s = scoreProduct(
      p,
      offerFor(p, { availability: 'Low Stock', deliveryDays: 14, sellingPrice: aed(4000 * 1.3) }),
      slot(),
      {
        ...ctx,
        style: 'modern',
        colour: 'green',
      },
    );
    expect(s.total).toBeLessThan(MIN_PRODUCT_MATCH);
    expect(s.eligible).toBe(false);
  });
  it('tie-break is Fit → Style → Availability → Value, then id, so ordering is total', () => {
    const p = product();
    const base = scoreProduct(p, offerFor(p), slot(), ctx);
    const a = { ...base, total: 80, fit: 90, style: 70 };
    const b = { ...base, total: 80, fit: 100, style: 60 };
    expect([a, b].sort(compareCandidates)[0]).toBe(b);
    const c = { ...a, product: { ...p, id: 'AID-00000001' as Product['id'] } };
    const d = { ...a, product: { ...p, id: 'AID-00000002' as Product['id'] } };
    expect([d, c].sort(compareCandidates)[0]).toBe(c);
  });
});

describe('composition scoring', () => {
  it('a single-product composition is harmonious (regression: prototype returned NaN)', () => {
    const run = runRecommendation(living, catalogue);
    const one = (run.options[0]?.items.slice(0, 1) ?? []) as Item[];
    expect(harmony(one).total).toBe(100);
    expect(Number.isNaN(harmony([]).total)).toBe(false);
  });
  it('incomplete essentials invalidate the composition; over-ceiling rejects', () => {
    const run = runRecommendation(living, catalogue);
    const opt = run.options[0] as NonNullable<RunResult['options'][number]>;
    const noAnchor = opt.items.filter((i) => i.slot.role !== 'anchor');
    expect(completeness(noAnchor, opt.slots)).toBe(-1);
    const r = scoreComposition(noAnchor, opt.slots, run.range, opt.ceiling);
    expect(r.valid).toBe(false);
    const tight = scoreComposition(opt.items, opt.slots, run.range, aed(1) as never);
    expect(tight).toMatchObject({ valid: false, reason: 'Over budget ceiling' });
  });
});

describe('runRecommendation', () => {
  it('produces four differentiated, valid options for a well-stocked room', () => {
    const run = runRecommendation(living, catalogue);
    expect(run.status).toBe('Completed');
    expect(run.options.map((o) => o.key)).toEqual([
      'bestOverall',
      'bestValue',
      'bestStyle',
      'premium',
    ]);
    const signatures = run.options.map((o) => o.items.map((i) => i.offer.id).join());
    expect(new Set(signatures).size).toBe(4);
    expect(run.standardsVersion).toBeTruthy();
    expect(run.catalogueVersion).toBe(catalogue.version);
  });

  it('fails clearly, not silently, when room dimensions are missing', () => {
    const run = runRecommendation({ ...living, spec: {} }, catalogue);
    expect(run.status).toBe('Failed');
    expect(run.reason).toMatch(/dimensions/i);
  });

  it('surfaces a blocked essential slot instead of dropping it', () => {
    const noSofas = catalogue.withOffers((o) =>
      catalogue.products.find((p) => p.id === o.productId)?.type === 'Sofa'
        ? { ...o, availability: 'Out of Stock', stockQty: 0 }
        : o,
    );
    const run = runRecommendation(living, noSofas);
    expect(run.status).toBe('Failed');
    expect(run.reason).toMatch(/essential Sofa/);
  });

  it('is deterministic: same inputs, byte-identical output', () => {
    const a = runRecommendation(living, catalogue);
    const b = runRecommendation(living, seedCatalogue().catalogue);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('does not mutate its inputs', () => {
    const frozen = structuredClone(living);
    runRecommendation(living, catalogue);
    expect(living).toEqual(frozen);
  });

  it('never recommends a product that went out of stock (replays against the live catalogue)', () => {
    const run = runRecommendation(living, catalogue);
    const soldOut = new Set(run.options.flatMap((o) => o.items.map((i) => i.offer.id)));
    const after = catalogue.withOffers((o) =>
      soldOut.has(o.id) ? { ...o, availability: 'Out of Stock', stockQty: 0 } : o,
    );
    const rerun = runRecommendation(living, after);
    for (const o of rerun.options)
      for (const i of o.items) expect(soldOut.has(i.offer.id)).toBe(false);
  });

  it('the Premium option is withheld unless it is a meaningful upgrade', () => {
    const run = runRecommendation(living, catalogue);
    const overall = run.options.find((o) => o.key === 'bestOverall');
    const premium = run.options.find((o) => o.key === 'premium');
    if (premium && overall?.valid && premium.valid) {
      expect(premium.score > overall.score + 1 || premium.total > overall.total * 1.05).toBe(true);
    }
  });

  const roomArb = fc.record({
    path: fc.constantFrom('livingRoom', 'bedroom', 'diningRoom', 'homeOffice' as const),
    tier: fc.constantFrom(...TIERS),
    style: fc.constantFrom(
      'modern',
      'scandinavian',
      'classic',
      'japandi',
      'industrial',
      'assisted' as const,
    ),
    colour: fc.constantFrom('grey', 'beige', 'brown', 'blue', 'green', 'assisted' as const),
    lengthM: fc.double({ min: 2.2, max: 9, noNaN: true }),
    widthM: fc.double({ min: 2.2, max: 8, noNaN: true }),
    bedSize: fc.constantFrom('Single', 'Queen', 'King', 'Super King'),
    capacity: fc.integer({ min: 2, max: 10 }),
    users: fc.integer({ min: 1, max: 3 }),
  });

  it('PROPERTY: every recommended product is eligible, fits, and meets the minimums', () => {
    fc.assert(
      fc.property(roomArb, (r) => {
        const run = runRecommendation(
          {
            path: r.path,
            tier: r.tier,
            style: r.style,
            colour: r.colour,
            spec: {
              lengthM: r.lengthM,
              widthM: r.widthM,
              bedSize: r.bedSize,
              capacity: r.capacity,
              users: r.users,
            },
          },
          catalogue,
        );
        if (run.status === 'Failed') {
          expect(run.options).toHaveLength(0);
          return;
        }
        expect(run.options[0]?.key).toBe('bestOverall');
        for (const o of run.options) {
          expect(o.valid).toBe(true);
          if (!o.valid) continue;
          expect(Number.isInteger(o.score)).toBe(true);
          expect(o.score).toBeGreaterThanOrEqual(MIN_COMPOSITION);
          expect(o.score).toBeLessThanOrEqual(100);
          expect(o.total).toBeLessThanOrEqual(o.ceiling);
          for (const i of o.items) {
            expect(isEligibleOffer(i.offer)).toBe(true);
            expect(i.total).toBeGreaterThanOrEqual(MIN_PRODUCT_MATCH);
            expect(i.fit).toBeGreaterThanOrEqual(MIN_FIT);
            expect(i.practical).toBeGreaterThanOrEqual(0);
          }
          const filled = new Set(o.items.map((i) => i.slot.key));
          for (const s of o.slots) if (s.essential) expect(filled.has(s.key)).toBe(true);
          // No product appears twice for the same slot, and quantities match the composition.
          expect(filled.size).toBe(o.items.length);
          for (const i of o.items) expect(i.qty).toBe(i.slot.qty);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('PROPERTY: slot allocations never exceed the budgeted pot', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TIERS),
        fc.integer({ min: 100_000, max: 9_000_000 }),
        (tier, ceiling) => {
          const slots = buildSlots('livingRoom', 'Medium', {}, ceiling as never, tier);
          const total = slots.reduce((t, s) => t + s.allocatedTotalFils, 0);
          expect(total).toBeCloseTo(ceiling * 0.92, 4);
        },
      ),
    );
  });
});

describe('replace and remove (WF-03)', () => {
  const run = () => runRecommendation(living, catalogue);

  it('offers only live, eligible alternatives and excludes the current choice', () => {
    const r = run();
    const opt = r.options[0] as NonNullable<RunResult['options'][number]>;
    const key = opt.items.find((i) => i.slot.type === 'Sofa')?.slot.key as string;
    const alts = alternativesFor(living, opt, key, catalogue);
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.length).toBeLessThanOrEqual(24);
    const current = opt.items.find((i) => i.slot.key === key)?.offer.id;
    expect(alts.every((a) => a.eligible && a.offer.id !== current)).toBe(true);
  });

  it('a replacement is revalidated: accepted when it keeps the composition valid, refused otherwise', () => {
    const r = run();
    const opt = r.options[0] as NonNullable<RunResult['options'][number]>;
    const key = opt.items.find((i) => i.slot.type === 'Side Table')?.slot.key as string;
    const alt = alternativesFor(living, opt, key, catalogue)[0]!;
    const res = applyReplacement(r, opt, key, alt);
    if (res.ok) {
      expect(res.value.modified).toBe(true);
      expect(res.value.items.find((i) => i.slot.key === key)?.offer.id).toBe(alt.offer.id);
      expect(opt.modified).toBe(false); // the original option is untouched
    } else {
      expect(res.error.code).toMatch(/composition_invalid|below_min_match|fails_fit/);
    }
    const weak = { ...alt, total: 59 };
    expect(applyReplacement(r, opt, key, weak)).toMatchObject({
      ok: false,
      error: { code: 'below_min_match' },
    });
    const misfit = { ...alt, fit: 49 };
    expect(applyReplacement(r, opt, key, misfit)).toMatchObject({
      ok: false,
      error: { code: 'fails_fit' },
    });
    expect(applyReplacement(r, opt, 'nope', alt)).toMatchObject({
      ok: false,
      error: { code: 'item_not_found' },
    });
  });

  it('removing a non-essential product lowers the total immediately; essentials cannot be removed', () => {
    const r = run();
    const opt = r.options[0] as NonNullable<RunResult['options'][number]>;
    const decor = opt.items.find((i) => !i.slot.essential)!;
    const removed = removeItem(r, opt, decor.slot.key);
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.value.total).toBe(opt.total - decor.offer.sellingPrice * decor.qty);
      expect(removed.value.items).toHaveLength(opt.items.length - 1);
    }
    const anchor = opt.items.find((i) => i.slot.essential)!;
    expect(removeItem(r, opt, anchor.slot.key)).toMatchObject({
      ok: false,
      error: { code: 'essential_item' },
    });
  });
});

describe('projects and individual products', () => {
  it('an apartment is budgeted per module from relative cost weight and solved room by room', () => {
    const res = runProject(
      {
        kind: 'apartment',
        spec: { bedrooms: 2, office: true },
        tier: 'Standard',
        style: 'modern',
        colour: 'assisted',
        totalBudget: aed(60_000),
      },
      catalogue,
    );
    expect(res.modules.map((m) => m.label)).toEqual([
      'Master Bedroom',
      'Bedroom 2',
      'Living Room',
      'Dining Room',
      'Home Office',
    ]);
    const shares = res.modules.reduce((t, m) => t + m.share, 0);
    expect(Math.abs(shares - aed(60_000))).toBeLessThanOrEqual(res.modules.length);
    expect(['Completed', 'Limited Inventory']).toContain(res.status);
    expect(res.targetRange[1]).toBeGreaterThan(res.targetRange[0]);
  });

  it('flags a budget constraint instead of silently overspending', () => {
    const res = runProject(
      {
        kind: 'villa',
        spec: { bedrooms: 4, floors: 2 },
        tier: 'Luxury',
        style: 'modern',
        colour: 'assisted',
        totalBudget: aed(20_000),
      },
      catalogue,
    );
    expect(res.status === 'Failed' || res.constraint !== null || res.total <= aed(20_000)).toBe(
      true,
    );
  });

  it('ranks a single product within its tier range', () => {
    const r = rankIndividual(
      { type: 'Floor Lamp', branch: null, style: 'modern', colour: 'black', tier: 'Value' },
      catalogue,
    );
    expect(r.range).toEqual([aed(150), aed(300)]);
    expect(r.results.length).toBeGreaterThan(0);
    for (const c of r.results) {
      expect(c.offer.sellingPrice).toBeGreaterThanOrEqual(aed(150 * 0.9));
      expect(c.offer.sellingPrice).toBeLessThanOrEqual(aed(300 * 1.1));
    }
  });
});
