import { ProductCardSchema, ProductParamsSchema, errorsFor } from '@aidooi/contracts';
import { runAsSystem } from '../../context.ts';
import { notFound } from '../../http/problem.ts';
import { requireActor } from '../../http/actor.ts';
import type { ModuleRoutes } from '../registry.ts';
import { loadOfferSummaries, loadProductSummaries } from './cards.ts';

/** Buyer-facing catalogue reads. Anything shown here is public product data; nothing seller-private. */
export const catalogueRoutes: ModuleRoutes = async (app, ctx) => {
  app.get(
    '/v1/products/:id',
    {
      schema: {
        tags: ['catalogue'],
        summary: 'Product Card: a verified product and the live offers for it',
        params: ProductParamsSchema,
        response: { 200: ProductCardSchema, ...errorsFor(401, 404) },
      },
    },
    async (req) => {
      requireActor(req);
      return runAsSystem(ctx, async (trx) => {
        const row = await trx
          .selectFrom('catalogue.product')
          .select(['id'])
          .where('id', '=', req.params.id)
          .where('data_status', '=', 'Verified')
          .where('lifecycle', '=', 'Active')
          .executeTakeFirst();
        if (!row) throw notFound('Product');
        const [products, offerRows] = await Promise.all([
          loadProductSummaries(trx, [row.id], ctx.config.MEDIA_BASE_URL),
          trx
            .selectFrom('catalogue.eligible_offer')
            .select('offer_id')
            .where('product_id', '=', row.id)
            .execute(),
        ]);
        const offers = await loadOfferSummaries(
          trx,
          offerRows.flatMap((o) => (o.offer_id ? [o.offer_id] : [])),
        );
        const product = products.get(row.id);
        if (!product) throw notFound('Product');
        return {
          product,
          offers: [...offers.values()].sort((a, b) => a.sellingPrice - b.sellingPrice),
        };
      });
    },
  );
};
