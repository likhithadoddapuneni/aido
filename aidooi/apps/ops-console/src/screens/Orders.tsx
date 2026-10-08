import { unwrap } from '@aidooi/api-client';
import {
  Button,
  Card,
  DataTable,
  DateTime,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  KeyValueList,
  Money,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  Timeline,
  useApi,
  useDebounce,
  type Column,
} from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { FormProblem, useApiForm } from '../lib/forms.tsx';
import { useCopy } from '../lib/i18n.ts';
import { useCan } from '../shell/Me.tsx';
import { LoggedNotice, Pager, Status, useAction, usePaged } from './common.tsx';

const STATUSES = ['Confirmed', 'In Progress', 'Issue Reported', 'Completed', 'Cancelled'] as const;
type OrderStatus = (typeof STATUSES)[number];
type Summary = {
  id: string;
  placedAt: string;
  customerId: string;
  grossFils: number;
  paidFils: number;
  status: OrderStatus;
  lineCount: number;
};

export function OrdersScreen() {
  const copy = useCopy();
  const api = useApi();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const term = useDebounce(search, 300);
  const { q, pager } = usePaged(['orders', term, status], (cursor) =>
    unwrap(
      api.http.GET('/v1/ops/orders', {
        params: {
          query: {
            ...(term ? { search: term } : {}),
            ...(status ? { status: status as OrderStatus } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
  const columns: Column<Summary>[] = [
    {
      id: 'order',
      header: copy.t('od.order'),
      cell: (o) => (
        <Link to="/orders/$id" params={{ id: o.id }}>
          <bdi>{o.id.slice(0, 8)}</bdi>
        </Link>
      ),
    },
    { id: 'placed', header: copy.t('od.placed'), cell: (o) => <DateTime value={o.placedAt} /> },
    { id: 'status', header: copy.t('status'), cell: (o) => <Status group="os" value={o.status} /> },
    {
      id: 'lines',
      header: copy.t('od.lines'),
      numeric: true,
      cell: (o) => <bdi>{o.lineCount}</bdi>,
    },
    {
      id: 'gross',
      header: copy.t('od.gross'),
      numeric: true,
      cell: (o) => <Money fils={o.grossFils} />,
    },
    {
      id: 'paid',
      header: copy.t('od.paid'),
      numeric: true,
      cell: (o) => <Money fils={o.paidFils} />,
    },
  ];
  return (
    <div className="ops-stack">
      <PageHeader title={copy.t('od.title')} description={copy.t('od.desc')} />
      <FilterBar
        onClear={() => {
          setSearch('');
          setStatus('');
          pager.reset();
        }}
      >
        <Field label={copy.t('od.search')}>
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              pager.reset();
            }}
          />
        </Field>
        <Field label={copy.t('status')}>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              pager.reset();
            }}
          >
            <option value="">{copy.t('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {copy.label('os', s)}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <DataTable
        caption={copy.t('od.title')}
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(o) => o.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowActivate={(o) => void navigate({ to: '/orders/$id', params: { id: o.id } })}
        empty={<EmptyState title={copy.t('none')} />}
      />
      <Pager pager={pager} nextCursor={q.data?.nextCursor} busy={q.isFetching} />
    </div>
  );
}

const NoteForm = z.object({ body: z.string().trim().min(1).max(2000) });

function Notes({
  orderId,
  notes,
}: {
  orderId: string;
  notes: { id: string; body: string; createdAt: string }[];
}) {
  const copy = useCopy();
  const api = useApi();
  const canNote = useCan('desk.notes');
  const form = useApiForm(NoteForm, { body: '' });
  const add = useAction(
    (body: { body: string }) =>
      unwrap(
        api.http.POST('/v1/ops/orders/{id}/notes', { params: { path: { id: orderId } }, body }),
      ),
    {
      success: 'od.noteAdded',
      invalidate: [['order', orderId]],
      onSuccess: () => form.reset(),
      onError: form.setServerError,
    },
  );
  return (
    <Card title={copy.t('od.notes')}>
      {notes.length === 0 ? (
        <p>{copy.t('od.notesEmpty')}</p>
      ) : (
        <Timeline
          label={copy.t('od.notes')}
          entries={notes.map((n) => ({
            id: n.id,
            title: n.body,
            at: <DateTime value={n.createdAt} />,
          }))}
        />
      )}
      {canNote && (
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => {
            form.clearServerError();
            add.mutate(v);
          })}
        >
          <FormProblem form={form} />
          <Field
            label={copy.t('od.addNote')}
            hint={copy.t('od.noteHint')}
            error={form.messageFor('body')}
          >
            <Textarea rows={3} {...form.register('body')} />
          </Field>
          <Button type="submit" loading={add.isPending}>
            {copy.t('od.addNote')}
          </Button>
        </form>
      )}
    </Card>
  );
}

function Customer({ id }: { id: string }) {
  const copy = useCopy();
  const api = useApi();
  const [shown, setShown] = useState(false);
  // Fetched only on request: opening the summary is itself an audited read.
  const q = useQuery({
    queryKey: ['customer', id],
    queryFn: () => unwrap(api.http.GET('/v1/ops/customers/{id}', { params: { path: { id } } })),
    enabled: shown,
  });
  return (
    <Card title={copy.t('od.customerSummary')}>
      {!shown ? (
        <Button onClick={() => setShown(true)}>{copy.t('od.showCustomer')}</Button>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton height="4rem" />
      ) : (
        <KeyValueList
          items={[
            { key: 'name', label: copy.t('name'), value: q.data.fullName ?? copy.t('none') },
            {
              key: 'phone',
              label: copy.t('od.phone'),
              value: q.data.phoneMasked ? <bdi>{q.data.phoneMasked}</bdi> : copy.t('none'),
            },
            {
              key: 'email',
              label: copy.t('od.emailMasked'),
              value: q.data.emailMasked ? <bdi>{q.data.emailMasked}</bdi> : copy.t('none'),
            },
            {
              key: 'orders',
              label: copy.t('od.orderCount'),
              value: <bdi>{q.data.orderCount}</bdi>,
            },
            { key: 'status', label: copy.t('status'), value: q.data.status },
          ]}
        />
      )}
    </Card>
  );
}

export function OrderDetailScreen() {
  const copy = useCopy();
  const api = useApi();
  const { id } = useParams({ strict: false }) as { id: string };
  const q = useQuery({
    queryKey: ['order', id],
    queryFn: () => unwrap(api.http.GET('/v1/ops/orders/{id}', { params: { path: { id } } })),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return <Skeleton height="12rem" />;
  const sellerName = new Map(d.sellerOrders.map((s) => [s.id, s.tradeName]));
  return (
    <div className="ops-stack">
      <PageHeader
        title={`${copy.t('od.order')} ${d.order.id.slice(0, 8)}`}
        description={
          <>
            <Status group="os" value={d.order.status} /> · <DateTime value={d.order.placedAt} />
          </>
        }
        actions={<Link to="/orders">{copy.t('back')}</Link>}
      />
      <LoggedNotice />
      <div className="ops-grid">
        <Card title={copy.t('od.deliveryTo')}>
          {d.delivery ? (
            <KeyValueList
              items={[
                { key: 'to', label: copy.t('name'), value: d.delivery.recipientName },
                { key: 'phone', label: copy.t('od.phone'), value: <bdi>{d.delivery.phone}</bdi> },
                {
                  key: 'addr',
                  label: copy.t('od.deliveryTo'),
                  value: [d.delivery.line1, d.delivery.line2, d.delivery.area, d.delivery.emirate]
                    .filter(Boolean)
                    .join(', '),
                },
                ...(d.delivery.instructions
                  ? [{ key: 'ins', label: copy.t('note'), value: d.delivery.instructions }]
                  : []),
              ]}
            />
          ) : (
            <p>{copy.t('none')}</p>
          )}
        </Card>
        <Customer id={d.order.customerId} />
        <Card title={copy.t('od.payment')}>
          <KeyValueList
            items={[
              {
                key: 'gross',
                label: copy.t('od.gross'),
                value: <Money fils={d.order.grossFils} />,
              },
              { key: 'paid', label: copy.t('od.paid'), value: <Money fils={d.order.paidFils} /> },
              {
                key: 'dep',
                label: copy.t('od.depositCredit'),
                value: <Money fils={d.order.depositCreditFils} />,
              },
              ...(d.payment
                ? [
                    {
                      key: 'pst',
                      label: copy.t('status'),
                      value: <Status group="py" value={d.payment.state} />,
                    },
                    ...(d.payment.providerRef
                      ? [
                          {
                            key: 'ref',
                            label: copy.t('od.payment'),
                            value: <bdi>{d.payment.providerRef}</bdi>,
                          },
                        ]
                      : []),
                  ]
                : []),
              ...(d.order.viewingRequestId
                ? [
                    {
                      key: 'view',
                      label: copy.t('od.viewing'),
                      value: (
                        <Link to="/viewings/$id" params={{ id: d.order.viewingRequestId }}>
                          <bdi>{d.order.viewingRequestId.slice(0, 8)}</bdi>
                        </Link>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      </div>
      <Card title={copy.t('od.lineItems')}>
        <DataTable
          caption={copy.t('od.lineItems')}
          rowKey={(l) => l.id}
          rows={d.lines}
          columns={[
            { id: 'p', header: copy.t('od.lineItems'), cell: (l) => l.productName },
            {
              id: 's',
              header: copy.t('st.partner'),
              cell: (l) => sellerName.get(l.sellerOrderId) ?? '',
            },
            {
              id: 'q',
              header: copy.t('od.qty'),
              numeric: true,
              cell: (l) => <bdi>{l.quantity}</bdi>,
            },
            {
              id: 'u',
              header: copy.t('od.unitPrice'),
              numeric: true,
              cell: (l) => <Money fils={l.unitPriceFils} />,
            },
            {
              id: 'g',
              header: copy.t('od.gross'),
              numeric: true,
              cell: (l) => <Money fils={l.grossLineFils} />,
            },
            {
              id: 'c',
              header: copy.t('od.commission'),
              numeric: true,
              cell: (l) => <Money fils={l.commissionFils} />,
            },
            {
              id: 'st',
              header: copy.t('status'),
              cell: (l) => <Status group="ls" value={l.state} />,
            },
            {
              id: 'se',
              header: copy.t('od.settlement'),
              cell: (l) => <Status group="ss" value={l.settlementState} />,
            },
          ]}
        />
      </Card>
      <Card title={copy.t('od.refunds')}>
        <DataTable
          caption={copy.t('od.refunds')}
          rowKey={(r) => r.id}
          rows={d.refunds}
          empty={<EmptyState title={copy.t('od.refundsEmpty')} />}
          columns={[
            {
              id: 'a',
              header: copy.t('od.amount'),
              numeric: true,
              cell: (r) => <Money fils={r.amountFils} />,
            },
            {
              id: 's',
              header: copy.t('status'),
              cell: (r) => <Status group="rf" value={r.state} />,
            },
            { id: 'r', header: copy.t('reason'), cell: (r) => r.reason },
          ]}
        />
      </Card>
      <Card title={copy.t('od.ledger')}>
        <DataTable
          caption={copy.t('od.ledger')}
          rowKey={(e) => `${e.entryGroup}:${e.account}:${e.direction}:${e.at}`}
          rows={d.ledger}
          empty={<EmptyState title={copy.t('none')} />}
          columns={[
            { id: 'at', header: copy.t('au.when'), cell: (e) => <DateTime value={e.at} /> },
            { id: 'ac', header: copy.t('od.account'), cell: (e) => <bdi>{e.account}</bdi> },
            {
              id: 'di',
              header: copy.t('od.direction'),
              cell: (e) => copy.label('dir', e.direction),
            },
            {
              id: 'am',
              header: copy.t('od.amount'),
              numeric: true,
              cell: (e) => <Money fils={e.amountFils} />,
            },
          ]}
        />
      </Card>
      <Notes orderId={d.order.id} notes={d.notes} />
      <Card title={copy.t('od.auditTrail')}>
        <Timeline
          label={copy.t('od.auditTrail')}
          entries={d.audit.map((a, i) => ({
            id: String(i),
            title: `${a.entityType}: ${a.fromState ?? copy.t('none')} → ${a.toState ?? copy.t('none')}`,
            at: <DateTime value={a.at} />,
            ...(a.reason ? { description: a.reason } : {}),
          }))}
        />
      </Card>
    </div>
  );
}
