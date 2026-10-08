import {
  CreateRunBodySchema,
  CreateRunResponseSchema,
  IdParamsSchema,
  MarkPaidBodySchema,
  RunListQuerySchema,
  RunPageSchema,
  RunViewSchema,
  StatementDetailSchema,
  StatementListQuerySchema,
  StatementPageSchema,
  errorResponses,
  type RunView,
} from '@aidooi/contracts';
import { requireOps, requireSeller } from '../../http/actor.ts';
import { forbidden } from '../../http/problem.ts';
import { decodeCursor, pageOf } from '../../http/pagination.ts';
import { runAs } from '../../context.ts';
import type { ModuleRoutes } from '../registry.ts';
import { approveRun, createRuns, loadRuns, markPaid, type RunRow } from './service.ts';
import { listStatements, statementCsv, statementDetail } from './statements.ts';
import { sql } from 'kysely';

const view = (r: RunRow): RunView => ({
  id: r.id,
  partnerId: r.partnerId,
  partnerName: r.partnerName,
  period: r.period,
  state: r.state,
  grossFils: r.gross,
  commissionFils: r.commission,
  adjustmentFils: r.adjustment,
  netFils: r.net,
  approvedAt: r.approvedAt?.toISOString() ?? null,
  paidAt: r.paidAt?.toISOString() ?? null,
  payoutRef: r.payoutRef,
});

/** Money movements are finance's; ops_admin may view and build, but never approve or pay. */
const financeOnly = (role: string): void => {
  if (role !== 'ops_finance') throw forbidden('Only finance can do this.');
};

export const settlementRoutes: ModuleRoutes = async (app, ctx) => {
  app.post(
    '/v1/ops/settlement/runs',
    {
      schema: {
        tags: ['settlement'],
        security: [{ bearer: [] }],
        body: CreateRunBodySchema,
        response: { 200: CreateRunResponseSchema, ...errorResponses },
      },
    },
    async (req) => {
      const ops = requireOps(req, ['ops_finance']);
      const r = await createRuns(ctx, req.body.period, ops, req.id);
      return {
        period: req.body.period,
        runs: r.runs.map(view),
        held: r.held.map((h) => ({ partnerId: h.partnerId, grossFils: h.gross })),
      };
    },
  );

  app.get(
    '/v1/ops/settlement/runs',
    {
      schema: {
        tags: ['settlement'],
        security: [{ bearer: [] }],
        querystring: RunListQuerySchema,
        response: { 200: RunPageSchema, ...errorResponses },
      },
    },
    async (req) => {
      requireOps(req, ['ops_finance']);
      const cursor = decodeCursor(req.query.cursor);
      const { rows } = await runAs(ctx, req, async (trx) => {
        let q = trx
          .selectFrom('settlement.settlement_run')
          .select(['id', sql<string>`created_at::text`.as('created_text')])
          .orderBy('created_at', 'desc')
          .orderBy('id', 'desc')
          .limit(req.query.limit + 1);
        if (req.query.period) q = q.where('period', '=', req.query.period);
        if (cursor)
          q = q.where(
            sql<boolean>`(created_at, id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`,
          );
        const ids = await q.execute();
        const page = pageOf(ids, req.query.limit, (r) => ({ t: r.created_text, id: r.id }));
        const runs = (
          await loadRuns(trx, req.query.period ? { period: req.query.period } : {})
        ).filter((r) => page.items.some((i) => i.id === r.id));
        return {
          rows: {
            items: page.items.map((i) => runs.find((r) => r.id === i.id) as RunRow),
            nextCursor: page.nextCursor,
          },
        };
      });
      return { items: rows.items.map(view), nextCursor: rows.nextCursor };
    },
  );

  app.post(
    '/v1/ops/settlement/runs/:id/approve',
    {
      schema: {
        tags: ['settlement'],
        security: [{ bearer: [] }],
        params: IdParamsSchema,
        response: { 200: RunViewSchema, ...errorResponses },
      },
    },
    async (req) => {
      const ops = requireOps(req);
      financeOnly(ops.role);
      return view(await approveRun(ctx, req.params.id, ops, req.id));
    },
  );

  app.post(
    '/v1/ops/settlement/runs/:id/mark-paid',
    {
      schema: {
        tags: ['settlement'],
        security: [{ bearer: [] }],
        params: IdParamsSchema,
        body: MarkPaidBodySchema,
        response: { 200: RunViewSchema, ...errorResponses },
      },
    },
    async (req) => {
      const ops = requireOps(req);
      financeOnly(ops.role);
      return view(await markPaid(ctx, req.params.id, req.body.bankReference, ops, req.id));
    },
  );

  app.get(
    '/v1/seller/statements',
    {
      schema: {
        tags: ['settlement'],
        security: [{ bearer: [] }],
        querystring: StatementListQuerySchema,
        response: { 200: StatementPageSchema, ...errorResponses },
      },
    },
    async (req) => {
      const seller = requireSeller(req, ['seller_owner', 'seller_manager']);
      return runAs(ctx, req, (trx) => listStatements(trx, seller.partnerId, req.query));
    },
  );

  // Same resource, two renderings: JSON by default, CSV when asked for it (Accept: text/csv or /csv).
  app.get(
    '/v1/seller/statements/:id',
    {
      schema: {
        tags: ['settlement'],
        security: [{ bearer: [] }],
        params: IdParamsSchema,
        response: { 200: StatementDetailSchema, ...errorResponses },
      },
    },
    async (req, reply) => {
      const seller = requireSeller(req, ['seller_owner', 'seller_manager']);
      const detail = await runAs(ctx, req, (trx) =>
        statementDetail(trx, seller.partnerId, req.params.id),
      );
      if (String(req.headers.accept ?? '').includes('text/csv')) {
        reply.type('text/csv; charset=utf-8').send(statementCsv(detail) as never); // typed for the JSON rendering
        return reply;
      }
      return detail;
    },
  );

  app.get(
    '/v1/seller/statements/:id/csv',
    { schema: { tags: ['settlement'], security: [{ bearer: [] }], params: IdParamsSchema } },
    async (req, reply) => {
      const seller = requireSeller(req, ['seller_owner', 'seller_manager']);
      const detail = await runAs(ctx, req, (trx) =>
        statementDetail(trx, seller.partnerId, req.params.id),
      );
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="statement-${detail.period}.csv"`)
        .send(statementCsv(detail));
    },
  );
};
