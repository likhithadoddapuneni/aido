import { ApiProblem, unwrap } from '@aidooi/api-client';
import { CreateRunBodySchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  Input,
  Money,
  PageHeader,
  useApi,
  type Column,
} from '@aidooi/ui-web';
import { useState } from 'react';
import { FormProblem, useApiForm } from '../lib/forms.tsx';
import { useCopy } from '../lib/i18n.ts';
import { previousPeriod } from '../lib/time.ts';
import { useCan, useMe } from '../shell/Me.tsx';
import { Notice, Pager, Status, useAction, usePaged } from './common.tsx';

type Run = {
  id: string;
  partnerId: string;
  partnerName: string;
  period: string;
  state: 'Draft' | 'Approved' | 'Paid';
  grossFils: number;
  commissionFils: number;
  adjustmentFils: number;
  netFils: number;
  approvedAt: string | null;
  paidAt: string | null;
  payoutRef: string | null;
};
type Held = { partnerId: string; grossFils: number };

/**
 * Settlement runs. Preparing a run and approving it are different people by design: the API refuses an
 * approval from whoever prepared it, and refuses finance actions from administrators. The screen says so
 * up front instead of letting a person find out from a failed button.
 */
export function SettlementScreen() {
  const copy = useCopy();
  const api = useApi();
  const me = useMe();
  const canCreate = useCan('settlement.read');
  const canApprove = useCan('settlement.approve');
  const [period, setPeriod] = useState('');
  const [held, setHeld] = useState<{
    period: string;
    held: Held[];
    names: Map<string, string>;
  } | null>(null);
  const [approving, setApproving] = useState<Run | null>(null);
  const [refused, setRefused] = useState(false);
  const [paying, setPaying] = useState<Run | null>(null);
  const [bankRef, setBankRef] = useState('');
  const form = useApiForm(CreateRunBodySchema, { period: previousPeriod() });
  const { q, pager } = usePaged(['settlement', period], (cursor) =>
    unwrap(
      api.http.GET('/v1/ops/settlement/runs', {
        params: { query: { ...(period ? { period } : {}), ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const create = useAction(
    (body: { period: string }) => unwrap(api.http.POST('/v1/ops/settlement/runs', { body })),
    {
      success: 'st.created',
      invalidate: [['settlement'], ['overview']],
      onSuccess: (r) => {
        setPeriod(r.period);
        setHeld({
          period: r.period,
          held: r.held,
          names: new Map(r.runs.map((x) => [x.partnerId, x.partnerName])),
        });
      },
      onError: form.setServerError,
    },
  );
  const approve = useAction(
    (id: string) =>
      unwrap(api.http.POST('/v1/ops/settlement/runs/{id}/approve', { params: { path: { id } } })),
    { success: 'st.approved.done', invalidate: [['settlement'], ['overview']] },
  );
  const markPaid = useAction(
    (v: { id: string; bankReference: string }) =>
      unwrap(
        api.http.POST('/v1/ops/settlement/runs/{id}/mark-paid', {
          params: { path: { id: v.id } },
          body: { bankReference: v.bankReference },
        }),
      ),
    { success: 'st.paid.done', invalidate: [['settlement']] },
  );
  const columns: Column<Run>[] = [
    { id: 'p', header: copy.t('st.partner'), cell: (r) => r.partnerName },
    { id: 'period', header: copy.t('st.period'), cell: (r) => <bdi>{r.period}</bdi> },
    { id: 'state', header: copy.t('status'), cell: (r) => <Status group="rs" value={r.state} /> },
    {
      id: 'gross',
      header: copy.t('st.gross'),
      numeric: true,
      cell: (r) => <Money fils={r.grossFils} />,
    },
    {
      id: 'comm',
      header: copy.t('st.commission'),
      numeric: true,
      cell: (r) => <Money fils={r.commissionFils} />,
    },
    {
      id: 'adj',
      header: copy.t('st.adjustments'),
      numeric: true,
      cell: (r) => <Money fils={r.adjustmentFils} />,
    },
    { id: 'net', header: copy.t('st.net'), numeric: true, cell: (r) => <Money fils={r.netFils} /> },
    {
      id: 'ref',
      header: copy.t('st.bankRef'),
      cell: (r) =>
        r.payoutRef ? (
          <bdi>{r.payoutRef}</bdi>
        ) : r.paidAt ? (
          <DateTime value={r.paidAt} />
        ) : (
          copy.t('none')
        ),
    },
    {
      id: 'a',
      header: copy.t('actions'),
      cell: (r) =>
        !canApprove ? null : r.state === 'Draft' ? (
          <Button variant="primary" onClick={() => setApproving(r)}>
            {copy.t('st.approve')}
          </Button>
        ) : r.state === 'Approved' ? (
          <Button onClick={() => setPaying(r)}>{copy.t('st.markPaid')}</Button>
        ) : null,
    },
  ];
  return (
    <div className="ops-stack">
      <PageHeader title={copy.t('st.title')} description={copy.t('st.desc')} />
      <Notice info>
        <strong>{copy.t('st.fourEyes')}.</strong> {copy.t('st.fourEyesBody')}
      </Notice>
      {me.role === 'ops_admin' && <Notice>{copy.t('st.adminNote')}</Notice>}
      <Notice info>{copy.t('st.statementsNote')}</Notice>
      {canCreate && (
        <Card title={copy.t('st.create')}>
          <form
            noValidate
            onSubmit={form.handleSubmit((v) => {
              form.clearServerError();
              create.mutate(v);
            })}
          >
            <FormProblem form={form} />
            <Field label={copy.t('st.period')} required error={form.messageFor('period')}>
              <Input dir="ltr" placeholder="2026-09" {...form.register('period')} />
            </Field>
            <Button type="submit" variant="primary" loading={create.isPending}>
              {copy.t('st.create')}
            </Button>
          </form>
        </Card>
      )}
      {held && held.held.length > 0 && (
        <Card title={copy.t('st.held')}>
          <p>{copy.t('st.heldNote')}</p>
          <DataTable
            caption={copy.t('st.held')}
            rowKey={(h) => h.partnerId}
            rows={held.held}
            columns={[
              {
                id: 'p',
                header: copy.t('st.partner'),
                cell: (h) => held.names.get(h.partnerId) ?? h.partnerId,
              },
              {
                id: 'g',
                header: copy.t('st.gross'),
                numeric: true,
                cell: (h) => <Money fils={h.grossFils} />,
              },
            ]}
          />
        </Card>
      )}
      <Card title={copy.t('st.runs')}>
        <Field label={copy.t('st.period')}>
          <Input
            dir="ltr"
            placeholder="2026-09"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value.trim());
              pager.reset();
            }}
          />
        </Field>
        <DataTable
          caption={copy.t('st.runs')}
          columns={columns}
          rows={q.data?.items ?? []}
          rowKey={(r) => r.id}
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          empty={<EmptyState title={copy.t('st.runsEmpty')} />}
        />
        <Pager pager={pager} nextCursor={q.data?.nextCursor} busy={q.isFetching} />
      </Card>
      <ConfirmDialog
        open={approving !== null}
        title={copy.t('st.approveTitle')}
        description={approving ? `${approving.partnerName} — ${copy.t('st.approveBody')}` : ''}
        confirmLabel={copy.t('st.approve')}
        requireWord={approving?.period}
        onConfirm={async () => {
          if (!approving) return;
          setRefused(false);
          try {
            await approve.mutateAsync(approving.id);
          } catch (e) {
            if (e instanceof ApiProblem && e.status === 403) setRefused(true);
            throw e;
          }
        }}
        onClose={() => {
          setApproving(null);
          setRefused(false);
        }}
      >
        {refused && (
          <p role="alert" className="ui-field__error">
            {copy.t('st.fourEyesRefused')}
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={paying !== null}
        title={copy.t('st.markPaidTitle')}
        description={paying ? `${paying.partnerName} — ${copy.t('st.net')}` : ''}
        confirmLabel={copy.t('st.markPaid')}
        disabled={bankRef.trim().length < 3}
        onConfirm={async () => {
          if (paying) await markPaid.mutateAsync({ id: paying.id, bankReference: bankRef.trim() });
          setBankRef('');
        }}
        onClose={() => {
          setPaying(null);
          setBankRef('');
        }}
      >
        <Field label={copy.t('st.bankRef')} required>
          <Input
            dir="ltr"
            value={bankRef}
            maxLength={100}
            onChange={(e) => setBankRef(e.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
