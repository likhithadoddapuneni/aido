import { sql, type RawBuilder } from 'kysely';
import { HttpError } from '../../http/problem.ts';
import type { CursorValue } from '../../http/pagination.ts';

/** `(ts, id) < cursor` for newest-first keyset pages; `ts` is compared at full database precision. */
export const before = (tsCol: string, idCol: string, c: CursorValue | null): RawBuilder<boolean> =>
  c
    ? sql<boolean>`(${sql.ref(tsCol)}, ${sql.ref(idCol)}) < (${c.t}::timestamptz, ${c.id}::uuid)`
    : sql<boolean>`true`;

/** Text-keyed pages (business ids like AID-00000012) order by the id alone. */
export const encodeKey = (id: string): string =>
  Buffer.from(JSON.stringify({ k: id })).toString('base64url');
export function decodeKey(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { k?: unknown };
    if (typeof v.k === 'string' && v.k.length < 64) return v.k;
  } catch {
    /* falls through */
  }
  throw new HttpError(400, 'invalid_cursor', 'The pagination cursor is not valid.');
}

export const iso = (d: Date | string): string => new Date(d).toISOString();
