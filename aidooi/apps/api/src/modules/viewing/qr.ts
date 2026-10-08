import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../../config.ts';

const HOUR_MS = 3_600_000;
/** A pass works from a day before the visit to a day after, so a rescheduled or late visit still scans. */
const WINDOW_MS = 24 * HOUR_MS;

/** Development and test fallback only; production configuration requires a real secret. */
const DEV_SECRET = 'development-only-viewing-pass-secret-0001';

export const passSecret = (config: Config): string => config.VIEWING_PASS_SECRET ?? DEV_SECRET;

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest();

export interface Pass {
  readonly token: string;
  /** SHA-256 of the token: the only thing stored. */
  readonly hash: string;
  readonly validFrom: number;
  readonly validUntil: number;
}

export const hashPass = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * A pass is a pure function of (secret, viewing, scheduled time): the same inputs always give the
 * same token, so the server stores only its hash and can re-issue the pass on demand, and the buyer
 * can keep it on the phone for offline scanning.
 */
export function issuePass(secret: string, viewingId: string, scheduledAtMs: number): Pass {
  const validFrom = scheduledAtMs - WINDOW_MS;
  const validUntil = scheduledAtMs + WINDOW_MS;
  const payload = b64(JSON.stringify({ v: 1, vid: viewingId, nbf: validFrom, exp: validUntil }));
  const token = `${payload}.${b64(sign(secret, payload))}`;
  return { token, hash: hashPass(token), validFrom, validUntil };
}

export type PassCheck =
  | { readonly ok: true; readonly viewingId: string }
  | {
      readonly ok: false;
      readonly reason: 'malformed' | 'signature' | 'expired' | 'not_yet_valid';
    };

export function verifyPass(secret: string, token: string, nowMs: number): PassCheck {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: 'malformed' };
  const expected = sign(secret, payload);
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'signature' };
  }
  let claims: { v?: unknown; vid?: unknown; nbf?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    claims.v !== 1 ||
    typeof claims.vid !== 'string' ||
    typeof claims.nbf !== 'number' ||
    typeof claims.exp !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (nowMs > claims.exp) return { ok: false, reason: 'expired' };
  if (nowMs < claims.nbf) return { ok: false, reason: 'not_yet_valid' };
  return { ok: true, viewingId: claims.vid };
}
