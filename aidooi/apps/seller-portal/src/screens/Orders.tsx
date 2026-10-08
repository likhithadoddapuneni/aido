import { unwrap } from '@aidooi/api-client';
import type { SellerLineSchema } from '@aidooi/contracts';
import {
  Badge,
  Button,
  Dialog,
  CursorPagination,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  FilterBar,
  Money,
  PageHeader,
  Select,
  StatusPill,
  Textarea,
  useApi,
  useApiMutation,
  useProblemText,
  useToast,
  type Column,
} from '@aidooi/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { Guard } from '../components/Guard.tsx';
import { ProofDialog } from '../components/ProofDialog.tsx';
import { LINE_TONE, labelled } from '../components/pills.ts';
import { useS } from '../i18n/index.tsx';
import { usePaged } from '../lib/paged.ts';

type Line = z.infer<typeof SellerLineSchema>;
type State = Line['state'];

/** The one step forward a seller may take from each state; Delivered needs proof, receipt is the buyer's. */
const NEXT: Partial<
  Record<State, 'Preparing' | 'Ready for Dispatch' | 'Dispatched' | 'Delivered'>
> = {
  Confirmed: 'Preparing',
  Preparing: 'Ready for Dispatch',
  'Ready for Dispatch': 'Dispatched',
  Dispatched: 'Delivered',
};
const CANCELLABLE: ReadonlySet<State> = new Set(['Confirmed', 'Preparing', 'Ready for Dispatch']);
const STATES: readonly State[] = [
  'Confirmed',
  'Preparing',
  'Ready for Dispatch',
  'Dispatched',
  'Delivered',
  'Receipt Confirmed',
  'Cancelled',
  'Refunded',
];

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function OrdersScreen() {
  return (
    <Guard action="advanceOrders">
      <OrdersBody />
    </Guard>
  );
}

function OrdersBody() {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const queries = useQueryClient();
  const problemText = useProblemText();
  const [draft, setDraft] = useState<'' | State>('Confirmed');
  const [applied, setApplied] = useState<'' | State>('Confirmed');
  const [proof, setProof] = useState<Line | null>(null);
  const [cancelling, setCancelling] = useState<Line | null>(null);
  const [reason, setReason] = useState('');

  const { pager, query } = usePaged<Line>(['lines', applied], (cursor) =>
    unwrap(
      api.http.GET('/v1/seller/order-lines', {
        params: {
          query: {
            limit: 25,
            ...(cursor ? { cursor } : {}),
            ...(applied ? { state: applied } : {}),
          },
        },
      }),
    ),
  );
  const refresh = () => queries.invalidateQueries({ queryKey: ['lines'] });

  const advance = useApiMutation(
    async (v: {
      id: string;
      to: 'Preparing' | 'Ready for Dispatch' | 'Dispatched';
      name: string;
    }) =>
      unwrap(
        api.http.POST('/v1/seller/order-lines/{id}/advance', {
          params: { path: { id: v.id } },
          body: { to: v.to },
        }),
      ),
    {
      onSuccess: async (_r, v) => {
        toast.push({
          message: s.fmt('lineAdvanced', { name: v.name, state: s.lineStates[v.to] }),
          tone: 'ok',
        });
        await refresh();
      },
      onError: (e) => toast.push({ message: problemText(e), tone: 'err' }),
    },
  );
  const cancel = useApiMutation(
    async (v: { id: string; reason: string }) =>
      unwrap(
        api.http.POST('/v1/seller/order-lines/{id}/advance', {
          params: { path: { id: v.id } },
          body: { to: 'Cancelled', reason: v.reason },
        }),
      ),
    {
      onSuccess: async () => {
        setCancelling(null);
        setReason('');
        await refresh();
      },
    },
  );

  const columns: Column<Line>[] = [
    {
      id: 'product',
      header: s.product,
      cell: (l) => (
        <>
          <strong>{l.productName}</strong>
          <br />
          <small>
            ×{l.quantity} · <DateTime value={l.createdAt} />
          </small>
        </>
      ),
    },
    {
      id: 'total',
      header: s.lineTotal,
      numeric: true,
      cell: (l) => <Money fils={l.grossLineFils} />,
    },
    {
      id: 'state',
      header: s.status,
      cell: (l) => (
        <StatusPill status={s.lineStates[l.state]} map={labelled(s.lineStates, LINE_TONE)} />
      ),
    },
    {
      id: 'delivery',
      header: s.deliverTo,
      cell: (l) =>
        l.delivery ? (
          <>
            {l.delivery.recipientName}
            <br />
            <small>
              {[l.delivery.line1, l.delivery.area, l.delivery.emirate].filter(Boolean).join(', ')} ·{' '}
              <bdi dir="ltr">{l.delivery.phone}</bdi>
            </small>
          </>
        ) : (
          '—'
        ),
    },
    {
      id: 'issues',
      header: s.issues,
      numeric: true,
      cell: (l) => (l.openIssues > 0 ? <Badge tone="err">{l.openIssues}</Badge> : '0'),
    },
    {
      id: 'actions',
      header: <span className="ui-visually-hidden">{s.actions}</span>,
      cell: (l) => {
        const next = NEXT[l.state];
        return (
          <span className="portal-actions">
            {next === 'Delivered' ? (
              <Button
                variant="primary"
                onClick={() => setProof(l)}
                aria-label={s.fmt('markDeliveredFor', { name: l.productName })}
              >
                {s.markDelivered}
              </Button>
            ) : next ? (
              <Button
                variant="primary"
                loading={advance.isPending && advance.variables?.id === l.id}
                disabled={l.openIssues > 0}
                title={l.openIssues > 0 ? s.openIssueBlocks : undefined}
                onClick={() => advance.mutate({ id: l.id, to: next, name: l.productName })}
                aria-label={s.fmt('advanceFor', {
                  action: s.advanceLabels[next],
                  name: l.productName,
                })}
              >
                {s.advanceLabels[next]}
              </Button>
            ) : null}
            {CANCELLABLE.has(l.state) && (
              <Button
                variant="ghost"
                onClick={() => setCancelling(l)}
                aria-label={s.fmt('cancelFor', { name: l.productName })}
              >
                {s.cancelLine}
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title={s.navOrders} description={s.ordersIntro} />
      <FilterBar
        onSubmit={() => {
          pager.reset();
          setApplied(draft);
        }}
        onClear={() => {
          pager.reset();
          setDraft('');
          setApplied('');
        }}
      >
        <Field label={s.status}>
          <Select value={draft} onChange={(e) => setDraft(e.target.value as '' | State)}>
            <option value="">{s.any}</option>
            {STATES.map((st) => (
              <option key={st} value={st}>
                {s.lineStates[st]}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <DataTable
        caption={s.navOrders}
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(l) => l.id}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={s.noLines} description={s.noLinesText} />}
      />
      <CursorPagination
        page={pager.page}
        hasPrevious={pager.hasPrevious}
        nextCursor={query.data?.nextCursor}
        onNext={pager.next}
        onPrevious={pager.previous}
        busy={query.isFetching}
      />
      <ProofDialog
        lineId={proof?.id ?? null}
        productName={proof?.productName ?? ''}
        onClose={() => setProof(null)}
        onDelivered={() => {
          setProof(null);
          toast.push({ message: s.lineDelivered, tone: 'ok' });
          void refresh();
        }}
      />
      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={s.fmt('cancelFor', { name: cancelling?.productName ?? '' })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(null)}>
              {s.keepLine}
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              disabled={reason.trim().length < 3}
              onClick={() =>
                cancelling && cancel.mutate({ id: cancelling.id, reason: reason.trim() })
              }
            >
              {s.cancelLine}
            </Button>
          </>
        }
      >
        <p>{s.cancelWarning}</p>
        <Field label={s.reason} hint={s.reasonHint}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {cancel.error ? (
          <p role="alert" className="portal-error">
            {problemText(cancel.error)}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
