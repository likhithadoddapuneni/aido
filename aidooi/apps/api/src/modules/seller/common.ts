import type { FastifyRequest } from 'fastify';
import { requireSeller } from '../../http/actor.ts';
import { HttpError } from '../../http/problem.ts';

export type SellerActor = ReturnType<typeof requireSeller>;

/** Owners and managers run the business: prices, products, profile, imports. Staff work the shop floor. */
export const requireManager = (req: FastifyRequest): SellerActor =>
  requireSeller(req, ['seller_owner', 'seller_manager']);
export const requireOwner = (req: FastifyRequest): SellerActor =>
  requireSeller(req, ['seller_owner']);

/** Keyset cursor over a text id (business ids sort in creation order). */
export const encodeIdCursor = (id: string): string =>
  Buffer.from(JSON.stringify({ id })).toString('base64url');
export function decodeIdCursor(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { id?: unknown };
    if (typeof v.id === 'string' && v.id.length < 100) return v.id;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'invalid_cursor', 'The pagination cursor is not valid.');
}

export const iso = (d: Date | string): string => new Date(d).toISOString();

/** Escape `%`, `_` and `\` so user text is matched literally by LIKE. */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);
