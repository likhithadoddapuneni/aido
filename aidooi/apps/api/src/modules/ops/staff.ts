import { sql } from 'kysely';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type {
  InviteStaffBodySchema,
  MfaResetBodySchema,
  PatchStaffBodySchema,
} from '@aidooi/contracts';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext, type Tx } from '../../context.ts';
import { HttpError, notFound } from '../../http/problem.ts';
import { inviteOpsUser } from '../auth/staff.ts';
import { revokeAllFor } from '../auth/sessions.ts';
import { iso } from './cursors.ts';
import { guard, ROLES } from './guard.ts';

// Everything here touches credentials, which only the platform actor can read; the role check
// (administrators only) happens first and every change is audited under the real caller.

async function listOps(trx: Tx) {
  const rows = await trx
    .selectFrom('identity.ops_user as u')
    .leftJoin('identity.staff_credential as c', 'c.ops_user_id', 'u.id')
    .select([
      'u.id',
      'u.email',
      'u.full_name',
      'u.role',
      'u.status',
      'u.mfa_enrolled',
      'c.id as credential_id',
    ])
    .orderBy('u.created_at')
    .orderBy('u.id')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role as 'ops_admin' | 'ops_catalogue' | 'ops_support' | 'ops_finance',
    status: r.status as 'Active' | 'Disabled',
    mfaEnrolled: r.mfa_enrolled,
    hasCredential: r.credential_id !== null,
  }));
}

export async function listStaff(ctx: AppContext, req: FastifyRequest) {
  guard(req, ROLES.adminOnly);
  return runAsSystem(ctx, async (trx) => ({ staff: await listOps(trx) }), req.id);
}

export async function inviteStaff(
  ctx: AppContext,
  req: FastifyRequest,
  b: z.infer<typeof InviteStaffBodySchema>,
) {
  guard(req, ROLES.adminOnly);
  const inv = await runAsSystem(
    ctx,
    async (trx) => {
      const r = await inviteOpsUser(trx, { clock: ctx.clock, ids: ctx.ids }, b);
      await recordAudit(trx, {
        entityType: 'ops_user',
        entityId: r.userId,
        from: null,
        to: 'Invited',
        actor: req.actor!,
        data: { role: b.role },
      });
      return r;
    },
    req.id,
  );
  await ctx.notifier.send({
    template: 'staff.invited',
    to: { kind: 'ops' },
    data: { email: b.email.toLowerCase(), inviteToken: inv.inviteToken },
    dedupeKey: `ops-invite:${inv.userId}:${inv.expiresAt.getTime()}`,
  });
  return { userId: inv.userId, expiresAt: iso(inv.expiresAt) };
}

/** Administrators who can actually sign in (an invited user with no credential is not a safeguard). */
async function activeAdminsExcept(trx: Tx, userId: string): Promise<number> {
  const r = await trx
    .selectFrom('identity.ops_user as u')
    .innerJoin('identity.staff_credential as c', 'c.ops_user_id', 'u.id')
    .select((e) => e.fn.countAll<string>().as('n'))
    .where('u.role', '=', 'ops_admin')
    .where('u.status', '=', 'Active')
    .where('u.id', '<>', userId)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

export async function patchStaff(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  b: z.infer<typeof PatchStaffBodySchema>,
) {
  guard(req, ROLES.adminOnly);
  return runAsSystem(
    ctx,
    async (trx) => {
      // Lock the admin set so two concurrent demotions cannot each see "someone else remains".
      await sql`SELECT pg_advisory_xact_lock(7243093)`.execute(trx);
      const u = await trx
        .selectFrom('identity.ops_user')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!u) throw notFound('Staff member');
      const nextRole = b.role ?? u.role;
      const nextStatus = b.status ?? u.status;
      const losesAdmin =
        u.role === 'ops_admin' &&
        u.status === 'Active' &&
        (nextRole !== 'ops_admin' || nextStatus !== 'Active');
      if (losesAdmin && (await activeAdminsExcept(trx, id)) === 0) {
        throw new HttpError(
          409,
          'last_admin',
          'This is the last administrator who can sign in; promote another first.',
        );
      }
      await trx
        .updateTable('identity.ops_user')
        .set({ role: nextRole, status: nextStatus })
        .where('id', '=', id)
        .execute();
      if (nextStatus === 'Disabled') await revokeAllFor(ctx, trx, { kind: 'ops', id });
      await recordAudit(trx, {
        entityType: 'ops_user',
        entityId: id,
        from: `${u.role}/${u.status}`,
        to: `${nextRole}/${nextStatus}`,
        actor: req.actor!,
      });
      return (await listOps(trx)).find((s) => s.id === id)!;
    },
    req.id,
  );
}

/**
 * Forget an account's authenticator and end every session, so the user must enrol again with their
 * password. Used when a phone is lost; the reason is audited.
 */
export async function resetMfa(
  ctx: AppContext,
  req: FastifyRequest,
  kind: 'ops' | 'seller',
  id: string,
  b: z.infer<typeof MfaResetBodySchema>,
) {
  guard(req, ROLES.adminOnly);
  return runAsSystem(
    ctx,
    async (trx) => {
      const col = kind === 'ops' ? 'ops_user_id' : 'seller_user_id';
      const cred = await trx
        .selectFrom('identity.staff_credential')
        .select('id')
        .where(col, '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!cred)
        throw new HttpError(
          409,
          'no_credential',
          'This user has not accepted their invitation yet.',
        );
      const famCol = kind === 'ops' ? 'ops_user_id' : 'seller_user_id';
      const open = await trx
        .selectFrom('identity.refresh_token_family')
        .select((e) => e.fn.countAll<string>().as('n'))
        .where(famCol, '=', id)
        .where('revoked_at', 'is', null)
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('identity.staff_credential')
        .set({
          totp_secret_ciphertext: null,
          totp_confirmed_at: null,
          last_totp_step: null,
          failed_attempts: 0,
          locked_until: null,
        })
        .where('id', '=', cred.id)
        .execute();
      if (kind === 'ops')
        await trx
          .updateTable('identity.ops_user')
          .set({ mfa_enrolled: false })
          .where('id', '=', id)
          .execute();
      await revokeAllFor(ctx, trx, { kind, id });
      await recordAudit(trx, {
        entityType: `${kind}_user`,
        entityId: id,
        from: 'mfa_enrolled',
        to: 'mfa_reset',
        actor: req.actor!,
        reason: b.reason,
      });
      return { revokedSessions: Number(open.n) };
    },
    req.id,
  );
}
