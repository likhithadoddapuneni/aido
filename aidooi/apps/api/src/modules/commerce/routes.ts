import {
  ApprovePricesBodySchema,
  CheckoutParamsSchema,
  CheckoutSchema,
  IdempotencyHeaderSchema,
  PayBodySchema,
  PayResponseSchema,
  PurchaseTaskParamsSchema,
  PurchaseTaskRespondBodySchema,
  PurchaseTasksSchema,
  StartCheckoutBodySchema,
  errorsFor,
} from '@aidooi/contracts';
import { z } from 'zod';
import { withIdempotency } from '../../http/idempotency.ts';
import { HttpError } from '../../http/problem.ts';
import { applyDepositPaymentEvent } from '../viewing/index.ts';
import type { ModuleRoutes } from '../registry.ts';
import { approvePrices, getCheckout, startCheckout } from './checkout.ts';
import { pay } from './pay.ts';
import { listPurchaseTasks, respondToPurchaseTask } from './seller-tasks.ts';
import { handlePaymentEvent } from './webhook.ts';

const tags = ['checkout'];

export const commerceRoutes: ModuleRoutes = async (app, ctx) => {
  // Money-moving endpoints get a far tighter ceiling than the global limit: a retry storm is a bug or an attack.
  const MONEY_LIMIT = {
    rateLimit: { max: ctx.config.RATE_LIMIT_MONEY_PER_MIN, timeWindow: '1 minute' },
  };
  app.post(
    '/v1/checkout',
    {
      config: MONEY_LIMIT,
      schema: {
        tags,
        summary:
          'Start a checkout: validate every line against its seller and hold the stock (AID-LOG-014 §3).',
        headers: IdempotencyHeaderSchema,
        body: StartCheckoutBodySchema,
        response: { 201: CheckoutSchema, ...errorsFor(400, 401, 403, 404, 409, 422) },
      },
    },
    async (req, reply) => {
      const r = await withIdempotency(ctx, req, 'POST /v1/checkout', req.body, async () => ({
        status: 201,
        body: await startCheckout(ctx, req, req.body),
      }));
      return reply.code(201).send(r.body);
    },
  );

  app.get(
    '/v1/checkout/:checkoutId',
    {
      schema: {
        tags,
        params: CheckoutParamsSchema,
        response: { 200: CheckoutSchema, ...errorsFor(401, 403, 404) },
      },
    },
    async (req) => getCheckout(ctx, req, req.params.checkoutId),
  );

  app.post(
    '/v1/checkout/:checkoutId/approve-prices',
    {
      schema: {
        tags,
        summary:
          'Approve the new total after a price changed. Approval names the total; it is never a blank cheque.',
        params: CheckoutParamsSchema,
        body: ApprovePricesBodySchema,
        response: { 200: CheckoutSchema, ...errorsFor(400, 401, 403, 404, 409) },
      },
    },
    async (req) => approvePrices(ctx, req, req.params.checkoutId, req.body.approvedTotal),
  );

  app.post(
    '/v1/checkout/:checkoutId/pay',
    {
      config: MONEY_LIMIT,
      schema: {
        tags,
        summary:
          'Pay. One payment to AIDOOi; authorise, re-validate, capture, then the order is placed and split.',
        params: CheckoutParamsSchema,
        headers: IdempotencyHeaderSchema,
        body: PayBodySchema,
        response: {
          200: PayResponseSchema,
          202: PayResponseSchema,
          ...errorsFor(400, 401, 402, 403, 404, 409, 422, 503),
        },
      },
    },
    async (req, reply) => {
      const key = req.headers['idempotency-key'] as string;
      const r = await withIdempotency(
        ctx,
        req,
        `POST /v1/checkout/${req.params.checkoutId}/pay`,
        req.body,
        async () => {
          const out = await pay(ctx, req, req.params.checkoutId, req.body, key);
          return { status: out.status === 'paid' ? 200 : 202, body: out };
        },
      );
      return reply.code(r.status === 200 ? 200 : 202).send(r.body);
    },
  );

  app.get(
    '/v1/seller/purchase-tasks',
    {
      schema: {
        tags: ['seller'],
        summary: 'Purchase confirmations waiting for this seller',
        response: { 200: PurchaseTasksSchema, ...errorsFor(401, 403) },
      },
    },
    async (req) => listPurchaseTasks(ctx, req),
  );

  app.post(
    '/v1/seller/purchase-tasks/:taskId/respond',
    {
      schema: {
        tags: ['seller'],
        summary:
          'Confirm or decline stock and price for a buyer’s checkout. The last confirmation starts their 24-hour window.',
        params: PurchaseTaskParamsSchema,
        body: PurchaseTaskRespondBodySchema,
        response: {
          200: z.object({ id: z.uuid(), response: z.enum(['Confirmed', 'Declined']) }),
          ...errorsFor(400, 401, 403, 404, 409),
        },
      },
    },
    async (req) => respondToPurchaseTask(ctx, req, req.params.taskId, req.body.response),
  );

  // Provider webhooks are signed over the exact bytes, so this route keeps the raw body.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
      done(null, body),
    );
    scope.post(
      '/v1/webhooks/payments',
      {
        schema: { tags: ['webhooks'], hide: true },
        config: { rateLimit: { max: 1000, timeWindow: '1 minute' } },
      },
      async (req, reply) => {
        const signature = req.headers['x-payment-signature'];
        if (typeof signature !== 'string')
          throw new HttpError(401, 'invalid_webhook_signature', 'Missing signature.');
        const raw = req.body as string;
        // Viewing deposits are a different payment purpose with their own handler; it claims its own events.
        const event = (() => {
          try {
            return ctx.gateway.parseWebhook(raw, signature);
          } catch {
            throw new HttpError(
              401,
              'invalid_webhook_signature',
              'The webhook signature is invalid.',
            );
          }
        })();
        if (await applyDepositPaymentEvent(ctx, event))
          return reply.code(200).send({ received: true });
        await handlePaymentEvent(ctx, event);
        return reply.code(200).send({ received: true });
      },
    );
  });
};
