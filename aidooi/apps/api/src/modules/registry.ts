import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppContext } from '../context.ts';
import { authRoutes } from './auth/routes.ts';
import { catalogueRoutes } from './catalogue/routes.ts';
import { commerceRoutes } from './commerce/routes.ts';
import { fulfilmentRoutes } from './fulfilment/routes.ts';
import { opsRoutes } from './ops/routes.ts';
import { recommendationRoutes } from './recommendation/routes.ts';
import { sellerRoutes } from './seller/routes.ts';
import { settlementRoutes } from './settlement/routes.ts';
import { viewingRoutes } from './viewing/routes.ts';

export type TypedApp = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;
export type ModuleRoutes = (app: TypedApp, ctx: AppContext) => Promise<void>;

/**
 * Every module's HTTP surface, in one list. Adding a module means adding one line here; a module
 * is a plain function of (app, ctx), so it can be mounted in tests exactly as in production.
 */
export const MODULES: readonly { readonly name: string; readonly routes: ModuleRoutes }[] = [
  { name: 'auth', routes: authRoutes },
  { name: 'catalogue', routes: catalogueRoutes },
  { name: 'recommendation', routes: recommendationRoutes },
  { name: 'commerce', routes: commerceRoutes },
  { name: 'viewing', routes: viewingRoutes },
  { name: 'fulfilment', routes: fulfilmentRoutes },
  { name: 'settlement', routes: settlementRoutes },
  { name: 'seller', routes: sellerRoutes },
  { name: 'ops', routes: opsRoutes },
];
