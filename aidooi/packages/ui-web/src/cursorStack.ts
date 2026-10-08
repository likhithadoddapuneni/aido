/**
 * Keyset pagination can only go forward ("give me what follows this cursor"), so going back means
 * remembering the cursor each page was fetched with. `stack[i]` is the cursor that produced page i;
 * the first page has none (`null`). Pure, so the invariants are property-tested.
 */
export interface CursorStack {
  readonly stack: readonly (string | null)[];
}

export const initialStack = (): CursorStack => ({ stack: [null] });

export const currentCursor = (s: CursorStack): string | null => s.stack[s.stack.length - 1] ?? null;
export const pageNumber = (s: CursorStack): number => s.stack.length;
export const hasPrevious = (s: CursorStack): boolean => s.stack.length > 1;

/** Move to the page after the current one, whose cursor the API returned as `nextCursor`. */
export const advance = (s: CursorStack, nextCursor: string): CursorStack => ({
  stack: [...s.stack, nextCursor],
});

export const goBack = (s: CursorStack): CursorStack =>
  hasPrevious(s) ? { stack: s.stack.slice(0, -1) } : s;

/** A new filter or sort starts over from page one. */
export const reset = initialStack;
