import { useCursorPagination } from '@aidooi/ui-web';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** A keyset-paginated list: the cursor stack lives here, the query re-runs per page, filters reset it. */
export function usePaged<T>(
  key: readonly unknown[],
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
) {
  const pager = useCursorPagination();
  const query = useQuery({
    queryKey: [...key, pager.cursor],
    queryFn: () => fetchPage(pager.cursor ?? undefined),
    placeholderData: keepPreviousData,
  });
  return { pager, query };
}
