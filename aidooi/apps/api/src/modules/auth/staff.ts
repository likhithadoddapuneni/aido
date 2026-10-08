import type { Clock } from '@aidooi/domain';
import { type AppContext, type Tx, runAsSystem } from '../../context.ts';
import { recordAudit } from '../../audit.ts';
import type { OpsRole, SellerRole } from '../../http/actor.ts';
import { HttpError } from '../../http/problem.ts';
import type { IdGenerator } from '../../ports.ts';
import { randomToken, sha256Hex } from './crypto.ts';
import { hashPassword, passwordProblem, verifyPassword } from './password.ts';
import { startSession, type TokenPair } from './sessions.ts';
import { authRuntime } from './tokens.ts';
import { generateSeed, otpauthUri, verifyTotp } from './totp.ts';
import { resolveActor, type Subject } from './subjects.ts';

const HOUR_MS = 3_600_000;
const INVITE_TTL_HOURS = 72;
/** After this many consecutive failures an account locks, for 1 minute, doubling each further failure up to an hour. */
const LOCK_AFTER = 5;
const MAX_LOCK_MS = HOUR_MS;

/* ---------------- Invitations (called by the seller-team and ops-onboarding modules) ---------------- */

export interface InviteDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
export interface Invitation {
  readonly userId: string;
  /** Deliver this once (email); only its hash is stored. */
  readonly inviteToken: string;
  readonly expiresAt: Date;
}

async function issueInvite(
  trx: Tx,
  deps: InviteDeps,
  subject: { sellerUserId: string } | { opsUserId: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(deps.clock.now() + INVITE_TTL_HOURS * HOUR_MS);
  // Re-inviting supersedes any earlier, still-open invitation: exactly one token can work at a time.
  const col = 'sellerUserId' in subject ? 'seller_user_id' : 'ops_user_id';
  const id = 'sellerUserId' in subject ? subject.sellerUserId : subject.opsUserId;
  await trx
    .updateTable('identity.staff_invite')
    .set({ consumed_at: new Date(deps.clock.now()) })
    .where(col, '=', id)
    .where('consumed_at', 'is', null)
    .execute();
  await trx
    .insertInto('identity.staff_invite')
    .values({ id: deps.ids.uuid(), [col]: id, token_hash: sha256Hex(token), expires_at: expiresAt })
    .execute();
  return { token, expiresAt };
}

const emailTaken = () =>
  new HttpError(409, 'email_in_use', 'A user with this email already exists.');

export async function inviteSellerUser(
  trx: Tx,
  deps: InviteDeps,
  input: {
    partnerId: string;
    email: string;
    fullName: string;
    role: SellerRole;
    locationId?: string | null;
    phone?: string | null;
  },
): Promise<Invitation> {
  const email = input.email.toLowerCase();
  const existing = await trx
    .selectFrom('identity.seller_user')
    .select(['id', 'status', 'partner_id'])
    .where('email', '=', email)
    .forUpdate()
    .executeTakeFirst();
  let userId: string;
  if (existing) {
    // Only an outstanding invitation for the same partner can be re-issued.
    if (existing.status !== 'Invited' || existing.partner_id !== input.partnerId)
      throw emailTaken();
    userId = existing.id;
    await trx
      .updateTable('identity.seller_user')
      .set({
        full_name: input.fullName,
        role: input.role,
        partner_location_id: input.locationId ?? null,
        phone_e164: input.phone ?? null,
      })
      .where('id', '=', userId)
      .execute();
  } else {
    userId = deps.ids.uuid();
    await trx
      .insertInto('identity.seller_user')
      .values({
        id: userId,
        partner_id: input.partnerId,
        partner_location_id: input.locationId ?? null,
        email,
        phone_e164: input.phone ?? null,
        full_name: input.fullName,
        role: input.role,
        status: 'Invited',
      })
      .execute();
  }
  const { token, expiresAt } = await issueInvite(trx, deps, { sellerUserId: userId });
  return { userId, inviteToken: token, expiresAt };
}

/**
 * Ops users have no 'Invited' status in the schema; an ops user without a credential simply cannot
 * sign in, which is the same guarantee. Accepting the invite creates the credential.
 */
export async function inviteOpsUser(
  trx: Tx,
  deps: InviteDeps,
  input: { email: string; fullName: string; role: OpsRole },
): Promise<Invitation> {
  const email = input.email.toLowerCase();
  const existing = await trx
    .selectFrom('identity.ops_user')
    .select(['id'])
    .where('email', '=', email)
    .forUpdate()
    .executeTakeFirst();
  let userId: string;
  if (existing) {
    const cred = await trx
      .selectFrom('identity.staff_credential')
      .select('id')
      .where('ops_user_id', '=', existing.id)
      .executeTakeFirst();
    if (cred) throw emailTaken();
    userId = existing.id;
    await trx
      .updateTable('identity.ops_user')
      .set({ full_name: input.fullName, role: input.role })
      .where('id', '=', userId)
      .execute();
  } else {
    userId = deps.ids.uuid();
    await trx
      .insertInto('identity.ops_user')
      .values({ id: userId, email, full_name: input.fullName, role: input.role })
      .execute();
  }
  const { token, expiresAt } = await issueInvite(trx, deps, { opsUserId: userId });
  return { userId, inviteToken: token, expiresAt };
}

const invalidInvite = () =>
  new HttpError(400, 'invalid_invite', 'This invitation is invalid or has expired.');

export async function acceptInvite(
  ctx: AppContext,
  input: { token: string; password: string },
): Promise<{ email: string }> {
  const problem = passwordProblem(input.password);
  if (problem) throw new HttpError(422, 'weak_password', problem);
  const passwordHash = await hashPassword(input.password);
  const now = ctx.clock.now();

  return runAsSystem(ctx, async (trx) => {
    const invite = await trx
      .selectFrom('identity.staff_invite')
      .select(['id', 'seller_user_id', 'ops_user_id', 'expires_at', 'consumed_at'])
      .where('token_hash', '=', sha256Hex(input.token))
      .forUpdate()
      .executeTakeFirst();
    if (!invite || invite.consumed_at || new Date(invite.expires_at).getTime() <= now)
      throw invalidInvite();

    const email = invite.seller_user_id
      ? (
          await trx
            .selectFrom('identity.seller_user')
            .select('email')
            .where('id', '=', invite.seller_user_id)
            .executeTakeFirstOrThrow()
        ).email
      : (
          await trx
            .selectFrom('identity.ops_user')
            .select('email')
            .where('id', '=', invite.ops_user_id as string)
            .executeTakeFirstOrThrow()
        ).email;

    const already = await trx
      .selectFrom('identity.staff_credential')
      .select('id')
      .where((eb) =>
        invite.seller_user_id
          ? eb('seller_user_id', '=', invite.seller_user_id)
          : eb('ops_user_id', '=', invite.ops_user_id as string),
      )
      .executeTakeFirst();
    if (already) throw invalidInvite();

    await trx
      .insertInto('identity.staff_credential')
      .values({
        id: ctx.ids.uuid(),
        seller_user_id: invite.seller_user_id,
        ops_user_id: invite.ops_user_id,
        password_hash: passwordHash,
      })
      .execute();
    await trx
      .updateTable('identity.staff_invite')
      .set({ consumed_at: new Date(now) })
      .where('id', '=', invite.id)
      .execute();
    if (invite.seller_user_id) {
      await trx
        .updateTable('identity.seller_user')
        .set({ status: 'Active' })
        .where('id', '=', invite.seller_user_id)
        .execute();
    }
    await recordAudit(trx, {
      entityType: invite.seller_user_id ? 'seller_user' : 'ops_user',
      entityId: (invite.seller_user_id ?? invite.ops_user_id) as string,
      from: invite.seller_user_id ? 'Invited' : null,
      to: 'Active',
      actor: 'system',
      reason: 'invitation accepted',
    });
    return { email };
  });
}

/* ---------------- Sign-in ---------------- */

const invalidCredentials = () =>
  new HttpError(401, 'invalid_credentials', 'The email, password or code is not correct.');

interface StaffAccount {
  readonly subject: Subject;
  readonly credentialId: string;
  readonly passwordHash: string;
  readonly totpSecret: string | null;
  readonly totpConfirmed: boolean;
  readonly lastTotpStep: number | null;
  readonly failedAttempts: number;
  readonly lockedUntil: number | null;
}

async function loadAccount(ctx: AppContext, trx: Tx, email: string): Promise<StaffAccount | null> {
  const seller = await trx
    .selectFrom('identity.seller_user')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirst();
  const ops = seller
    ? undefined
    : await trx
        .selectFrom('identity.ops_user')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst();
  if (!seller && !ops) return null;
  const subject: Subject = seller
    ? { kind: 'seller', id: seller.id }
    : { kind: 'ops', id: (ops as { id: string }).id };
  const cred = await trx
    .selectFrom('identity.staff_credential')
    .selectAll()
    .where(subject.kind === 'seller' ? 'seller_user_id' : 'ops_user_id', '=', subject.id)
    .forUpdate()
    .executeTakeFirst();
  if (!cred) return null;
  const runtime = authRuntime(ctx.config);
  return {
    subject,
    credentialId: cred.id,
    passwordHash: cred.password_hash,
    totpSecret: cred.totp_secret_ciphertext
      ? runtime.secrets.decrypt(cred.totp_secret_ciphertext)
      : null,
    totpConfirmed: cred.totp_confirmed_at !== null,
    lastTotpStep: cred.last_totp_step,
    failedAttempts: cred.failed_attempts,
    lockedUntil: cred.locked_until ? new Date(cred.locked_until).getTime() : null,
  };
}

async function recordFailure(ctx: AppContext, trx: Tx, a: StaffAccount): Promise<void> {
  const failed = a.failedAttempts + 1;
  const lockMs =
    failed >= LOCK_AFTER ? Math.min(MAX_LOCK_MS, 60_000 * 2 ** (failed - LOCK_AFTER)) : 0;
  await trx
    .updateTable('identity.staff_credential')
    .set({
      failed_attempts: failed,
      locked_until: lockMs ? new Date(ctx.clock.now() + lockMs) : null,
    })
    .where('id', '=', a.credentialId)
    .execute();
}

/**
 * Password step shared by login and MFA enrolment. Every failure — unknown email, wrong password,
 * locked, disabled — is the same 401, and costs the same (a password hash is always computed).
 */
async function checkPassword(
  ctx: AppContext,
  trx: Tx,
  email: string,
  password: string,
): Promise<StaffAccount | null> {
  const account = await loadAccount(ctx, trx, email.toLowerCase());
  const passwordOk = await verifyPassword(account?.passwordHash ?? null, password);
  if (!account) return null;
  const locked = account.lockedUntil !== null && account.lockedUntil > ctx.clock.now();
  const active = (await resolveActor(trx, account.subject)) !== null;
  if (!passwordOk || locked || !active) {
    if (!locked) await recordFailure(ctx, trx, account);
    return null;
  }
  return account;
}

export interface StaffSession extends TokenPair {
  readonly staff:
    | {
        readonly kind: 'seller';
        readonly id: string;
        readonly role: string;
        readonly partnerId: string;
      }
    | { readonly kind: 'ops'; readonly id: string; readonly role: string };
}

async function sessionFor(
  ctx: AppContext,
  trx: Tx,
  subject: Subject,
  deviceLabel: string | null,
): Promise<StaffSession> {
  const actor = await resolveActor(trx, subject);
  if (!actor || actor.kind === 'buyer') throw invalidCredentials();
  const tokens = await startSession(ctx, trx, subject, deviceLabel);
  return {
    ...tokens,
    staff:
      actor.kind === 'seller'
        ? { kind: 'seller', id: actor.sellerUserId, role: actor.role, partnerId: actor.partnerId }
        : { kind: 'ops', id: actor.opsUserId, role: actor.role },
  };
}

type Result<T> = { ok: true; value: T } | { ok: false; error: HttpError };

export async function enrollMfa(
  ctx: AppContext,
  input: { email: string; password: string },
): Promise<{ seed: string; otpauthUri: string }> {
  const res = await runAsSystem(
    ctx,
    async (trx): Promise<Result<{ seed: string; otpauthUri: string }>> => {
      const account = await checkPassword(ctx, trx, input.email, input.password);
      if (!account) return { ok: false, error: invalidCredentials() };
      if (account.totpConfirmed) {
        return {
          ok: false,
          error: new HttpError(
            409,
            'mfa_already_enrolled',
            'Two-factor authentication is already set up. Ask an administrator to reset it.',
          ),
        };
      }
      // Re-enrolling before confirming simply replaces the unconfirmed seed.
      const seed = generateSeed();
      await trx
        .updateTable('identity.staff_credential')
        .set({ totp_secret_ciphertext: authRuntime(ctx.config).secrets.encrypt(seed) })
        .where('id', '=', account.credentialId)
        .execute();
      return { ok: true, value: { seed, otpauthUri: otpauthUri(seed, input.email.toLowerCase()) } };
    },
  );
  if (!res.ok) throw res.error;
  return res.value;
}

/** Completes enrolment (when `confirm`) or performs a normal login. Both require a valid, unused code. */
async function signIn(
  ctx: AppContext,
  input: { email: string; password: string; totpCode: string },
  mode: 'confirm' | 'login',
  deviceLabel: string | null,
): Promise<StaffSession> {
  const res = await runAsSystem(ctx, async (trx): Promise<Result<StaffSession>> => {
    const account = await checkPassword(ctx, trx, input.email, input.password);
    if (!account) return { ok: false, error: invalidCredentials() };

    if (mode === 'login' && !account.totpConfirmed) {
      return {
        ok: false,
        error: new HttpError(
          403,
          'mfa_enrolment_required',
          'Set up two-factor authentication before signing in.',
        ),
      };
    }
    if (mode === 'confirm' && (account.totpConfirmed || !account.totpSecret)) {
      return {
        ok: false,
        error: new HttpError(409, 'mfa_not_pending', 'There is no pending two-factor enrolment.'),
      };
    }
    const step = verifyTotp(
      account.totpSecret as string,
      input.totpCode,
      ctx.clock.now(),
      account.lastTotpStep,
    );
    if (step === null) {
      await recordFailure(ctx, trx, account);
      return { ok: false, error: invalidCredentials() };
    }
    await trx
      .updateTable('identity.staff_credential')
      .set({
        last_totp_step: step,
        failed_attempts: 0,
        locked_until: null,
        ...(mode === 'confirm' ? { totp_confirmed_at: new Date(ctx.clock.now()) } : {}),
      })
      .where('id', '=', account.credentialId)
      .execute();
    if (mode === 'confirm' && account.subject.kind === 'ops') {
      await trx
        .updateTable('identity.ops_user')
        .set({ mfa_enrolled: true })
        .where('id', '=', account.subject.id)
        .execute();
    }
    await recordAudit(trx, {
      entityType: `${account.subject.kind}_user`,
      entityId: account.subject.id,
      from: null,
      to: mode === 'confirm' ? 'mfa_enrolled' : 'signed_in',
      actor: 'system',
    });
    return { ok: true, value: await sessionFor(ctx, trx, account.subject, deviceLabel) };
  });
  if (!res.ok) throw res.error;
  return res.value;
}

export const confirmMfa = (
  ctx: AppContext,
  input: { email: string; password: string; totpCode: string },
  device: string | null = null,
) => signIn(ctx, input, 'confirm', device);

export const staffLogin = (
  ctx: AppContext,
  input: { email: string; password: string; totpCode: string },
  device: string | null = null,
) => signIn(ctx, input, 'login', device);
