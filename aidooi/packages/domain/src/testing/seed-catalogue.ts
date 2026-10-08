/**
 * Deterministic seed catalogue for tests, local development and demos — never production data.
 *
 * It reproduces the MVP prototype's generator exactly (same PRNG, same draw order) so the
 * engine can be compared against the prototype on identical inputs (see test/differential).
 */
import {
  formatCatalogueId,
  offerId,
  parentProductId,
  partnerId,
  productId,
} from '../kernel/ids.ts';
import { aed, bpsFromRate } from '../kernel/money.ts';
import { SnapshotCatalogue } from '../catalogue/snapshot.ts';
import type { Offer, Product, ProductAttrs } from '../catalogue/types.ts';
import { priceRange } from '../standards/price-matrix.ts';
import { SEED_PARTNERS, SEED_TYPE_SPEC, type SeedPartner } from './seed-spec.ts';

/** mulberry32 — small, fast, well-distributed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Types whose real-world width varies enough that one size cannot satisfy every fit band. */
const SCALED: Readonly<Record<string, readonly number[]>> = {
  'Coffee Table': [0.72, 1, 1.3],
  'TV Unit': [0.68, 1, 1.42],
  Sideboard: [0.62, 1, 1.42],
  'Console Table': [0.78, 1, 1.3],
  Desk: [0.72, 1, 1.35],
  'Chest of Drawers': [0.68, 1, 1.4],
  Bookcase: [0.68, 1, 1.5],
  'Storage Cabinet': [0.62, 1, 1.5],
  'Wall Art': [0.5, 1, 1.75],
  Mirror: [0.6, 1, 1.5],
  'Side Table': [0.72, 1, 1.3],
  'Bedside Table': [0.72, 1, 1.3],
  'Accent Chair': [0.86, 1, 1.25],
};
const SCALE_SUFFIX = ['Compact', '', 'Wide'] as const;

/** Kept for readability at call sites: the seed catalogue is an ordinary snapshot. */
export { SnapshotCatalogue as InMemoryCatalogue } from '../catalogue/snapshot.ts';

export interface SeedResult {
  readonly catalogue: SnapshotCatalogue;
  readonly partners: readonly SeedPartner[];
}

export function seedCatalogue(seed = 20260101): SeedResult {
  const rand = rng(seed);
  const products: Product[] = [];
  const offers: Offer[] = [];
  const seq = { aip: 0, aid: 0, aio: 0 };
  const basePrice = new Map<string, number>();

  for (const [type, spec] of Object.entries(SEED_TYPE_SPEC)) {
    const branches = Object.keys(spec.dims);
    const scaleList = SCALED[type] ?? [1];
    for (const fam of spec.families) {
      for (const branch of branches) {
        for (let si = 0; si < scaleList.length; si++) {
          const scale = scaleList[si] as number;
          const sizeWord = scaleList.length > 1 ? SCALE_SUFFIX[si] : '';
          const parentId = parentProductId(formatCatalogueId('AIP', ++seq.aip));
          const [bw, bd, bh] = spec.dims[branch] as readonly [number, number, number];
          const famJitter = 0.94 + rand() * 0.12;
          const width = Math.round(bw * scale * famJitter);
          const depth = Math.round(
            bd * (scale > 1 ? 1.08 : scale < 1 ? 0.92 : 1) * (0.96 + rand() * 0.08),
          );
          const height = Math.round(bh * (0.96 + rand() * 0.08));
          const branchLabel = branch || null;

          for (const colour of fam.cols) {
            const id = productId(formatCatalogueId('AID', ++seq.aid));
            const range = priceRange(type, branchLabel, fam.tier) ?? [aed(100), aed(300)];
            const frac = 0.25 + rand() * 0.5;
            const sizeFactor = scale > 1 ? 1.12 : scale < 1 ? 0.9 : 1;
            const raw = (range[0] / 100 + frac * ((range[1] - range[0]) / 100)) * sizeFactor;
            const base = Math.max(range[0] / 100, Math.round(raw / 5) * 5);

            const attrs: { -readonly [K in keyof ProductAttrs]: ProductAttrs[K] } = {};
            if (type === 'Sofa') attrs.seats = Number(branch);
            if (type === 'Bed') attrs.bedSize = branch;
            if (type === 'Dining Table') attrs.capacity = Number(branch);
            if (type === 'Wardrobe') attrs.doorGroup = branch;
            if (type === 'Rug') attrs.rugSize = branch;
            if (type === 'Office Chair') attrs.adjustable = true;
            if (type === 'Desk') attrs.cableManagement = rand() > 0.4;

            const branchWord =
              branchLabel && !['Rug', 'Wardrobe'].includes(type)
                ? ` ${branchLabel}${type === 'Sofa' ? '-Seater' : type === 'Dining Table' ? '-Person' : ''}`
                : '';

            basePrice.set(id, base);
            products.push({
              id,
              parentId,
              name: `${fam.n} ${type}${branchWord}${sizeWord ? ' ' + sizeWord : ''}`,
              type,
              branch: branchLabel,
              primaryStyle: fam.style,
              secondaryStyle: fam.sec,
              primaryColour: colour,
              secondaryColour: null,
              material: fam.mat,
              widthCm: width,
              depthCm: depth,
              heightCm: height,
              attrs,
              dataStatus: 'Verified',
              lifecycle: 'Active',
            });
          }
        }
      }
    }
  }

  for (const p of products) {
    const n = 1 + (rand() < 0.45 ? 1 : 0);
    const used = new Set<string>();
    for (let i = 0; i < n; i++) {
      let partner: SeedPartner;
      do {
        partner = SEED_PARTNERS[Math.floor(rand() * SEED_PARTNERS.length)] as SeedPartner;
      } while (used.has(partner.id));
      used.add(partner.id);

      const variance = 0.93 + rand() * 0.16;
      const selling = Math.max(
        20,
        Math.round(((basePrice.get(p.id) as number) * variance) / 5) * 5,
      );
      const hasDiscount = rand() < 0.25;
      const original = hasDiscount ? Math.round((selling * (1.1 + rand() * 0.25)) / 5) * 5 : null;

      const r = rand();
      const availability = r < 0.72 ? 'In Stock' : r < 0.9 ? 'Low Stock' : 'Out of Stock';
      const onDisplay = availability !== 'Out of Stock' && rand() < 0.62;
      const viewable = availability !== 'Out of Stock';
      const deliveryDays = ([2, 3, 5, 7, 10, 14] as const)[Math.floor(rand() * 6)] as number;
      const stockQty =
        availability === 'In Stock'
          ? 2 + Math.floor(rand() * 20)
          : availability === 'Low Stock'
            ? 1
            : 0;

      offers.push({
        id: offerId(formatCatalogueId('AIO', ++seq.aio)),
        productId: p.id,
        partnerId: partnerId(partner.id),
        sellingPrice: aed(selling),
        originalPrice: original === null ? null : aed(original),
        availability,
        stockQty,
        viewingStatus: onDisplay ? 'On Display' : viewable ? 'Viewable on Request' : 'Not Viewable',
        viewingConfirmedAt: null,
        deliveryDays,
        commissionRate: bpsFromRate(partner.commission),
        offerStatus: 'Active',
      });
    }
  }

  return {
    catalogue: new SnapshotCatalogue(`seed-${seed}`, products, offers),
    partners: SEED_PARTNERS,
  };
}
