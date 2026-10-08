import { ApiProblem } from '@aidooi/api-client';
import {
  Badge,
  CursorPagination,
  useApiMutation,
  useCursorPagination,
  useToast,
  type MutationContext,
  type Tone,
} from '@aidooi/ui-web';
import { keepPreviousData, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCopy, type CatalogueKey } from '../lib/i18n.ts';

/** Status → tone. The label is always text; the tone only reinforces it. */
export const TONES: Record<string, Tone> = {
  Active: 'ok',
  Verified: 'ok',
  Completed: 'ok',
  Paid: 'ok',
  Successful: 'ok',
  Succeeded: 'ok',
  Resolved: 'ok',
  approved: 'ok',
  Approved: 'ok',
  Eligible: 'ok',
  Credited: 'ok',
  Delivered: 'ok',
  'Receipt Confirmed': 'ok',
  Requested: 'neutral',
  'Under Review': 'warn',
  'Approved/Agreement Pending': 'warn',
  'Ready for Review': 'warn',
  Incomplete: 'warn',
  Open: 'warn',
  'Partner Handling': 'warn',
  Pending: 'warn',
  Draft: 'warn',
  'On Hold': 'warn',
  'Issue Reported': 'warn',
  unapproved: 'warn',
  Invited: 'warn',
  Inactive: 'err',
  Disabled: 'err',
  Rejected: 'err',
  Failed: 'err',
  Voided: 'err',
  Cancelled: 'err',
  Refunded: 'err',
  mismatch: 'err',
  retired: 'err',
  'No-show': 'err',
};

/** A translated status word with a tone. */
export function Status({ group, value }: { group: string; value: string | null | undefined }) {
  const copy = useCopy();
  return (
    <Badge tone={value ? (TONES[value] ?? 'neutral') : 'neutral'}>{copy.label(group, value)}</Badge>
  );
}

/** One page of a keyset-paginated list. Filters belong in `key`; change them and call `pager.reset()`. */
export function usePaged<T extends { nextCursor: string | null }>(
  key: QueryKey,
  fetcher: (cursor: string | null) => Promise<T>,
  enabled = true,
) {
  const pager = useCursorPagination();
  const q = useQuery({
    queryKey: [...key, pager.cursor],
    queryFn: () => fetcher(pager.cursor),
    placeholderData: keepPreviousData,
    enabled,
  });
  return { q, pager };
}

export function Pager({
  pager,
  nextCursor,
  busy,
}: {
  pager: ReturnType<typeof useCursorPagination>;
  nextCursor: string | null | undefined;
  busy?: boolean;
}) {
  return (
    <CursorPagination
      page={pager.page}
      hasPrevious={pager.hasPrevious}
      nextCursor={nextCursor}
      onNext={pager.next}
      onPrevious={pager.previous}
      busy={busy}
    />
  );
}

/**
 * A button-press that changes something on the server: toasts the outcome in words, refreshes the
 * queries it affects, and lets the caller show failures (the error is rethrown to `ConfirmDialog`).
 */
export function useAction<TData, TVars = void>(
  fn: (vars: TVars, ctx: MutationContext) => Promise<TData>,
  opts: {
    success?: CatalogueKey;
    successValues?: (data: TData) => Record<string, string | number>;
    invalidate?: readonly QueryKey[];
    idempotent?: boolean;
    onSuccess?: (data: TData) => void;
    onError?: (e: unknown) => void;
  } = {},
) {
  const copy = useCopy();
  const toast = useToast();
  const queries = useQueryClient();
  return useApiMutation<TData, TVars>(fn, {
    ...(opts.idempotent ? { idempotent: true } : {}),
    onSuccess: async (data) => {
      if (opts.success) {
        toast.push({ tone: 'ok', message: copy.t(opts.success, opts.successValues?.(data)) });
      }
      await Promise.all(
        (opts.invalidate ?? []).map((k) => queries.invalidateQueries({ queryKey: k })),
      );
      opts.onSuccess?.(data);
    },
    onError: (e) => opts.onError?.(e),
  });
}

export function LoggedNotice() {
  const copy = useCopy();
  return (
    <p className="ops-notice ops-notice--info" role="note">
      {copy.t('loggedNotice')}
    </p>
  );
}

export function Notice({ children, info = false }: { children: ReactNode; info?: boolean }) {
  return (
    <p className={info ? 'ops-notice ops-notice--info' : 'ops-notice'} role="note">
      {children}
    </p>
  );
}

/** Basis points → a percentage string for a form (1400 → '14'). */
export const bpsToPct = (bps: number): string => String(bps / 100);
/** A percentage typed by a person (14.25) → whole basis points. Rounded, never fractional. */
export const pctToBps = (pct: number): number => Math.round(pct * 100);

export const isProblem = (e: unknown, code: string): boolean =>
  e instanceof ApiProblem && e.code === code;
