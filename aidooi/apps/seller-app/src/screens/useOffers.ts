import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OfferPatch } from '../domain/stock.ts';
import { useAuth } from '../session/auth.tsx';

export const OFFERS_KEY = ['offers'] as const;

/** Debounce a fast-changing value (a search box) so each keystroke is not a request. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useOffers(search: string) {
  const { data } = useAuth();
  const q = search.trim();
  return useInfiniteQuery({
    queryKey: [...OFFERS_KEY, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      data.offers({ ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}), limit: 25 }),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}

export function usePatchOffer() {
  const { data } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: string; body: OfferPatch }) => data.patchOffer(a.id, a.body),
    onSettled: () => qc.invalidateQueries({ queryKey: OFFERS_KEY }),
  });
}
