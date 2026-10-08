import { z } from 'zod';
import { HttpError } from './problem.ts';

/**
 * Keyset cursors. The timestamp travels as the database's own text rendering so microseconds
 * survive the round trip; a JS Date would truncate them and skip or repeat rows.
 */
const Cursor = z.object({ t: z.string().min(10).max(40), id: z.uuid() });
export type CursorValue = z.infer<typeof Cursor>;

export const encodeCursor = (c: CursorValue): string =>
  Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw: string | undefined): CursorValue | null {
  if (!raw) return null;
  try {
    return Cursor.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw new HttpError(400, 'invalid_cursor', 'The pagination cursor is not valid.');
  }
}

/** Fetch `limit + 1` rows to learn whether there is a next page, then trim. */
export function pageOf<T>(rows: readonly T[], limit: number, cursorOf: (row: T) => CursorValue) {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
}
