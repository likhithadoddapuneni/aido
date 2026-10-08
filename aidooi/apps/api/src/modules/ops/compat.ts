import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type {
  ApproveMapBodySchema,
  CompatMapStatusSchema,
  RetireMapBodySchema,
} from '@aidooi/contracts';
import { COMPAT_MAPS, COMPAT_MAP_VERSION } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAs, type AppContext, type Tx } from '../../context.ts';
import { HttpError, notFound } from '../../http/problem.ts';
import { contentHash } from '../catalogue/compat-maps.ts';
import { iso } from './cursors.ts';
import { guard, ROLES } from './guard.ts';

type Kind = 'style' | 'colour' | 'material';
type Status = z.infer<typeof CompatMapStatusSchema>;

const KINDS: readonly Kind[] = ['style', 'colour', 'material'];

async function statusOf(trx: Tx, kind: Kind): Promise<Status> {
  const codeHash = contentHash(COMPAT_MAPS[kind]);
  const rows = await trx
    .selectFrom('catalogue.compat_map_version')
    .selectAll()
    .where('kind', '=', kind)
    .orderBy('created_at')
    .execute();
  const versions = rows.map((r) => ({
    version: r.version,
    hash: contentHash(r.content),
    matchesDeployedCode: r.version === COMPAT_MAP_VERSION && contentHash(r.content) === codeHash,
    approvedBy: r.approved_by,
    activatedAt: r.activated_at ? iso(r.activated_at) : null,
    retiredAt: r.retired_at ? iso(r.retired_at) : null,
  }));
  const current = rows.find((r) => r.version === COMPAT_MAP_VERSION);
  const state: Status['state'] =
    !current || !current.activated_at
      ? 'unapproved'
      : current.retired_at
        ? 'retired'
        : contentHash(current.content) !== codeHash
          ? 'mismatch'
          : 'approved';
  return { kind, codeVersion: COMPAT_MAP_VERSION, codeHash, state, versions };
}

/** What the deployed code ships against what an administrator has approved. */
export async function listMaps(ctx: AppContext, req: FastifyRequest) {
  guard(req, ROLES.catalogueRead);
  return runAs(ctx, req, async (trx) => ({
    maps: await Promise.all(KINDS.map((k) => statusOf(trx, k))),
  }));
}

/**
 * The sign-off gate (gap 5). The content approved is *the code's*: an administrator cannot approve
 * text they typed, only the maps that are actually deployed. Approval is write-once in the database.
 */
export async function approveMap(
  ctx: AppContext,
  req: FastifyRequest,
  kind: Kind,
  b: z.infer<typeof ApproveMapBodySchema>,
) {
  const actor = guard(req, ROLES.adminOnly);
  return runAs(ctx, req, async (trx) => {
    if (b.version !== COMPAT_MAP_VERSION) {
      throw new HttpError(
        422,
        'version_not_deployed',
        `Only the deployed version (${COMPAT_MAP_VERSION}) can be approved.`,
      );
    }
    const existing = await trx
      .selectFrom('catalogue.compat_map_version')
      .selectAll()
      .where('kind', '=', kind)
      .where('version', '=', b.version)
      .forUpdate()
      .executeTakeFirst();
    if (existing) {
      if (contentHash(existing.content) !== contentHash(COMPAT_MAPS[kind])) {
        throw new HttpError(
          409,
          'compat_map_mismatch',
          `An approved ${kind} map ${b.version} with different content exists. Bump the version to approve new content.`,
        );
      }
      if (existing.retired_at)
        throw new HttpError(
          409,
          'version_retired',
          'This version was retired; approve a new version.',
        );
      if (existing.activated_at) return statusOf(trx, kind); // already approved: idempotent
      await trx
        .updateTable('catalogue.compat_map_version')
        .set({ activated_at: new Date(ctx.clock.now()) })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await trx
        .insertInto('catalogue.compat_map_version')
        .values({
          kind,
          version: b.version,
          content: JSON.stringify(COMPAT_MAPS[kind]),
          approved_by: actor.opsUserId,
          activated_at: new Date(ctx.clock.now()),
        })
        .execute();
    }
    await recordAudit(trx, {
      entityType: 'compat_map',
      entityId: `${kind}:${b.version}`,
      from: 'unapproved',
      to: 'approved',
      actor,
      reason: b.reviewNote,
      data: { hash: contentHash(COMPAT_MAPS[kind]) },
    });
    return statusOf(trx, kind);
  });
}

export async function retireMap(
  ctx: AppContext,
  req: FastifyRequest,
  kind: Kind,
  b: z.infer<typeof RetireMapBodySchema>,
) {
  const actor = guard(req, ROLES.adminOnly);
  return runAs(ctx, req, async (trx) => {
    const row = await trx
      .selectFrom('catalogue.compat_map_version')
      .selectAll()
      .where('kind', '=', kind)
      .where('version', '=', b.version)
      .forUpdate()
      .executeTakeFirst();
    if (!row || !row.activated_at) throw notFound('Approved map version');
    if (!row.retired_at) {
      await trx
        .updateTable('catalogue.compat_map_version')
        .set({ retired_at: new Date(ctx.clock.now()) })
        .where('id', '=', row.id)
        .execute();
      await recordAudit(trx, {
        entityType: 'compat_map',
        entityId: `${kind}:${b.version}`,
        from: 'approved',
        to: 'retired',
        actor,
        reason: b.reason,
      });
    }
    return statusOf(trx, kind);
  });
}
