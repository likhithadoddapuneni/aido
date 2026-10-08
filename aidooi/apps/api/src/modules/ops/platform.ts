import { sql } from 'kysely';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { OpsAuditQuerySchema, PutFeatureFlagBodySchema } from '@aidooi/contracts';
import { recordAudit } from '../../audit.ts';
import { runAs, type AppContext } from '../../context.ts';
import { decodeCursor, pageOf } from '../../http/pagination.ts';
import { notFound } from '../../http/problem.ts';
import { before, iso } from './cursors.ts';
import { guard, ROLES } from './guard.ts';

export async function auditEvents(
  ctx: AppContext,
  req: FastifyRequest,
  q: z.infer<typeof OpsAuditQuerySchema>,
) {
  guard(req, ROLES.auditRead);
  const cursor = decodeCursor(q.cursor);
  return runAs(ctx, req, async (trx) => {
    let query = trx
      .selectFrom('audit.event')
      .selectAll()
      .select(sql<string>`at::text`.as('t'))
      .where(before('at', 'id', cursor));
    if (q.entityType) query = query.where('entity_type', '=', q.entityType);
    if (q.entityId) query = query.where('entity_id', '=', q.entityId);
    if (q.actorId) query = query.where('actor_id', '=', q.actorId);
    if (q.from) query = query.where('at', '>=', new Date(q.from));
    if (q.to) query = query.where('at', '<', new Date(q.to));
    const rows = await query
      .orderBy('at', 'desc')
      .orderBy('id', 'desc')
      .limit(q.limit + 1)
      .execute();
    const page = pageOf(rows, q.limit, (r) => ({ t: r.t, id: r.id }));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        at: iso(r.at),
        entityType: r.entity_type,
        entityId: r.entity_id,
        fromState: r.from_state,
        toState: r.to_state,
        actorType: r.actor_type,
        actorId: r.actor_id,
        reason: r.reason,
        correlationId: r.correlation_id,
        data: (r.data ?? {}) as Record<string, unknown>,
      })),
      nextCursor: page.nextCursor,
    };
  });
}

const flagDto = (r: {
  key: string;
  enabled: boolean;
  rollout_pct: number;
  description: string | null;
  updated_at: Date | string;
}) => ({
  key: r.key,
  enabled: r.enabled,
  rolloutPct: r.rollout_pct,
  description: r.description,
  updatedAt: iso(r.updated_at),
});

export async function listFlags(ctx: AppContext, req: FastifyRequest) {
  guard(req, ROLES.adminOnly);
  return runAs(ctx, req, async (trx) => ({
    flags: (await trx.selectFrom('platform.feature_flag').selectAll().orderBy('key').execute()).map(
      flagDto,
    ),
  }));
}

export async function getFlag(ctx: AppContext, req: FastifyRequest, key: string) {
  guard(req, ROLES.adminOnly);
  return runAs(ctx, req, async (trx) => {
    const r = await trx
      .selectFrom('platform.feature_flag')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst();
    if (!r) throw notFound('Feature flag');
    return flagDto(r);
  });
}

export async function putFlag(
  ctx: AppContext,
  req: FastifyRequest,
  key: string,
  b: z.infer<typeof PutFeatureFlagBodySchema>,
) {
  guard(req, ROLES.adminOnly);
  return runAs(ctx, req, async (trx) => {
    const prev = await trx
      .selectFrom('platform.feature_flag')
      .selectAll()
      .where('key', '=', key)
      .forUpdate()
      .executeTakeFirst();
    const row = await trx
      .insertInto('platform.feature_flag')
      .values({ key, enabled: b.enabled, rollout_pct: b.rolloutPct, description: b.description })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          enabled: b.enabled,
          rollout_pct: b.rolloutPct,
          description: b.description,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    const label = (e: boolean, p: number) => (e ? `on ${p}%` : 'off');
    await recordAudit(trx, {
      entityType: 'feature_flag',
      entityId: key,
      from: prev ? label(prev.enabled, prev.rollout_pct) : null,
      to: label(b.enabled, b.rolloutPct),
      actor: req.actor!,
    });
    return flagDto(row);
  });
}

/** Queue sizes the desk watches, each a single cheap count. "Now" is the application clock. */
export async function overview(ctx: AppContext, req: FastifyRequest) {
  guard(req, ROLES.anyOps);
  const now = new Date(ctx.clock.now());
  const fiveMinAgo = new Date(ctx.clock.now() - 5 * 60_000);
  return runAs(ctx, req, async (trx) => {
    const n = async (q: { executeTakeFirstOrThrow: () => Promise<{ n: string }> }) =>
      Number((await q.executeTakeFirstOrThrow()).n);
    return {
      asOf: now.toISOString(),
      verificationQueue: await n(
        trx
          .selectFrom('catalogue.product')
          .select((e) => e.fn.countAll<string>().as('n'))
          .where('data_status', '=', 'Ready for Review'),
      ),
      openIssues: await n(
        trx
          .selectFrom('fulfilment.issue')
          .select((e) => e.fn.countAll<string>().as('n'))
          .where('state', 'in', ['Open', 'Partner Handling']),
      ),
      confirmationsPastHalfSla: await n(
        trx
          .selectFrom('commerce.confirmation_task')
          .select((e) => e.fn.countAll<string>().as('n'))
          .where('response', 'is', null)
          .where(sql<boolean>`created_at + (due_at - created_at) / 2 <= ${now}`),
      ),
      paymentsStuckAuthorized: await n(
        trx
          .selectFrom('commerce.payment')
          .select((e) => e.fn.countAll<string>().as('n'))
          .where('state', '=', 'Authorized')
          .where('authorized_at', '<', fiveMinAgo),
      ),
      settlementRunsAwaitingApproval: await n(
        trx
          .selectFrom('settlement.settlement_run')
          .select((e) => e.fn.countAll<string>().as('n'))
          .where('state', '=', 'Draft'),
      ),
    };
  });
}
