import type { Transaction } from 'kysely';
import type { DB } from '@aidooi/db';
import type { AppContext } from '../../context.ts';
import { randomToken, sha256Hex } from './crypto.ts';
import { resolveActor, type Subject } from './subjects.ts';
import { authRuntime } from './tokens.ts';

type Trx = Transaction<DB>;

const REFRESH_TTL_DAYS = { buyer: 30, seller: 7, ops: 7 } as const;
const DAY_MS = 86_400_000;

export interface TokenPair {
  readonly tokenType: 'Bearer';
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
}

const subjectColumns = (s: Subject) =>
  ({
    customer_id: s.kind === 'buyer' ? s.id : null,
    seller_user_id: s.kind === 'seller' ? s.id : null,
    ops_user_id: s.kind === 'ops' ? s.id : null,
  }) as const;

async function mint(ctx: AppContext, trx: Trx, s: Subject, familyId: string): Promise<TokenPair> {
  const now = ctx.clock.now();
  const refreshToken = randomToken();
  await trx
    .insertInto('identity.refresh_token')
    .values({
      family_id: familyId,
      token_hash: sha256Hex(refreshToken),
      expires_at: new Date(now + REFRESH_TTL_DAYS[s.kind] * DAY_MS),
    })
    .execute();
  const access = await authRuntime(ctx.config).signAccess({ kind: s.kind, sub: s.id }, now);
  return {
    tokenType: 'Bearer',
    accessToken: access.token,
    expiresIn: access.expiresInSeconds,
    refreshToken,
  };
}

/** A new login: one family per device, so one stolen token can be traced and revoked on its own. */
export async function startSession(
  ctx: AppContext,
  trx: Trx,
  s: Subject,
  deviceLabel: string | null = null,
): Promise<TokenPair> {
  const family = await trx
    .insertInto('identity.refresh_token_family')
    .values({ ...subjectColumns(s), device_label: deviceLabel })
    .returning('id')
    .executeTakeFirstOrThrow();
  return mint(ctx, trx, s, family.id);
}

export type RotationResult =
  | { readonly ok: true; readonly subject: Subject; readonly tokens: TokenPair }
  | { readonly ok: false; readonly reason: 'invalid' | 'reuse' | 'inactive' };

/**
 * Exchange a refresh token for a new pair. A token that was already exchanged means two parties hold
 * it — the thief and the owner — so the whole family is revoked and both must sign in again. The
 * caller commits the transaction even on failure, otherwise the revocation would roll back.
 */
export async function rotateRefresh(
  ctx: AppContext,
  trx: Trx,
  presented: string,
): Promise<RotationResult> {
  const row = await trx
    .selectFrom('identity.refresh_token as t')
    .innerJoin('identity.refresh_token_family as f', 'f.id', 't.family_id')
    .select([
      't.id as token_id',
      't.family_id',
      't.used_at',
      't.expires_at',
      'f.revoked_at',
      'f.customer_id',
      'f.seller_user_id',
      'f.ops_user_id',
    ])
    .where('t.token_hash', '=', sha256Hex(presented))
    .forUpdate()
    .executeTakeFirst();
  if (!row || row.revoked_at) return { ok: false, reason: 'invalid' };

  const now = ctx.clock.now();
  const revoke = (reason: 'reuse_detected' | 'admin') =>
    trx
      .updateTable('identity.refresh_token_family')
      .set({ revoked_at: new Date(now), revoked_reason: reason })
      .where('id', '=', row.family_id)
      .execute();

  if (row.used_at) {
    await revoke('reuse_detected');
    return { ok: false, reason: 'reuse' };
  }
  if (new Date(row.expires_at).getTime() <= now) return { ok: false, reason: 'invalid' };

  const subject: Subject = row.customer_id
    ? { kind: 'buyer', id: row.customer_id }
    : row.seller_user_id
      ? { kind: 'seller', id: row.seller_user_id }
      : { kind: 'ops', id: row.ops_user_id as string };
  if (!(await resolveActor(trx, subject))) {
    await revoke('admin');
    return { ok: false, reason: 'inactive' };
  }

  await trx
    .updateTable('identity.refresh_token')
    .set({ used_at: new Date(now) })
    .where('id', '=', row.token_id)
    .execute();
  await trx
    .updateTable('identity.refresh_token_family')
    .set({ last_rotated_at: new Date(now) })
    .where('id', '=', row.family_id)
    .execute();
  return { ok: true, subject, tokens: await mint(ctx, trx, subject, row.family_id) };
}

/** Logout ends one device's session. Unknown or already-ended tokens are a no-op, never an error. */
export async function revokeByRefreshToken(
  ctx: AppContext,
  trx: Trx,
  presented: string,
): Promise<void> {
  const t = await trx
    .selectFrom('identity.refresh_token')
    .select('family_id')
    .where('token_hash', '=', sha256Hex(presented))
    .executeTakeFirst();
  if (!t) return;
  await trx
    .updateTable('identity.refresh_token_family')
    .set({ revoked_at: new Date(ctx.clock.now()), revoked_reason: 'logout' })
    .where('id', '=', t.family_id)
    .where('revoked_at', 'is', null)
    .execute();
}

export async function revokeAllFor(
  ctx: AppContext,
  trx: Trx,
  s: Subject,
  reason: 'admin' | 'logout' = 'admin',
): Promise<void> {
  const col =
    s.kind === 'buyer' ? 'customer_id' : s.kind === 'seller' ? 'seller_user_id' : 'ops_user_id';
  await trx
    .updateTable('identity.refresh_token_family')
    .set({ revoked_at: new Date(ctx.clock.now()), revoked_reason: reason })
    .where(col, '=', s.id)
    .where('revoked_at', 'is', null)
    .execute();
}
