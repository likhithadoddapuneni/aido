import { unwrap } from '@aidooi/api-client';
import {
  DataTable,
  DateTime,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  PageHeader,
  Tabs,
  Timeline,
  useApi,
  type Column,
} from '@aidooi/ui-web';
import { useState } from 'react';
import { useCopy } from '../lib/i18n.ts';
import { dubaiInstant } from '../lib/time.ts';
import { Pager, usePaged } from './common.tsx';

type Event = {
  id: string;
  at: string;
  entityType: string;
  entityId: string;
  fromState: string | null;
  toState: string | null;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  correlationId: string | null;
};
type Filters = { entityType: string; entityId: string; actorId: string; from: string; to: string };
const NONE: Filters = { entityType: '', entityId: '', actorId: '', from: '', to: '' };
export function AuditScreen() {
  const copy = useCopy();
  const api = useApi();
  const [draft, setDraft] = useState<Filters>(NONE);
  const [applied, setApplied] = useState<Filters>(NONE);
  const { q, pager } = usePaged(['audit', applied], (cursor) => {
    const from = dubaiInstant(applied.from);
    const to = dubaiInstant(applied.to);
    return unwrap(
      api.http.GET('/v1/ops/audit', {
        params: {
          query: {
            ...(applied.entityType ? { entityType: applied.entityType } : {}),
            ...(applied.entityId ? { entityId: applied.entityId } : {}),
            ...(applied.actorId ? { actorId: applied.actorId } : {}),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    );
  });
  const set = (k: keyof Filters) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));
  const items: Event[] = q.data?.items ?? [];
  const columns: Column<Event>[] = [
    { id: 'at', header: copy.t('au.when'), cell: (e) => <DateTime value={e.at} /> },
    {
      id: 'entity',
      header: copy.t('au.entityType'),
      cell: (e) => (
        <>
          {e.entityType} <bdi>{e.entityId}</bdi>
        </>
      ),
    },
    {
      id: 'change',
      header: copy.t('au.change'),
      cell: (e) => `${e.fromState ?? copy.t('none')} → ${e.toState ?? copy.t('none')}`,
    },
    {
      id: 'actor',
      header: copy.t('au.actor'),
      cell: (e) => (
        <>
          {e.actorType} {e.actorId && <bdi>{e.actorId.slice(0, 8)}</bdi>}
        </>
      ),
    },
    { id: 'reason', header: copy.t('reason'), cell: (e) => e.reason ?? copy.t('none') },
  ];
  return (
    <div className="ops-stack">
      <PageHeader title={copy.t('au.title')} description={copy.t('au.desc')} />
      <FilterBar
        onSubmit={() => {
          setApplied(draft);
          pager.reset();
        }}
        onClear={() => {
          setDraft(NONE);
          setApplied(NONE);
          pager.reset();
        }}
      >
        <Field label={copy.t('au.entityType')}>
          <Input value={draft.entityType} onChange={set('entityType')} />
        </Field>
        <Field label={copy.t('au.entityId')}>
          <Input value={draft.entityId} onChange={set('entityId')} dir="ltr" />
        </Field>
        <Field label={copy.t('au.actorId')}>
          <Input value={draft.actorId} onChange={set('actorId')} dir="ltr" />
        </Field>
        <Field label={copy.t('au.from')}>
          <Input type="datetime-local" value={draft.from} onChange={set('from')} />
        </Field>
        <Field label={copy.t('au.to')}>
          <Input type="datetime-local" value={draft.to} onChange={set('to')} />
        </Field>
      </FilterBar>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <Tabs
          label={copy.t('au.title')}
          tabs={[
            {
              id: 'table',
              label: copy.t('au.table'),
              panel: (
                <DataTable
                  caption={copy.t('au.title')}
                  columns={columns}
                  rows={items}
                  rowKey={(e) => e.id}
                  loading={q.isPending}
                  empty={<EmptyState title={copy.t('none')} />}
                />
              ),
            },
            {
              id: 'timeline',
              label: copy.t('au.timeline'),
              panel: (
                <Timeline
                  label={copy.t('au.timeline')}
                  entries={items.map((e) => ({
                    id: e.id,
                    title: `${e.entityType} ${e.entityId}: ${e.fromState ?? copy.t('none')} → ${e.toState ?? copy.t('none')}`,
                    at: <DateTime value={e.at} />,
                    ...(e.reason ? { description: e.reason } : {}),
                  }))}
                />
              ),
            },
          ]}
        />
      )}
      <Pager pager={pager} nextCursor={q.data?.nextCursor} busy={q.isFetching} />
    </div>
  );
}
