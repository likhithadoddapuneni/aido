import { useCallback, useState } from 'react';
import {
  advance,
  currentCursor,
  goBack,
  hasPrevious,
  initialStack,
  pageNumber,
} from '../cursorStack.ts';
import { useT } from '../locale.tsx';
import { Button } from './Button.tsx';

/** State for a list page: pass `cursor` to the query, call `next(nextCursor)` / `previous()` from the controls. */
export function useCursorPagination() {
  const [s, setS] = useState(initialStack);
  return {
    cursor: currentCursor(s),
    page: pageNumber(s),
    hasPrevious: hasPrevious(s),
    next: useCallback((nextCursor: string) => setS((x) => advance(x, nextCursor)), []),
    previous: useCallback(() => setS(goBack), []),
    reset: useCallback(() => setS(initialStack()), []),
  };
}

export interface CursorPaginationProps {
  page: number;
  hasPrevious: boolean;
  /** The API's `nextCursor`; `null` on the last page. */
  nextCursor: string | null | undefined;
  onNext: (cursor: string) => void;
  onPrevious: () => void;
  busy?: boolean | undefined;
}

export function CursorPagination({
  page,
  hasPrevious: canBack,
  nextCursor,
  onNext,
  onPrevious,
  busy,
}: CursorPaginationProps) {
  const t = useT();
  return (
    <nav className="ui-pager" aria-label={t.page}>
      <Button variant="ghost" onClick={onPrevious} disabled={!canBack || busy}>
        {t.previous}
      </Button>
      <span aria-current="page">
        {t.page} <bdi>{page}</bdi>
      </span>
      <Button
        variant="ghost"
        onClick={() => nextCursor && onNext(nextCursor)}
        disabled={!nextCursor || busy}
      >
        {t.next}
      </Button>
    </nav>
  );
}
