import { randomInt } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { type AppContext, type Tx, runAsSystem } from '../../context.ts';
import { HttpError } from '../../http/problem.ts';
import type { OAuthProvider } from '../../ports.ts';
import { recordAudit } from '../../audit.ts';
import { randomToken, safeEqual, sha256Hex } from './crypto.ts';
import { ProviderIdTokenVerifier } from './id-tokens.ts';
import { startSession, type TokenPair } from './sessions.ts';
import { authRuntime } from './tokens.ts';

const DAY_MS = 86_400_000;
const GUEST_TTL_DAYS = 30;
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
/** Per phone number: at most this many codes per hour, and none closer together than the cooldown. */
const OTP_PER_HOUR = 5;
const OTP_COOLDOWN_MS = 30_000;

export interface BuyerSession extends TokenPair {
  readonly customer: { readonly id: string; readonly isNew: boolean };
}

/* ---------------- Guests ---------------- */

export async function createGuestSession(
  ctx: AppContext,
): Promise<{ guestToken: string; expiresAt: Date }> {
  const guestToken = randomToken();
  const expiresAt = new Date(ctx.clock.now() + GUEST_TTL_DAYS * DAY_MS);
  await runAsSystem(ctx, (trx) =>
    trx
      .insertInto('identity.guest_session')
      .values({ id: ctx.ids.uuid(), token_hash: sha256Hex(guestToken), expires_at: expiresAt })
      .execute(),
  );
  return { guestToken, expiresAt };
}

/**
 * Turn a guest session into a customer in place. The project the guest was building is re-owned, so
 * signing in at checkout never restarts anything (gap #13). A stale or foreign guest token is ignored:
 * it must never stop a legitimate sign-in.
 */
async function upgradeGuest(
  ctx: AppContext,
  trx: Tx,
  guestToken: string | undefined,
  customerId: string,
): Promise<void> {
  if (!guestToken) return;
  const session = await trx
    .selectFrom('identity.guest_session')
    .select(['id', 'expires_at', 'customer_id'])
    .where('token_hash', '=', sha256Hex(guestToken))
    .forUpdate()
    .executeTakeFirst();
  const now = ctx.clock.now();
  if (!session || session.customer_id || new Date(session.expires_at).getTime() <= now) return;
  await trx
    .updateTable('identity.guest_session')
    .set({ customer_id: customerId, upgraded_at: new Date(now) })
    .where('id', '=', session.id)
    .execute();
  await trx
    .updateTable('recommendation.project')
    .set({ customer_id: customerId, guest_session_id: null })
    .where('guest_session_id', '=', session.id)
    .execute();
}

/* ---------------- Customers ---------------- */

type NewCustomer = { phone: string } | { email: string };

async function createCustomer(
  ctx: AppContext,
  trx: Tx,
  who: NewCustomer,
  policyVersion: string,
): Promise<string> {
  const inserted = await trx
    .insertInto('identity.customer')
    .values({
      id: ctx.ids.uuid(),
      phone_e164: 'phone' in who ? who.phone : null,
      email: 'email' in who ? who.email : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('identity.consent')
    .values({
      customer_id: inserted.id,
      purpose: 'terms',
      policy_version: policyVersion,
      granted_at: new Date(ctx.clock.now()),
    })
    .execute();
  await recordAudit(trx, {
    entityType: 'customer',
    entityId: inserted.id,
    from: null,
    to: 'Active',
    actor: 'system',
    reason: 'sign-up',
  });
  return inserted.id;
}

async function openSession(
  ctx: AppContext,
  trx: Tx,
  customerId: string,
  isNew: boolean,
  deviceLabel: string | null,
): Promise<BuyerSession> {
  const tokens = await startSession(ctx, trx, { kind: 'buyer', id: customerId }, deviceLabel);
  return { ...tokens, customer: { id: customerId, isNew } };
}

/* ---------------- Phone OTP ---------------- */

/**
 * Always succeeds from the caller's point of view: whether the number is known, throttled or the
 * channel failed must not be observable (no enumeration, no SMS-bombing oracle).
 */
export async function requestOtp(
  ctx: AppContext,
  log: FastifyBaseLogger,
  input: { phone: string; channel: 'sms' | 'whatsapp' },
): Promise<void> {
  const secrets = authRuntime(ctx.config).secrets;
  const destination = secrets.mac('phone', input.phone);
  const now = ctx.clock.now();

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = ctx.ids.uuid();
  const send = await runAsSystem(ctx, async (trx) => {
    const recent = await trx
      .selectFrom('identity.otp_challenge')
      .select('created_at')
      .where('destination_hash', '=', destination)
      .where('created_at', '>', new Date(now - 3_600_000))
      .orderBy('created_at', 'desc')
      .execute();
    const last = recent[0];
    if (recent.length >= OTP_PER_HOUR) return false;
    if (last && now - new Date(last.created_at).getTime() < OTP_COOLDOWN_MS) return false;
    await trx
      .insertInto('identity.otp_challenge')
      .values({
        id,
        channel: input.channel,
        destination_hash: destination,
        code_hash: secrets.mac('otp', `${id}:${code}`),
        max_attempts: OTP_MAX_ATTEMPTS,
        created_at: new Date(now),
        expires_at: new Date(now + OTP_TTL_MS),
      })
      .execute();
    return true;
  });
  if (!send) return;
  try {
    await ctx.otp.send(input.channel, input.phone, code);
  } catch (err) {
    log.error({ err, channel: input.channel }, 'OTP delivery failed');
  }
}

const invalidCode = () =>
  new HttpError(401, 'invalid_code', 'That code is not valid. Request a new one.');
const consentRequired = () =>
  new HttpError(422, 'consent_required', 'Accept the current terms to create your account.');

export async function verifyOtp(
  ctx: AppContext,
  input: {
    phone: string;
    code: string;
    guestToken?: string | undefined;
    policyVersion?: string | undefined;
  },
  deviceLabel: string | null = null,
): Promise<BuyerSession> {
  const secrets = authRuntime(ctx.config).secrets;
  const destination = secrets.mac('phone', input.phone);
  const now = ctx.clock.now();

  type Outcome = { ok: true; session: BuyerSession } | { ok: false; error: HttpError };

  // The attempt counter must survive a failed guess, so failures are returned (committing) and thrown after.
  const outcome = await runAsSystem(ctx, async (trx): Promise<Outcome> => {
    const challenge = await trx
      .selectFrom('identity.otp_challenge')
      .select(['id', 'code_hash', 'attempts', 'max_attempts'])
      .where('destination_hash', '=', destination)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', new Date(now))
      .orderBy('created_at', 'desc')
      .limit(1)
      .forUpdate()
      .executeTakeFirst();

    // Compare even when there is nothing to compare against, so every failure costs the same.
    const expected = challenge?.code_hash ?? secrets.mac('otp', 'no-challenge');
    const matches = safeEqual(
      secrets.mac('otp', `${challenge?.id ?? 'none'}:${input.code}`),
      expected,
    );

    if (!challenge || challenge.attempts >= challenge.max_attempts)
      return { ok: false, error: invalidCode() };
    if (!matches) {
      await trx
        .updateTable('identity.otp_challenge')
        .set({ attempts: challenge.attempts + 1 })
        .where('id', '=', challenge.id)
        .execute();
      return { ok: false, error: invalidCode() };
    }

    const existing = await trx
      .selectFrom('identity.customer')
      .select(['id'])
      .where('phone_e164', '=', input.phone)
      .where('status', '=', 'Active')
      .executeTakeFirst();
    if (!existing && !input.policyVersion) return { ok: false, error: consentRequired() };

    await trx
      .updateTable('identity.otp_challenge')
      .set({ consumed_at: new Date(now) })
      .where('id', '=', challenge.id)
      .execute();
    const customerId =
      existing?.id ??
      (await createCustomer(ctx, trx, { phone: input.phone }, input.policyVersion as string));
    await upgradeGuest(ctx, trx, input.guestToken, customerId);
    return { ok: true, session: await openSession(ctx, trx, customerId, !existing, deviceLabel) };
  });
  if (!outcome.ok) throw outcome.error;
  return outcome.session;
}

/* ---------------- Social sign-in ---------------- */

export async function signInWithProvider(
  ctx: AppContext,
  provider: OAuthProvider,
  input: { idToken: string; guestToken?: string | undefined; policyVersion?: string | undefined },
  deviceLabel: string | null = null,
): Promise<BuyerSession> {
  const verifier = ctx.idTokens ?? new ProviderIdTokenVerifier(ctx.config);
  let identity;
  try {
    const verified = await verifier.verify(provider, input.idToken);
    identity = { ...verified, email: verified.email?.toLowerCase() ?? null };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'invalid_id_token', 'The sign-in token could not be verified.');
  }

  return runAsSystem(ctx, async (trx) => {
    const linked = await trx
      .selectFrom('identity.oauth_identity as o')
      .innerJoin('identity.customer as c', 'c.id', 'o.customer_id')
      .select('c.id')
      .where('o.provider', '=', provider)
      .where('o.subject', '=', identity.subject)
      .where('c.status', '=', 'Active')
      .executeTakeFirst();

    // Only a *verified* email may attach a provider login to an existing account; otherwise anyone could
    // claim someone else's account by registering their address with a lax provider.
    const byEmail =
      !linked && identity.email && identity.emailVerified
        ? await trx
            .selectFrom('identity.customer')
            .select('id')
            .where('email', '=', identity.email)
            .where('status', '=', 'Active')
            .executeTakeFirst()
        : undefined;

    const existingId = linked?.id ?? byEmail?.id;
    if (!existingId && !input.policyVersion) throw consentRequired();
    const customerId =
      existingId ??
      (await createCustomer(
        ctx,
        trx,
        identity.email && identity.emailVerified
          ? { email: identity.email }
          : { email: `${provider}.${identity.subject}@users.invalid` },
        input.policyVersion as string,
      ));
    if (!linked) {
      await trx
        .insertInto('identity.oauth_identity')
        .values({
          provider,
          subject: identity.subject,
          customer_id: customerId,
          email: identity.email,
        })
        .onConflict((oc) => oc.columns(['provider', 'subject']).doNothing())
        .execute();
    }
    await upgradeGuest(ctx, trx, input.guestToken, customerId);
    return openSession(ctx, trx, customerId, !existingId, deviceLabel);
  });
}
