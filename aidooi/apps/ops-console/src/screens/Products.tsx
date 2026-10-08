import { unwrap } from '@aidooi/api-client';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DateTime,
  Dialog,
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
import { FormProblem, optionalText, useApiForm } from '../lib/forms.tsx';
import { useCopy } from '../lib/i18n.ts';
import { useCan } from '../shell/Me.tsx';
import { Notice, Pager, Status, useAction, usePaged } from './common.tsx';

const STATUSES = ['Ready for Review', 'Incomplete', 'Verified'] as const;
type DataStatus = (typeof STATUSES)[number];

type Row = {
  id: string;
  name: string;
  type: string;
  dataStatus: DataStatus;
  lifecycle: 'Active' | 'Inactive';
  updatedAt: string;
  completeness: { missing: string[]; invalid: string[]; complete: boolean };
  partners: { id: string; tradeName: string }[];
};

function Stats() {
  const copy = useCopy();
  const api = useApi();
  const q = useQuery({
    queryKey: ['product-stats'],
    queryFn: () => unwrap(api.http.GET('/v1/ops/products/stats')),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton height="6rem" />;
  const { queue, rejectionByPartner } = q.data;
  return (
    <Card title={copy.t('pr.stats')}>
      <KeyValueList
        items={[
          {
            key: 'ready',
            label: copy.t('pr.queueReady'),
            value: <bdi>{queue.readyForReview}</bdi>,
          },
          { key: 'inc', label: copy.t('pr.queueIncomplete'), value: <bdi>{queue.incomplete}</bdi> },
          {
            key: 'age',
            label: copy.t('pr.medianAge'),
            value:
              queue.medianAgeHours === null ? copy.t('none') : <bdi>{queue.medianAgeHours}</bdi>,
          },
        ]}
      />
      {rejectionByPartner.length > 0 && (
        <DataTable
          caption={copy.t('pr.rejectionBy')}
          rowKey={(r) => r.partnerId}
          rows={rejectionByPartner}
          columns={[
            { id: 'p', header: copy.t('st.partner'), cell: (r) => r.tradeName },
            {
              id: 'rej',
              header: copy.t('pr.rejected'),
              numeric: true,
              cell: (r) => <bdi>{r.rejected}</bdi>,
            },
            {
              id: 'ver',
              header: copy.t('pr.verified'),
              numeric: true,
              cell: (r) => <bdi>{r.verified}</bdi>,
            },
            {
              id: 'rate',
              header: copy.t('pr.rate'),
              numeric: true,
              cell: (r) => <bdi>{Math.round(r.rejectionRate * 100)}%</bdi>,
            },
          ]}
        />
      )}
    </Card>
  );
}

function Completeness({ c }: { c: Row['completeness'] }) {
  const copy = useCopy();
  const n = c.missing.length + c.invalid.length;
  return c.complete ? (
    <Badge tone="ok">{copy.t('pr.complete')}</Badge>
  ) : (
    <Badge tone="warn">{copy.t('pr.incompleteN', { n })}</Badge>
  );
}

export function ProductsScreen() {
  const copy = useCopy();
  const api = useApi();
  const navigate = useNavigate();
  const [status, setStatus] = useState<DataStatus>('Ready for Review');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const term = useDebounce(search, 300);
  const { q, pager } = usePaged(['products', status, type, term], (cursor) =>
    unwrap(
      api.http.GET('/v1/ops/products', {
        params: {
          query: {
            status,
            ...(type ? { type } : {}),
            ...(term ? { search: term } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: copy.t('pr.id'),
      cell: (r) => (
        <Link to="/products/$id" params={{ id: r.id }}>
          {r.name} <bdi>({r.id})</bdi>
        </Link>
      ),
    },
    { id: 'type', header: copy.t('type'), cell: (r) => r.type },
    {
      id: 'partners',
      header: copy.t('pr.partners'),
      cell: (r) => r.partners.map((p) => p.tradeName).join(', '),
    },
    {
      id: 'status',
      header: copy.t('status'),
      cell: (r) => <Status group="ds" value={r.dataStatus} />,
    },
    {
      id: 'complete',
      header: copy.t('pr.completeness'),
      cell: (r) => <Completeness c={r.completeness} />,
    },
    { id: 'updated', header: copy.t('pr.updated'), cell: (r) => <DateTime value={r.updatedAt} /> },
  ];
  return (
    <div className="ops-stack">
      <PageHeader title={copy.t('pr.title')} description={copy.t('pr.desc')} />
      <Stats />
      <FilterBar
        onClear={() => {
          setStatus('Ready for Review');
          setType('');
          setSearch('');
          pager.reset();
        }}
      >
        <Field label={copy.t('status')}>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as DataStatus);
              pager.reset();
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {copy.label('ds', s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={copy.t('pr.filterType')}>
          <Input
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              pager.reset();
            }}
          />
        </Field>
        <Field label={copy.t('pr.search')}>
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              pager.reset();
            }}
          />
        </Field>
      </FilterBar>
      <DataTable
        caption={copy.t('pr.title')}
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowActivate={(r) => void navigate({ to: '/products/$id', params: { id: r.id } })}
        empty={<EmptyState title={copy.t('none')} />}
      />
      <Pager pager={pager} nextCursor={q.data?.nextCursor} busy={q.isFetching} />
    </div>
  );
}

/* ------------------------------ one product ------------------------------ */

const dim = z.coerce.number().int().min(1).max(1000);
const EditForm = z.object({
  name: z.string().trim().min(2).max(200),
  type: z.string().trim().min(2).max(60),
  widthCm: dim,
  depthCm: dim,
  heightCm: dim,
  primaryColour: z.string().trim().min(1),
  secondaryColour: optionalText(z.string().trim().min(1)),
  material: z.string().trim().min(1),
  primaryStyle: z.string().trim().min(1),
  secondaryStyle: optionalText(z.string().trim().min(1)),
});

type Detail = Row & {
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  primaryColour: string | null;
  secondaryColour: string | null;
  material: string | null;
  primaryStyle: string | null;
  secondaryStyle: string | null;
  attributes: Record<string, string | number | boolean>;
  verifiedAt: string | null;
  offers: {
    id: string;
    partnerId: string;
    sellingPrice: number;
    availability: string;
    stockQty: number;
    status: string;
  }[];
  history: {
    at: string;
    from: string | null;
    to: string | null;
    actorType: string;
    reason: string | null;
  }[];
};

function EditDialog({ product, onClose }: { product: Detail; onClose: () => void }) {
  const copy = useCopy();
  const api = useApi();
  const form = useApiForm(EditForm, {
    name: product.name,
    type: product.type,
    widthCm: product.widthCm ?? '',
    depthCm: product.depthCm ?? '',
    heightCm: product.heightCm ?? '',
    primaryColour: product.primaryColour ?? '',
    secondaryColour: product.secondaryColour ?? '',
    material: product.material ?? '',
    primaryStyle: product.primaryStyle ?? '',
    secondaryStyle: product.secondaryStyle ?? '',
  });
  const save = useAction(
    (body: z.output<typeof EditForm>) =>
      unwrap(
        api.http.PATCH('/v1/ops/products/{id}', { params: { path: { id: product.id } }, body }),
      ),
    {
      success: 'saved',
      invalidate: [['product'], ['products'], ['product-stats']],
      onSuccess: onClose,
      onError: form.setServerError,
    },
  );
  const text = (name: keyof z.input<typeof EditForm>, label: string, required = false) => (
    <Field label={label} required={required} error={form.messageFor(name)}>
      <Input {...form.register(name)} />
    </Field>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={copy.t('edit')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {copy.t('back')}
          </Button>
          <Button variant="primary" type="submit" form="product-form" loading={save.isPending}>
            {copy.t('save')}
          </Button>
        </>
      }
    >
      <Notice info>{copy.t('pr.editNote')}</Notice>
      <form
        id="product-form"
        noValidate
        onSubmit={form.handleSubmit((v) => {
          form.clearServerError();
          save.mutate(v);
        })}
      >
        <FormProblem form={form} />
        {text('name', copy.t('name'), true)}
        {text('type', copy.t('type'), true)}
        {text('widthCm', copy.t('pr.width'), true)}
        {text('depthCm', copy.t('pr.depth'), true)}
        {text('heightCm', copy.t('pr.height'), true)}
        {text('primaryColour', copy.t('pr.primaryColour'), true)}
        {text('secondaryColour', copy.t('pr.secondaryColour'))}
        {text('material', copy.t('pr.material'), true)}
        {text('primaryStyle', copy.t('pr.primaryStyle'), true)}
        {text('secondaryStyle', copy.t('pr.secondaryStyle'))}
      </form>
    </Dialog>
  );
}

function RejectDialog({ product, onClose }: { product: Detail; onClose: () => void }) {
  const copy = useCopy();
  const api = useApi();
  const [text, setText] = useState('');
  const reasons = text
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);
  const valid = reasons.length >= 1 && reasons.length <= 10 && reasons.every((r) => r.length >= 3);
  const reject = useAction(
    (body: { reasons: string[] }) =>
      unwrap(
        api.http.POST('/v1/ops/products/{id}/reject', {
          params: { path: { id: product.id } },
          body,
        }),
      ),
    {
      success: 'pr.rejected.done',
      invalidate: [['product'], ['products'], ['product-stats'], ['overview']],
    },
  );
  return (
    <ConfirmDialog
      open
      danger
      title={copy.t('pr.rejectTitle')}
      description={copy.t('pr.reasonsHelp')}
      confirmLabel={copy.t('pr.reject')}
      disabled={!valid}
      onConfirm={async () => {
        await reject.mutateAsync({ reasons });
      }}
      onClose={onClose}
    >
      <Field label={copy.t('pr.rejectReasons')} required>
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

type Dlg = 'edit' | 'verify' | 'reject' | 'deactivate' | 'activate' | null;

export function ProductDetailScreen() {
  const copy = useCopy();
  const api = useApi();
  const { id } = useParams({ strict: false }) as { id: string };
  const canWrite = useCan('products.write');
  const [dlg, setDlg] = useState<Dlg>(null);
  const q = useQuery({
    queryKey: ['product', id],
    queryFn: () => unwrap(api.http.GET('/v1/ops/products/{id}', { params: { path: { id } } })),
  });
  const refresh = [['product'], ['products'], ['product-stats'], ['overview']] as const;
  const verify = useAction(
    () => unwrap(api.http.POST('/v1/ops/products/{id}/verify', { params: { path: { id } } })),
    { success: 'pr.verified.done', invalidate: refresh },
  );
  const setLifecycle = useAction(
    (to: 'activate' | 'deactivate') =>
      unwrap(
        api.http.POST(
          to === 'activate' ? '/v1/ops/products/{id}/activate' : '/v1/ops/products/{id}/deactivate',
          {
            params: { path: { id } },
          },
        ),
      ),
    { success: 'saved', invalidate: refresh },
  );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data as Detail | undefined;
  if (!p) return <Skeleton height="12rem" />;
  const problems = [
    ...p.completeness.missing.map((m) => `${copy.t('pr.missing')}: ${m}`),
    ...p.completeness.invalid.map((m) => `${copy.t('pr.invalid')}: ${m}`),
  ];
  const canVerify = p.completeness.complete && p.dataStatus !== 'Verified';
  const close = () => setDlg(null);
  return (
    <div className="ops-stack">
      <PageHeader
        title={p.name}
        description={
          <>
            <bdi>{p.id}</bdi> · <Status group="ds" value={p.dataStatus} />{' '}
            <Badge tone={p.lifecycle === 'Active' ? 'ok' : 'err'}>
              {copy.label('ps', p.lifecycle)}
            </Badge>
          </>
        }
        actions={
          <>
            <Link to="/products">{copy.t('back')}</Link>
            {canWrite && (
              <>
                <Button onClick={() => setDlg('edit')}>{copy.t('edit')}</Button>
                <Button variant="primary" disabled={!canVerify} onClick={() => setDlg('verify')}>
                  {copy.t('pr.verify')}
                </Button>
                {p.dataStatus !== 'Verified' && (
                  <Button variant="danger" onClick={() => setDlg('reject')}>
                    {copy.t('pr.reject')}
                  </Button>
                )}
                {p.lifecycle === 'Active' ? (
                  <Button onClick={() => setDlg('deactivate')}>{copy.t('pr.deactivate')}</Button>
                ) : (
                  <Button onClick={() => setDlg('activate')}>{copy.t('pr.activate')}</Button>
                )}
              </>
            )}
          </>
        }
      />
      {problems.length > 0 && (
        <Notice>
          <strong>{copy.t('pr.incompleteN', { n: problems.length })}</strong>
          <ul>
            {problems.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {canWrite && <span>{copy.t('pr.verifyBlocked')}</span>}
        </Notice>
      )}
      <div className="ops-grid">
        <Card title={copy.t('details')}>
          <KeyValueList
            items={[
              { key: 'type', label: copy.t('type'), value: p.type },
              {
                key: 'dim',
                label: copy.t('pr.dimensions'),
                value: (
                  <bdi>{[p.widthCm, p.depthCm, p.heightCm].map((n) => n ?? '—').join(' × ')}</bdi>
                ),
              },
              {
                key: 'c1',
                label: copy.t('pr.primaryColour'),
                value: p.primaryColour ?? copy.t('none'),
              },
              {
                key: 'c2',
                label: copy.t('pr.secondaryColour'),
                value: p.secondaryColour ?? copy.t('none'),
              },
              { key: 'mat', label: copy.t('pr.material'), value: p.material ?? copy.t('none') },
              {
                key: 's1',
                label: copy.t('pr.primaryStyle'),
                value: p.primaryStyle ?? copy.t('none'),
              },
              {
                key: 's2',
                label: copy.t('pr.secondaryStyle'),
                value: p.secondaryStyle ?? copy.t('none'),
              },
              { key: 'upd', label: copy.t('pr.updated'), value: <DateTime value={p.updatedAt} /> },
            ]}
          />
        </Card>
        <Card title={copy.t('pr.attributes')}>
          {Object.keys(p.attributes).length === 0 ? (
            <p>{copy.t('none')}</p>
          ) : (
            <KeyValueList
              items={Object.entries(p.attributes).map(([k, v]) => ({
                key: k,
                label: k,
                value: typeof v === 'boolean' ? copy.t(v ? 'yes' : 'no') : String(v),
              }))}
            />
          )}
        </Card>
      </div>
      <Card title={copy.t('pr.offers')}>
        <DataTable
          caption={copy.t('pr.offers')}
          rowKey={(o) => o.id}
          rows={p.offers}
          columns={[
            {
              id: 'partner',
              header: copy.t('st.partner'),
              cell: (o) => (
                <Link to="/partners/$id" params={{ id: o.partnerId }}>
                  {p.partners.find((x) => x.id === o.partnerId)?.tradeName ?? o.partnerId}
                </Link>
              ),
            },
            {
              id: 'price',
              header: copy.t('pr.offerPrice'),
              numeric: true,
              cell: (o) => <Money fils={o.sellingPrice} />,
            },
            {
              id: 'stock',
              header: copy.t('pr.offerStock'),
              numeric: true,
              cell: (o) => <bdi>{o.stockQty}</bdi>,
            },
            { id: 'st', header: copy.t('status'), cell: (o) => o.status },
          ]}
          empty={<EmptyState title={copy.t('none')} />}
        />
      </Card>
      <Card title={copy.t('pr.history')}>
        {p.history.length === 0 ? (
          <p>{copy.t('pr.historyEmpty')}</p>
        ) : (
          <Timeline
            label={copy.t('pr.history')}
            entries={p.history.map((h, i) => ({
              id: String(i),
              title: `${h.from ?? copy.t('none')} → ${h.to ?? copy.t('none')}`,
              at: <DateTime value={h.at} />,
              ...(h.reason ? { description: h.reason } : {}),
            }))}
          />
        )}
      </Card>
      {dlg === 'edit' && <EditDialog product={p} onClose={close} />}
      {dlg === 'reject' && <RejectDialog product={p} onClose={close} />}
      <ConfirmDialog
        open={dlg === 'verify'}
        title={copy.t('pr.verifyTitle')}
        description={copy.t('pr.verifyBody')}
        confirmLabel={copy.t('pr.verify')}
        onConfirm={async () => void (await verify.mutateAsync())}
        onClose={close}
      />
      <ConfirmDialog
        open={dlg === 'deactivate'}
        danger
        title={copy.t('pr.deactivateTitle')}
        description={copy.t('pr.deactivateBody')}
        confirmLabel={copy.t('pr.deactivate')}
        onConfirm={async () => void (await setLifecycle.mutateAsync('deactivate'))}
        onClose={close}
      />
      <ConfirmDialog
        open={dlg === 'activate'}
        title={copy.t('pr.activate')}
        description={copy.t('pr.activate')}
        confirmLabel={copy.t('pr.activate')}
        onConfirm={async () => void (await setLifecycle.mutateAsync('activate'))}
        onClose={close}
      />
    </div>
  );
}
