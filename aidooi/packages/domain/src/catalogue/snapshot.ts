import type { ProductId } from '../kernel/ids.ts';
import type { Catalogue, Offer, Product } from './types.ts';

/**
 * An immutable, in-memory view of the eligible catalogue. The recommendation engine is
 * synchronous and pure, so the application loads the relevant slice from the database once and
 * hands the engine a snapshot; `version` identifies that slice so any run can be reproduced.
 */
export class SnapshotCatalogue implements Catalogue {
  readonly version: string;
  readonly products: readonly Product[];
  readonly offers: readonly Offer[];
  private readonly byType = new Map<string, Product[]>();
  private readonly offersByProduct = new Map<string, Offer[]>();

  constructor(version: string, products: readonly Product[], offers: readonly Offer[]) {
    this.version = version;
    this.products = products;
    this.offers = offers;
    for (const p of products) {
      const list = this.byType.get(p.type) ?? [];
      list.push(p);
      this.byType.set(p.type, list);
    }
    for (const p of products) this.productIndex.set(p.id, p);
    for (const o of offers) {
      this.offerIndex.set(o.id, o);
      const list = this.offersByProduct.get(o.productId) ?? [];
      list.push(o);
      this.offersByProduct.set(o.productId, list);
    }
  }

  private readonly productIndex = new Map<string, Product>();
  private readonly offerIndex = new Map<string, Offer>();

  /** `branch === null` means "any branch of this type". */
  productsOfType(type: string, branch: string | null): readonly Product[] {
    const all = this.byType.get(type) ?? [];
    return branch === null ? all : all.filter((p) => p.branch === String(branch));
  }

  productById(id: string): Product | undefined {
    return this.productIndex.get(id);
  }

  offerById(id: string): Offer | undefined {
    return this.offerIndex.get(id);
  }

  offersOf(id: ProductId): readonly Offer[] {
    return this.offersByProduct.get(id) ?? [];
  }

  /** A copy with offers transformed — price changes and stock-outs, for tests and what-ifs. */
  withOffers(mutate: (o: Offer) => Offer, version = `${this.version}+`): SnapshotCatalogue {
    return new SnapshotCatalogue(version, this.products, this.offers.map(mutate));
  }
}
