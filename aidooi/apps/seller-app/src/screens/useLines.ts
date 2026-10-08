import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdvanceTo, LineState } from '../data/seller.ts';
import { useAuth } from '../session/auth.tsx';

export const LINES_KEY = ['lines'] as const;
/** What counts as "active": not yet finished. The API filters by exact state; the default view hides finished ones. */
export const FINISHED: readonly LineState[] = ['Receipt Confirmed', 'Cancelled', 'Refunded'];
export type LineFilter = 'active' | LineState;

export function useLines(filter: LineFilter) {
  const { data } = useAuth();
  return useInfiniteQuery({
    queryKey: [...LINES_KEY, filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const page = await data.lines({
        ...(filter === 'active' ? {} : { state: filter }),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: 25,
      });
      return filter === 'active'
        ? { ...page, items: page.items.filter((l) => !FINISHED.includes(l.state)) }
        : page;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useAdvance() {
  const { data } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: string; to: AdvanceTo; proofPhotoKey?: string; reason?: string }) =>
      data.advance(a.id, {
        to: a.to,
        ...(a.proofPhotoKey ? { proofPhotoKey: a.proofPhotoKey } : {}),
        ...(a.reason ? { reason: a.reason } : {}),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: LINES_KEY }),
  });
}
