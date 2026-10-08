import {
  BuyerSessionSchema,
  GuestSessionResponseSchema,
  OAuthProviderSchema,
  OAuthSignInSchema,
  OtpRequestResponseSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  RefreshRequestSchema,
  StaffAcceptInviteResponseSchema,
  StaffAcceptInviteSchema,
  StaffLoginSchema,
  StaffMfaEnrollResponseSchema,
  StaffMfaEnrollSchema,
  StaffMfaVerifySchema,
  StaffSessionSchema,
  TokenPairSchema,
  errorResponses,
} from '@aidooi/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runAsSystem } from '../../context.ts';
import { HttpError } from '../../http/problem.ts';
import type { ModuleRoutes } from '../registry.ts';
import { createGuestSession, requestOtp, signInWithProvider, verifyOtp } from './buyer.ts';
import { meRoutes } from './me-routes.ts';
import { revokeByRefreshToken, rotateRefresh } from './sessions.ts';
import { acceptInvite, confirmMfa, enrollMfa, staffLogin } from './staff.ts';

/** Credential endpoints are the favourite target of guessing attacks: limits are per client address and deliberately tight. */
const limit = (max: number, window = '1 minute') => ({ rateLimit: { max, timeWindow: window } });

const deviceLabel = (req: FastifyRequest): string | null => {
  const h = req.headers['x-device-label'];
  return typeof h === 'string' && h ? h.slice(0, 80) : null;
};

const tags = ['auth'];

export const authRoutes: ModuleRoutes = async (app, ctx) => {
  /* ---------------- Buyers ---------------- */

  app.post(
    '/v1/auth/guest',
    {
      schema: { tags, response: { 201: GuestSessionResponseSchema, 429: errorResponses[429] } },
      config: limit(20),
    },
    async (_req, reply) => {
      const { guestToken, expiresAt } = await createGuestSession(ctx);
      return reply.code(201).send({ guestToken, expiresAt: expiresAt.toISOString() });
    },
  );

  app.post(
    '/v1/auth/otp/request',
    {
      schema: {
        tags,
        body: OtpRequestSchema,
        response: {
          202: OtpRequestResponseSchema,
          400: errorResponses[400],
          429: errorResponses[429],
        },
      },
      config: limit(10),
    },
    async (req, reply) => {
      await requestOtp(ctx, req.log, req.body);
      return reply.code(202).send({ status: 'sent' as const });
    },
  );

  app.post(
    '/v1/auth/otp/verify',
    {
      schema: {
        tags,
        body: OtpVerifySchema,
        response: {
          200: BuyerSessionSchema,
          401: errorResponses[401],
          422: errorResponses[422],
          429: errorResponses[429],
        },
      },
      config: limit(10),
    },
    async (req) => verifyOtp(ctx, req.body, deviceLabel(req)),
  );

  app.post(
    '/v1/auth/oauth/:provider',
    {
      schema: {
        tags,
        params: z.object({ provider: OAuthProviderSchema }),
        body: OAuthSignInSchema,
        response: {
          200: BuyerSessionSchema,
          401: errorResponses[401],
          422: errorResponses[422],
          429: errorResponses[429],
        },
      },
      config: limit(10),
    },
    async (req) => signInWithProvider(ctx, req.params.provider, req.body, deviceLabel(req)),
  );

  /* ---------------- Sessions ---------------- */

  app.post(
    '/v1/auth/refresh',
    {
      schema: {
        tags,
        body: RefreshRequestSchema,
        response: { 200: TokenPairSchema, 401: errorResponses[401], 429: errorResponses[429] },
      },
      config: limit(30),
    },
    async (req) => {
      const result = await runAsSystem(
        ctx,
        (trx) => rotateRefresh(ctx, trx, req.body.refreshToken),
        req.id,
      );
      if (!result.ok) {
        if (result.reason === 'reuse')
          req.log.warn('refresh token reuse detected; session family revoked');
        throw new HttpError(
          401,
          'invalid_refresh_token',
          'Your session has ended. Please sign in again.',
        );
      }
      return result.tokens;
    },
  );

  app.post(
    '/v1/auth/logout',
    {
      schema: { tags, body: RefreshRequestSchema, response: { 204: z.null() } },
      config: limit(30),
    },
    async (req, reply) => {
      await runAsSystem(
        ctx,
        (trx) => revokeByRefreshToken(ctx, trx, req.body.refreshToken),
        req.id,
      );
      return reply.code(204).send(null);
    },
  );

  /* ---------------- Staff: sellers and ops ---------------- */

  app.post(
    '/v1/auth/staff/accept-invite',
    {
      schema: {
        tags,
        body: StaffAcceptInviteSchema,
        response: {
          200: StaffAcceptInviteResponseSchema,
          400: errorResponses[400],
          422: errorResponses[422],
          429: errorResponses[429],
        },
      },
      config: limit(10),
    },
    async (req) => acceptInvite(ctx, req.body),
  );

  app.post(
    '/v1/auth/staff/mfa/enroll',
    {
      schema: {
        tags,
        body: StaffMfaEnrollSchema,
        response: {
          200: StaffMfaEnrollResponseSchema,
          401: errorResponses[401],
          409: errorResponses[409],
          429: errorResponses[429],
        },
      },
      config: limit(10),
    },
    async (req) => enrollMfa(ctx, req.body),
  );

  app.post(
    '/v1/auth/staff/mfa/verify',
    {
      schema: {
        tags,
        body: StaffMfaVerifySchema,
        response: {
          200: StaffSessionSchema,
          401: errorResponses[401],
          409: errorResponses[409],
          429: errorResponses[429],
        },
      },
      config: limit(10),
    },
    async (req) => confirmMfa(ctx, req.body, deviceLabel(req)),
  );

  app.post(
    '/v1/auth/staff/login',
    {
      schema: {
        tags,
        body: StaffLoginSchema,
        response: {
          200: StaffSessionSchema,
          401: errorResponses[401],
          403: errorResponses[403],
          429: errorResponses[429],
        },
      },
      config: limit(10),
    },
    async (req) => staffLogin(ctx, req.body, deviceLabel(req)),
  );

  await meRoutes(app, ctx);
};
