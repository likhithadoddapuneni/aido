import { LiveResponseSchema, ReadyResponseSchema } from '@aidooi/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export interface HealthCheck {
  readonly name: string;
  run(): Promise<void>;
}

export const healthRoutes: FastifyPluginAsyncZod<{
  checks: readonly HealthCheck[];
  release: string;
}> = async (app, opts) => {
  // Liveness: the process is up. Must never depend on a downstream, or a database blip restarts every task.
  app.get(
    '/health/live',
    { schema: { tags: ['ops'], response: { 200: LiveResponseSchema } } },
    async () => ({ status: 'ok' as const }),
  );

  // Readiness: safe to receive traffic.
  app.get(
    '/health/ready',
    { schema: { tags: ['ops'], response: { 200: ReadyResponseSchema, 503: ReadyResponseSchema } } },
    async (_req, reply) => {
      const checks: Record<string, 'ok' | 'fail'> = {};
      await Promise.all(
        opts.checks.map(async (c) => {
          try {
            await c.run();
            checks[c.name] = 'ok';
          } catch {
            checks[c.name] = 'fail';
          }
        }),
      );
      const ok = Object.values(checks).every((v) => v === 'ok');
      return reply
        .code(ok ? 200 : 503)
        .send({ status: ok ? 'ok' : 'degraded', checks, version: opts.release });
    },
  );
};
