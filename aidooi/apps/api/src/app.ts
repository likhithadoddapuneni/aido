import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppContext } from './context.ts';
import { HttpError, isRuleViolation, toProblem } from './http/problem.ts';
import { healthRoutes, type HealthCheck } from './modules/health/routes.ts';
import { MODULES } from './modules/registry.ts';

export interface AppDeps {
  readonly ctx: AppContext;
  /** Readiness probes (database, etc.). Liveness never depends on them. */
  readonly checks?: readonly HealthCheck[];
}

export type App = FastifyInstance;

/**
 * Compose the HTTP application. Everything environmental arrives through `deps`, so tests build
 * the same app the process runs, with fakes where an external system would be.
 */
export async function buildApp(deps: AppDeps): Promise<App> {
  const { ctx } = deps;
  const { config } = ctx;
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // A correlation id travels from the mobile app through every log line and error response.
    requestIdHeader: 'x-correlation-id',
    genReqId: () => randomUUID(),
    bodyLimit: 1_048_576,
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.CORS_ORIGINS, credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'AIDOOi API',
        version: config.RELEASE,
        description: 'Buyers, sellers and operations.',
      },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: jsonSchemaTransform,
  });

  app.decorateRequest('actor', null);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
    const min = config.MIN_APP_VERSION;
    const v = req.headers['x-app-version'];
    if (typeof v === 'string' && min !== '0.0.0' && compareSemver(v, min) < 0) {
      throw new HttpError(
        426,
        'app_version_unsupported',
        `Please update the app (minimum ${min}).`,
      );
    }
    // Who is calling. Anonymous requests have no actor; each route decides what that may do.
    req.actor = await ctx.authenticator.authenticate(req);
  });

  app.setNotFoundHandler((req, reply) => {
    reply
      .code(404)
      .send(toProblem(404, 'route_not_found', `${req.method} ${req.url} does not exist`, req.id));
  });

  app.setErrorHandler((error, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const errors = error.validation.map((v) => ({
        path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
        message: v.message ?? 'Invalid',
      }));
      return reply
        .code(400)
        .send(
          toProblem(
            400,
            'validation_failed',
            'The request did not match the expected shape.',
            req.id,
            errors,
          ),
        );
    }
    if (error instanceof HttpError) {
      return reply
        .code(error.status)
        .send(toProblem(error.status, error.code, error.message, req.id, error.errors));
    }
    if (isRuleViolation(error)) {
      return reply.code(422).send(toProblem(422, error.code, error.message, req.id));
    }
    const status =
      typeof (error as { statusCode?: number }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (status === 429)
      return reply
        .code(429)
        .send(toProblem(429, 'rate_limited', 'Too many requests. Please slow down.', req.id));
    if (status >= 400 && status < 500) {
      return reply
        .code(status)
        .send(toProblem(status, 'bad_request', (error as Error).message, req.id));
    }
    // Unknown failure: log everything, tell the caller nothing but the correlation id.
    req.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(toProblem(500, 'internal_error', undefined, req.id));
  });

  const typed = app.withTypeProvider<ZodTypeProvider>();
  await typed.register(healthRoutes, { checks: deps.checks ?? [], release: config.RELEASE });
  for (const m of MODULES) await m.routes(typed, ctx);

  return app;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
