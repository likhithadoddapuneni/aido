import { unwrap } from '@aidooi/api-client';
import {
  Card,
  DataTable,
  DateTime,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  KeyValueList,
  Money,
  PageHeader,
  Select,
  Skeleton,
  Timeline,
  useApi,
  type Column,
} from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useCopy } from '../lib/i18n.ts';
import { LoggedNotice, Pager, Status, usePaged } from './common.tsx';

const STATES = [
  'Draft',
  'Awaiting Seller Confirmation',
  'Awaiting Deposit',
  'Confirmed',
  'Completed',
  'No-show',
  'Cancelled',
] as const;
type State = (typeof STATES)[number];
type Row = {
  id: string;
  state: string;
  customerId: string;
  scheduledAt: string | null;
  createdAt: string;
  stopCount: number;
  depositFils: number | null;
  depositState: string | null;
};

export function ViewingsScreen() {
  const copy = useCopy();
  const api = useApi();
  const navigate = useNavigate();
  const [state, setState] = useState('');
  const { q, pager } = usePaged(['viewings', state], (cursor) =>
    unwrap(
      api.http.GET('/v1/ops/viewings', {
        params: {
          query: { ...(state ? { state: state as State } : {}), ...(cursor ? { cursor } : {}) },
        },
      }),
    ),
  );
  const columns: Column<Row>[] = [
    {
      id: 'id',
      header: copy.t('vw.title'),
      cell: (v) => (
        <Link to="/viewings/$id" params={{ id: v.id }}>
          <bdi>{v.id.slice(0, 8)}</bdi>
        </Link>
      ),
    },
    { id: 'state', header: copy.t('status'), cell: (v) => <Status group="vs" value={v.state} /> },
    {
      id: 'when',
      header: copy.t('vw.scheduled'),
      cell: (v) => (v.scheduledAt ? <DateTime value={v.scheduledAt} /> : copy.t('none')),
    },
    {
      id: 'stops',
      header: copy.t('vw.stops'),
      numeric: true,
      cell: (v) => <bdi>{v.stopCount}</bdi>,
    },
    {
      id: 'dep',
      header: copy.t('vw.deposit'),
      numeric: true,
      cell: (v) => (v.depositFils === null ? copy.t('none') : <Money fils={v.depositFils} />),
    },
  ];
  return (
    <div className="ops-stack">
      <PageHeader title={copy.t('vw.title')} description={copy.t('vw.desc')} />
      <FilterBar onClear={() => (setState(''), pager.reset())}>
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
                {copy.label('vs', s)}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <DataTable
        caption={copy.t('vw.title')}
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(v) => v.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowActivate={(v) => void navigate({ to: '/viewings/$id', params: { id: v.id } })}
        empty={<EmptyState title={copy.t('none')} />}
      />
      <Pager pager={pager} nextCursor={q.data?.nextCursor} busy={q.isFetching} />
    </div>
  );
}

export function ViewingDetailScreen() {
  const copy = useCopy();
  const api = useApi();
  const { id } = useParams({ strict: false }) as { id: string };
  const q = useQuery({
    queryKey: ['viewing', id],
    queryFn: () => unwrap(api.http.GET('/v1/ops/viewings/{id}', { params: { path: { id } } })),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const v = q.data;
  if (!v) return <Skeleton height="12rem" />;
  return (
    <div className="ops-stack">
      <PageHeader
        title={`${copy.t('vw.title')} ${v.id.slice(0, 8)}`}
        description={<Status group="vs" value={v.state} />}
        actions={<Link to="/viewings">{copy.t('back')}</Link>}
      />
      <LoggedNotice />
      <Card title={copy.t('details')}>
        <KeyValueList
          items={[
            {
              key: 'when',
              label: copy.t('vw.scheduled'),
              value: v.scheduledAt ? <DateTime value={v.scheduledAt} /> : copy.t('none'),
            },
            {
              key: 'dep',
              label: copy.t('vw.deposit'),
              value: v.depositFils === null ? copy.t('none') : <Money fils={v.depositFils} />,
            },
            {
              key: 'dst',
              label: copy.t('vw.depositState'),
              value: copy.label('dp', v.depositState),
            },
            { key: 'created', label: copy.t('created'), value: <DateTime value={v.createdAt} /> },
          ]}
        />
      </Card>
      <Card title={copy.t('vw.stopsTitle')}>
        <DataTable
          caption={copy.t('vw.stopsTitle')}
          rowKey={(s) => s.id}
          rows={v.stops}
          empty={<EmptyState title={copy.t('none')} />}
          columns={[
            {
              id: 'p',
              header: copy.t('st.partner'),
              cell: (s) => (
                <Link to="/partners/$id" params={{ id: s.partnerId }}>
                  {s.tradeName}
                </Link>
              ),
            },
            {
              id: 'c',
              header: copy.t('status'),
              cell: (s) => copy.label('vs', s.confirmationState),
            },
            {
              id: 'pr',
              header: copy.t('nav.products'),
              cell: (s) =>
                s.products.map((p) => (
                  <span key={p.offerId}>
                    <Link to="/products/$id" params={{ id: p.productId }}>
                      <bdi>{p.productId}</bdi>
                    </Link>{' '}
                    ×<bdi>{p.quantity}</bdi>{' '}
                  </span>
                )),
            },
          ]}
        />
      </Card>
      <Card title={copy.t('vw.attribution')}>
        <Timeline
          label={copy.t('vw.attribution')}
          entries={v.attribution.map((a, i) => ({
            id: String(i),
            title: a.stage,
            at: <DateTime value={a.at} />,
          }))}
        />
      </Card>
    </div>
  );
}
