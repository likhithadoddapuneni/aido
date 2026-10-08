import { z } from 'zod';
import type { OrderLineState } from '@aidooi/domain';
import {
  BuyerLineSchema,
  BuyerOrderPageSchema,
  BuyerOrderSchema,
  IdParamsSchema,
  IssueListQuerySchema,
  IssuePageSchema,
  IssueResultSchema,
  LineListQuerySchema,
  OpsAdvanceBodySchema,
  OpsResolveBodySchema,
  OrderLineParamsSchema,
  OrderParamsSchema,
  PageQuerySchema,
  ProofUploadBodySchema,
  ProofUploadSchema,
  RaiseIssueBodySchema,
  SellerAdvanceBodySchema,
  SellerLinePageSchema,
  SellerLineResultSchema,
  SellerRespondBodySchema,
  errorResponses,
} from '@aidooi/contracts';
import { requireBuyer, requireOps, requireSeller } from '../../http/actor.ts';
import { notFound } from '../../http/problem.ts';
import { runAs, runAsSystem } from '../../context.ts';
import type { ModuleRoutes } from '../registry.ts';
import { closeIssue, lockIssue, markPartnerHandling, raiseIssue } from './issues.ts';
import { executeRefundsNow } from './refunds.ts';
import { advanceLine, confirmReceipt, requestProofUpload } from './service.ts';
import { buyerOrders, listIssues, sellerLines } from './views.ts';

export const fulfilmentRoutes: ModuleRoutes = async (app, ctx) => {
  /* ------------------------------ buyer ------------------------------ */

  app.get(
    '/v1/orders',
    {
      schema: {
        tags: ['orders'],
        security: [{ bearer: [] }],
        querystring: PageQuerySchema,
        response: { 200: BuyerOrderPageSchema, ...errorResponses },
      },
    },
    async (req) => {
      const buyer = requireBuyer(req, { registered: true });
      return runAs(ctx, req, (trx) => buyerOrders(trx, buyer.customerId as string, req.query));
    },
  );

  app.get(
    '/v1/orders/:orderId',
    {
      schema: {
        tags: ['orders'],
        security: [{ bearer: [] }],
        params: OrderParamsSchema,
        response: { 200: BuyerOrderSchema, ...errorResponses },
      },
    },
    async (req) => {
      const buyer = requireBuyer(req, { registered: true });
      const { items } = await runAs(ctx, req, (trx) =>
        buyerOrders(trx, buyer.customerId as string, { limit: 1, orderId: req.params.orderId }),
      );
      const order = items[0];
      if (!order) throw notFound('Order');
      return order;
    },
  );

  app.post(
    '/v1/orders/:orderId/lines/:lineId/confirm-receipt',
    {
      schema: {
        tags: ['orders'],
        security: [{ bearer: [] }],
        params: OrderLineParamsSchema,
        response: { 200: BuyerLineSchema, ...errorResponses },
      },
    },
    async (req) => {
      const buyer = requireBuyer(req, { registered: true });
      const customerId = buyer.customerId as string;
      await confirmReceipt(ctx, {
        orderId: req.params.orderId,
        lineId: req.params.lineId,
        customerId,
        actor: buyer,
        correlationId: req.id,
      });
      const { items } = await runAs(ctx, req, (trx) =>
        buyerOrders(trx, customerId, { limit: 1, orderId: req.params.orderId }),
      );
      const line = items[0]?.lines.find((l) => l.id === req.params.lineId);
      if (!line) throw notFound('Order line');
      return line;
    },
  );

  app.post(
    '/v1/orders/:orderId/lines/:lineId/issues',
    {
      schema: {
        tags: ['orders'],
        security: [{ bearer: [] }],
        params: OrderLineParamsSchema,
        body: RaiseIssueBodySchema,
        response: { 201: z.object({ id: z.uuid() }), ...errorResponses },
      },
    },
    async (req, reply) => {
      const buyer = requireBuyer(req, { registered: true });
      const customerId = buyer.customerId as string;
      const { issueId } = await runAsSystem(
        ctx,
        (trx) =>
          raiseIssue(ctx, trx, {
            lineId: req.params.lineId,
            owner: { customerId, masterOrderId: req.params.orderId },
            flag: req.body.flag,
            note: req.body.note,
            actor: buyer,
            raisedByCustomerId: customerId,
          }),
        req.id,
      );
      return reply.code(201).send({ id: issueId });
    },
  );

  /* ------------------------------ seller ------------------------------ */

  app.get(
    '/v1/seller/order-lines',
    {
      schema: {
        tags: ['seller'],
        security: [{ bearer: [] }],
        querystring: LineListQuerySchema,
        response: { 200: SellerLinePageSchema, ...errorResponses },
      },
    },
    async (req) => {
      const seller = requireSeller(req);
      return runAs(ctx, req, (trx) => sellerLines(trx, seller.partnerId, req.query));
    },
  );

  app.post(
    '/v1/seller/order-lines/:id/proof-upload',
    {
      schema: {
        tags: ['seller'],
        security: [{ bearer: [] }],
        summary: 'Get a short-lived signed URL to upload the delivery-proof photograph.',
        params: IdParamsSchema,
        body: ProofUploadBodySchema,
        response: { 200: ProofUploadSchema, ...errorResponses },
      },
    },
    async (req) => requestProofUpload(ctx, requireSeller(req), req.params.id, req.body),
  );

  app.post(
    '/v1/seller/order-lines/:id/advance',
    {
      schema: {
        tags: ['seller'],
        security: [{ bearer: [] }],
        params: IdParamsSchema,
        body: SellerAdvanceBodySchema,
        response: { 200: SellerLineResultSchema, ...errorResponses },
      },
    },
    async (req) => {
      const seller = requireSeller(req);
      const r = await advanceLine(ctx, {
        lineId: req.params.id,
        to: req.body.to,
        actor: seller,
        partnerId: seller.partnerId,
        reason: req.body.reason,
        proofPhotoKey: req.body.proofPhotoKey,
        correlationId: req.id,
      });
      return { id: req.params.id, ...r };
    },
  );

  app.get(
    '/v1/seller/issues',
    {
      schema: {
        tags: ['seller'],
        security: [{ bearer: [] }],
        querystring: IssueListQuerySchema,
        response: { 200: IssuePageSchema, ...errorResponses },
      },
    },
    async (req) => {
      const seller = requireSeller(req);
      return runAs(ctx, req, (trx) => listIssues(trx, { partnerId: seller.partnerId }, req.query));
    },
  );

  app.post(
    '/v1/seller/issues/:id/respond',
    {
      schema: {
        tags: ['seller'],
        security: [{ bearer: [] }],
        params: IdParamsSchema,
        body: SellerRespondBodySchema,
        response: { 200: IssueResultSchema, ...errorResponses },
      },
    },
    async (req) => {
      const seller = requireSeller(req);
      const out = await runAsSystem(
        ctx,
        async (trx) => {
          const row = await lockIssue(trx, req.params.id, seller.partnerId);
          if (req.body.action === 'PartnerHandling') {
            await markPartnerHandling(trx, row, req.body.note, seller);
            const line = await trx
              .selectFrom('fulfilment.order_line')
              .select('state')
              .where('id', '=', row.orderLineId)
              .executeTakeFirstOrThrow();
            return { state: 'Partner Handling' as const, lineState: line.state as OrderLineState };
          }
          const res = await closeIssue(ctx, trx, row, {
            resolution: 'Resolved',
            note: req.body.note,
            actor: seller,
          });
          return { state: 'Resolved' as const, lineState: res.lineState };
        },
        req.id,
      );
      return { id: req.params.id, state: out.state, lineState: out.lineState };
    },
  );

  /* -------------------------------- ops -------------------------------- */

  app.post(
    '/v1/ops/order-lines/:id/advance',
    {
      schema: {
        tags: ['ops'],
        security: [{ bearer: [] }],
        params: IdParamsSchema,
        body: OpsAdvanceBodySchema,
        response: { 200: SellerLineResultSchema, ...errorResponses },
      },
    },
    async (req) => {
      const ops = requireOps(req, ['ops_support']);
      const r = await advanceLine(ctx, {
        lineId: req.params.id,
        to: req.body.to,
        actor: ops,
        reason: req.body.reason,
        proofPhotoKey: req.body.proofPhotoKey,
        correlationId: req.id,
      });
      return { id: req.params.id, ...r };
    },
  );

  app.get(
    '/v1/ops/issues',
    {
      schema: {
        tags: ['ops'],
        security: [{ bearer: [] }],
        querystring: IssueListQuerySchema,
        response: { 200: IssuePageSchema, ...errorResponses },
      },
    },
    async (req) => {
      requireOps(req, ['ops_support']);
      return runAs(ctx, req, (trx) => listIssues(trx, {}, req.query));
    },
  );

  app.post(
    '/v1/ops/issues/:id/resolve',
    {
      schema: {
        tags: ['ops'],
        security: [{ bearer: [] }],
        params: IdParamsSchema,
        body: OpsResolveBodySchema,
        response: { 200: IssueResultSchema, ...errorResponses },
      },
    },
    async (req) => {
      const ops = requireOps(req, ['ops_support']);
      const res = await runAsSystem(
        ctx,
        async (trx) => {
          const row = await lockIssue(trx, req.params.id);
          return closeIssue(ctx, trx, row, {
            resolution: req.body.resolution,
            note: req.body.note,
            actor: ops,
            refundAmountFils: req.body.refundAmountFils,
          });
        },
        req.id,
      );
      await executeRefundsNow(ctx, res.refundIds);
      return { id: req.params.id, state: req.body.resolution, lineState: res.lineState };
    },
  );
};
