import { unwrap } from '@aidooi/api-client';
import {
  Button,
  ConfirmDialog,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  FilterBar,
  PageHeader,
  Select,
  Textarea,
  useApi,
  type Column,
} from '@aidooi/ui-web';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useCopy } from '../lib/i18n.ts';
import { Notice, Pager, Status, useAction, usePaged } from './common.tsx';

type Issue = {
  id: string;
  orderLineId: string;
  flag: string;
  state: string;
  note: string | null;
  raisedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  productName: string;
};
const STATES = ['Open', 'Partner Handling', 'Resolved', 'Refunded', 'Rejected'] as const;
const OUTCOMES = ['Resolved', 'Refunded', 'Rejected'] as const;
type Outcome = (typeof OUTCOMES)[number];

export function IssuesScreen() {
  const copy = useCopy();
  const api = useApi();
  const [state, setState] = useState<string>('Open');
  const [target, setTarget] = useState<Issue | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('Resolved');
  const [note, setNote] = useState('');
  const { q, pager } = usePaged(['issues', state], (cursor) =>
    unwrap(
      api.http.GET('/v1/ops/issues', {
        params: {
          query: {
            ...(state ? { state: state as (typeof STATES)[number] } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
  const resolve = useAction(
    (v: { id: string; resolution: Outcome; note: string }) =>
      unwrap(
        api.http.POST('/v1/ops/issues/{id}/resolve', {
          params: { path: { id: v.id } },
          body: { resolution: v.resolution, note: v.note },
        }),
      ),
    { success: 'is.resolved.done', invalidate: [['issues'], ['overview'], ['order']] },
  );
  const close = () => {
    setTarget(null);
    setNote('');
    setOutcome('Resolved');
  };
  const columns: Column<Issue>[] = [
    { id: 'item', header: copy.t('is.item'), cell: (i) => i.productName },
    { id: 'flag', header: copy.t('is.flag'), cell: (i) => copy.label('if', i.flag) },
    { id: 'state', header: copy.t('status'), cell: (i) => <Status group="is" value={i.state} /> },
    {
      id: 'note',
      header: copy.t('note'),
      cell: (i) => i.resolutionNote ?? i.note ?? copy.t('none'),
    },
    { id: 'raised', header: copy.t('is.raised'), cell: (i) => <DateTime value={i.raisedAt} /> },
    {
      id: 'actions',
      header: copy.t('actions'),
      cell: (i) =>
        i.state === 'Open' || i.state === 'Partner Handling' ? (
          <Button onClick={() => setTarget(i)}>{copy.t('is.resolve')}</Button>
        ) : null,
    },
  ];
  const refunding = outcome === 'Refunded';
  return (
    <div className="ops-stack">
      <PageHeader
        title={copy.t('is.title')}
        description={
          <>
            {copy.t('is.desc')} <Link to="/orders">{copy.t('nav.orders')}</Link>
          </>
        }
      />
      <FilterBar onClear={() => (setState('Open'), pager.reset())}>
        <Field label={copy.t('status')}>
          <Select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              pager.reset();
            }}
          >
            <option value="">{copy.t('all')}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {copy.label('is', s)}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <DataTable
        caption={copy.t('is.title')}
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(i) => i.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        empty={<EmptyState title={copy.t('none')} />}
      />
      <Pager pager={pager} nextCursor={q.data?.nextCursor} busy={q.isFetching} />
      <ConfirmDialog
        open={target !== null}
        danger={refunding}
        title={copy.t(refunding ? 'is.refundTitle' : 'is.resolveTitle')}
        description={target ? `${target.productName} — ${copy.label('if', target.flag)}` : ''}
        confirmLabel={copy.t(refunding ? 'is.resolve' : 'confirm')}
        disabled={note.trim().length < 1}
        onConfirm={async () => {
          if (!target) return;
          await resolve.mutateAsync({ id: target.id, resolution: outcome, note: note.trim() });
        }}
        onClose={close}
      >
        <Field label={copy.t('is.resolution')}>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {copy.label('is', o)}
              </option>
            ))}
          </Select>
        </Field>
        {refunding && <Notice>{copy.t('is.refundWarn')}</Notice>}
        <Field label={copy.t('note')} required>
          <Textarea
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
