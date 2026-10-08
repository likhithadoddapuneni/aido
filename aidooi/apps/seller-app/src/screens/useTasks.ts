import { useMemo } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { inbox, type InboxTask } from '../domain/tasks.ts';
import { useAuth } from '../session/auth.tsx';
import { useNow } from '../hooks/useNow.ts';

export const TASKS_KEY = ['tasks'] as const;
const POLL_MS = 30_000;

/** Both kinds of confirmation as one inbox, ordered by what will lapse first, with a ticking clock. */
export function useInbox() {
  const { data } = useAuth();
  const now = useNow(1000);
  const [viewing, purchase] = useQueries({
    queries: [
      {
        queryKey: [...TASKS_KEY, 'viewing'],
        queryFn: () => data.viewingTasks(),
        refetchInterval: POLL_MS,
      },
      {
        queryKey: [...TASKS_KEY, 'purchase'],
        queryFn: () => data.purchaseTasks(),
        refetchInterval: POLL_MS,
      },
    ],
  });
  const tasks = useMemo<InboxTask[]>(
    () => inbox(viewing.data ?? [], purchase.data?.tasks ?? [], now),
    // `now` re-sorts as deadlines approach; the sort is cheap
    [viewing.data, purchase.data, now],
  );
  return {
    tasks,
    now,
    loading: (viewing.isPending || purchase.isPending) && tasks.length === 0,
    error: viewing.error ?? purchase.error,
    refetch: () => Promise.all([viewing.refetch(), purchase.refetch()]),
  };
}

/** Answer a task. Idempotent on the server, so a double tap or a retry cannot do harm. */
export function useRespond() {
  const { data } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: {
      task: InboxTask;
      response: 'Confirmed' | 'Declined';
      displayConfirmed?: boolean;
    }) =>
      a.task.kind === 'viewing'
        ? data.respondViewing(a.task.id, {
            response: a.response,
            ...(a.displayConfirmed !== undefined ? { displayConfirmed: a.displayConfirmed } : {}),
          })
        : data.respondPurchase(a.task.id, a.response),
    onSettled: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}
