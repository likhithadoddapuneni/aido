import {
  CreateViewingBodySchema,
  DepositResultSchema,
  IdempotencyHeaderSchema,
  OutcomeBodySchema,
  OutcomeResultSchema,
  PassSchema,
  PayDepositBodySchema,
  RespondBodySchema,
  RespondResultSchema,
  ScanBodySchema,
  ScanResultSchema,
  TaskIdParamsSchema,
  ViewingIdParamsSchema,
  ViewingSchema,
  ViewingTaskSchema,
  errorResponses,
} from '@aidooi/contracts';
import { z } from 'zod';
import { requireBuyer, requireSeller } from '../../http/actor.ts';
import { withIdempotency } from '../../http/idempotency.ts';
import { conflict } from '../../http/problem.ts';
import type { ModuleRoutes } from '../registry.ts';
import { payDeposit } from './deposit.ts';
import { iso, loadData, passFor } from './repo.ts';
import { runAsSystem } from '../../context.ts';
import { notFound } from '../../http/problem.ts';
import { listTasks, recordOutcome, respond, scan } from './seller.ts';
import {
  cancelViewing,
  continueWithoutDeclined,
  createViewing,
  getViewing,
  listViewings,
} from './service.ts';

/** HTTP surface of the viewing module (AID-LOG-012 Rev 2, WF-04). */
export const viewingRoutes: ModuleRoutes = async (app, ctx) => {
  const buyer = (req: Parameters<typeof requireBuyer>[0]) => {
    const a = requireBuyer(req, { registered: true });
    return { customerId: a.customerId as string };
  };

  app.post(
    '/v1/viewings',
    {
      schema: {
        tags: ['viewing'],
        summary: 'Request to see products in showrooms',
        headers: IdempotencyHeaderSchema.loose(),
        body: CreateViewingBodySchema,
        response: { 201: ViewingSchema, ...errorResponses },
      },
    },
    async (req, reply) => {
      const b = buyer(req);
      const r = await withIdempotency(ctx, req, 'POST /v1/viewings', req.body, async () => ({
        status: 201,
        body: await createViewing(ctx, b, req.body, req.id),
      }));
      return reply.code(r.status as 201).send(r.body);
    },
  );

  app.get(
    '/v1/viewings',
    { schema: { tags: ['viewing'], response: { 200: z.array(ViewingSchema), ...errorResponses } } },
    async (req) => listViewings(ctx, buyer(req)),
  );

  app.get(
    '/v1/viewings/:id',
    {
      schema: {
        tags: ['viewing'],
        params: ViewingIdParamsSchema,
        response: { 200: ViewingSchema, ...errorResponses },
      },
    },
    async (req) => getViewing(ctx, buyer(req), req.params.id),
  );

  app.post(
    '/v1/viewings/:id/continue',
    {
      schema: {
        tags: ['viewing'],
        summary: 'Go ahead without the showrooms that declined',
        params: ViewingIdParamsSchema,
        response: { 200: ViewingSchema, ...errorResponses },
      },
    },
    async (req) => continueWithoutDeclined(ctx, buyer(req), req.params.id, req.id),
  );

  app.post(
    '/v1/viewings/:id/deposit',
    {
      schema: {
        tags: ['viewing'],
        summary: 'Pay the viewing deposit',
        params: ViewingIdParamsSchema,
        headers: IdempotencyHeaderSchema.loose(),
        body: PayDepositBodySchema,
        response: { 200: DepositResultSchema, 202: DepositResultSchema, ...errorResponses },
      },
    },
    async (req, reply) => {
      const b = buyer(req);
      const key = req.headers['idempotency-key'];
      const r = await withIdempotency(
        ctx,
        req,
        `POST /v1/viewings/${req.params.id}/deposit`,
        req.body,
        async () => {
          const outcome = await payDeposit(ctx, b, req.params.id, req.body, key, req.id);
          return { status: outcome.status === 'confirmed' ? 200 : 202, body: outcome };
        },
      );
      return reply.code(r.status as 200 | 202).send(r.body);
    },
  );

  app.get(
    '/v1/viewings/:id/pass',
    {
      schema: {
        tags: ['viewing'],
        params: ViewingIdParamsSchema,
        response: { 200: PassSchema, ...errorResponses },
      },
    },
    async (req) => {
      const b = buyer(req);
      return runAsSystem(ctx, async (trx) => {
        const data = await loadData(trx, req.params.id);
        if (data.request.customer_id !== b.customerId) throw notFound('Viewing');
        const p = passFor(ctx, data.request);
        if (!p)
          throw conflict('viewing_pass_unavailable', 'A pass is issued once the deposit is paid.');
        return {
          token: p.token,
          validFrom: iso(new Date(p.validFrom)),
          validUntil: iso(new Date(p.validUntil)),
        };
      });
    },
  );

  app.post(
    '/v1/viewings/:id/cancel',
    {
      schema: {
        tags: ['viewing'],
        params: ViewingIdParamsSchema,
        response: { 200: ViewingSchema, ...errorResponses },
      },
    },
    async (req) => cancelViewing(ctx, buyer(req), req.params.id, req.id),
  );

  /* ---------------- Sellers ---------------- */

  app.get(
    '/v1/seller/viewing-tasks',
    {
      schema: {
        tags: ['viewing', 'seller'],
        response: { 200: z.array(ViewingTaskSchema), ...errorResponses },
      },
    },
    async (req) => listTasks(ctx, requireSeller(req)),
  );

  app.post(
    '/v1/seller/viewing-tasks/:id/respond',
    {
      schema: {
        tags: ['viewing', 'seller'],
        params: TaskIdParamsSchema,
        body: RespondBodySchema,
        response: { 200: RespondResultSchema, ...errorResponses },
      },
    },
    async (req) => respond(ctx, requireSeller(req), req.params.id, req.body, req.id),
  );

  app.post(
    '/v1/seller/viewings/scan',
    {
      schema: {
        tags: ['viewing', 'seller'],
        body: ScanBodySchema,
        response: { 200: ScanResultSchema, ...errorResponses },
      },
    },
    async (req) => scan(ctx, requireSeller(req), req.body.token, req.id),
  );

  app.post(
    '/v1/seller/viewings/:id/outcome',
    {
      schema: {
        tags: ['viewing', 'seller'],
        params: ViewingIdParamsSchema,
        body: OutcomeBodySchema,
        response: { 200: OutcomeResultSchema, ...errorResponses },
      },
    },
    async (req) => recordOutcome(ctx, requireSeller(req), req.params.id, req.body.outcome, req.id),
  );
};
