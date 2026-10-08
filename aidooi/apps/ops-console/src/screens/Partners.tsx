import { unwrap } from '@aidooi/api-client';
import { PARTNER_STATUSES } from '@aidooi/contracts';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  DateTime,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  KeyValueList,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
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
import { bpsToPct, Notice, Pager, pctToBps, Status, useAction, usePaged } from './common.tsx';
import { ReasonConfirm } from './ReasonConfirm.tsx';

type Partner = {
  id: string;
  code: string;
  legalName: string;
  tradeName: string;
  taxRegistrationNo: string | null;
  status: (typeof PARTNER_STATUSES)[number];
  commissionBps: number;
  afterSalesTerms: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  activatedAt: string | null;
  createdAt: string;
};

/** The form speaks percent (14); the API speaks whole basis points (1400). */
const PartnerForm = z
  .object({
    tradeName: z.string().trim().min(2).max(120),
    legalName: z.string().trim().min(2).max(200),
    taxRegistrationNo: optionalText(z.string().trim().max(40)),
    commissionPct: z.coerce.number().min(0).max(100),
    afterSalesTerms: optionalText(z.string().trim().max(2000)),
    contactEmail: optionalText(z.email()),
    contactPhone: optionalText(z.string().regex(/^\+[1-9][0-9]{7,14}$/)),
  })
  .transform(({ commissionPct, ...rest }) => ({ ...rest, commissionBps: pctToBps(commissionPct) }));

const FIELD_MAP = { commissionBps: 'commissionPct' };

const blank = {
  tradeName: '',
  legalName: '',
  taxRegistrationNo: '',
  commissionPct: '',
  afterSalesTerms: '',
  contactEmail: '',
  contactPhone: '',
};
const fromPartner = (p: Partner) => ({
  tradeName: p.tradeName,
  legalName: p.legalName,
  taxRegistrationNo: p.taxRegistrationNo ?? '',
  commissionPct: bpsToPct(p.commissionBps),
  afterSalesTerms: p.afterSalesTerms ?? '',
  contactEmail: p.contactEmail ?? '',
  contactPhone: p.contactPhone ?? '',
});

/** Create (no `partner`) or edit one partner. The commission note is always visible beside the rate. */
function PartnerDialog({
  open,
  partner,
  onClose,
  onSaved,
}: {
  open: boolean;
  partner?: Partner;
  onClose: () => void;
  onSaved?: (p: Partner) => void;
}) {
  const copy = useCopy();
  const api = useApi();
  const form = useApiForm(PartnerForm, partner ? fromPartner(partner) : blank, {
    fieldMap: FIELD_MAP,
  });
  const save = useAction(
    (body: z.output<typeof PartnerForm>) =>
      partner
        ? unwrap(
            api.http.PATCH('/v1/ops/partners/{id}', { params: { path: { id: partner.id } }, body }),
          )
        : unwrap(api.http.POST('/v1/ops/partners', { body })),
    {
      success: partner ? 'saved' : 'pt.created',
      invalidate: [['partners'], ['partner']],
      onSuccess: (p) => {
        onSaved?.(p);
        onClose();
      },
      onError: form.setServerError,
    },
  );
  const field = (name: keyof typeof blank) => form.messageFor(name);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.t(partner ? 'edit' : 'pt.createTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {copy.t('back')}
          </Button>
          <Button variant="primary" type="submit" form="partner-form" loading={save.isPending}>
            {copy.t('save')}
          </Button>
        </>
      }
    >
      <form
        id="partner-form"
        noValidate
        onSubmit={form.handleSubmit((v) => {
          form.clearServerError();
          save.mutate(v);
        })}
      >
        <FormProblem form={form} />
        <Field label={copy.t('pt.trade')} required error={field('tradeName')}>
          <Input {...form.register('tradeName')} />
        </Field>
        <Field label={copy.t('pt.legal')} required error={field('legalName')}>
          <Input {...form.register('legalName')} />
        </Field>
        <Field label={copy.t('pt.taxNo')} error={field('taxRegistrationNo')}>
          <Input {...form.register('taxRegistrationNo')} />
        </Field>
        <Field
          label={copy.t('pt.commission')}
          hint={copy.t('pt.commissionNote')}
          required
          error={field('commissionPct')}
        >
          <Input inputMode="decimal" {...form.register('commissionPct')} />
        </Field>
        <Field label={copy.t('pt.afterSales')} error={field('afterSalesTerms')}>
          <Textarea rows={3} {...form.register('afterSalesTerms')} />
        </Field>
        <Field label={copy.t('pt.contactEmail')} error={field('contactEmail')}>
          <Input type="email" {...form.register('contactEmail')} />
        </Field>
        <Field label={copy.t('pt.contactPhone')} error={field('contactPhone')}>
          <Input type="tel" dir="ltr" {...form.register('contactPhone')} />
        </Field>
      </form>
    </Dialog>
  );
}

export function PartnersScreen() {
  const copy = useCopy();
  const api = useApi();
  const navigate = useNavigate();
  const canWrite = useCan('partners.write');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const term = useDebounce(search, 300);
  const { q, pager } = usePaged(['partners', term, status], (cursor) =>
    unwrap(
      api.http.GET('/v1/ops/partners', {
        params: {
          query: {
            ...(term ? { search: term } : {}),
            ...(status ? { status: status as Partner['status'] } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
  const columns: Column<Partner>[] = [
    {
      id: 'tradeName',
      header: copy.t('pt.trade'),
      cell: (p) => (
        <Link to="/partners/$id" params={{ id: p.id }}>
          {p.tradeName}
        </Link>
      ),
    },
    { id: 'code', header: copy.t('pt.code'), cell: (p) => <bdi>{p.code}</bdi> },
    { id: 'status', header: copy.t('status'), cell: (p) => <Status group="ps" value={p.status} /> },
    {
      id: 'commission',
      header: copy.t('pt.commission'),
      numeric: true,
      cell: (p) => <bdi>{bpsToPct(p.commissionBps)}%</bdi>,
    },
    { id: 'created', header: copy.t('created'), cell: (p) => <DateTime value={p.createdAt} /> },
  ];
  return (
    <div className="ops-stack">
      <PageHeader
        title={copy.t('pt.title')}
        description={copy.t('pt.desc')}
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              {copy.t('pt.new')}
            </Button>
          )
        }
      />
      <FilterBar
        onClear={() => {
          setSearch('');
          setStatus('');
          pager.reset();
        }}
      >
        <Field label={copy.t('pt.search')}>
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
            {PARTNER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {copy.label('ps', s)}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <DataTable
        caption={copy.t('pt.title')}
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(p) => p.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowActivate={(p) => void navigate({ to: '/partners/$id', params: { id: p.id } })}
        empty={<EmptyState title={copy.t('none')} />}
      />
      <Pager pager={pager} nextCursor={q.data?.nextCursor} busy={q.isFetching} />
      {creating && (
        <PartnerDialog
          open
          onClose={() => setCreating(false)}
          onSaved={(p) => void navigate({ to: '/partners/$id', params: { id: p.id } })}
        />
      )}
    </div>
  );
}

/* ------------------------------ one partner ------------------------------ */

const OwnerForm = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.email(),
  phone: optionalText(z.string().regex(/^\+[1-9][0-9]{7,14}$/)),
});

function Checklist({ id }: { id: string }) {
  const copy = useCopy();
  const api = useApi();
  const q = useQuery({
    queryKey: ['partner', id, 'checklist'],
    queryFn: () =>
      unwrap(
        api.http.GET('/v1/ops/partners/{id}/activation-checklist', { params: { path: { id } } }),
      ),
  });
  return (
    <Card title={copy.t('pt.checklist')}>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton height="6rem" />
      ) : (
        <>
          <ul className="ops-checklist">
            {q.data.items.map((i) => (
              <li key={i.key}>
                <Badge tone={i.met ? 'ok' : 'warn'}>{copy.t(i.met ? 'pt.met' : 'pt.unmet')}</Badge>{' '}
                {copy.t(`pt.check.${i.key}`)}
              </li>
            ))}
          </ul>
          <p>{copy.t(q.data.ready ? 'pt.ready' : 'pt.notReady')}</p>
        </>
      )}
    </Card>
  );
}

function Lifecycle({ partner }: { partner: Partner }) {
  const copy = useCopy();
  const api = useApi();
  const isAdmin = useCan('partners.activate');
  const canWrite = useCan('partners.write');
  const [to, setTo] = useState<Partner['status'] | ''>('');
  const [force, setForce] = useState(false);
  const [open, setOpen] = useState(false);
  const targets = PARTNER_STATUSES.filter(
    (s) => s !== partner.status && (isAdmin || (s !== 'Active' && s !== 'Inactive')),
  );
  const move = useAction(
    (v: { to: Partner['status']; reason: string; force: boolean }) =>
      unwrap(
        api.http.POST('/v1/ops/partners/{id}/transition', {
          params: { path: { id: partner.id } },
          body: v,
        }),
      ),
    { success: 'pt.transitioned', invalidate: [['partner'], ['partners'], ['overview']] },
  );
  return (
    <Card title={copy.t('pt.lifecycle')}>
      <p>
        <Status group="ps" value={partner.status} />
      </p>
      {!isAdmin && <Notice info>{copy.t('pt.adminOnlyStatus')}</Notice>}
      {canWrite && (
        <Field label={copy.t('pt.moveTo')}>
          <Select value={to} onChange={(e) => setTo(e.target.value as Partner['status'] | '')}>
            <option value="">{copy.t('none')}</option>
            {targets.map((s) => (
              <option key={s} value={s}>
                {copy.label('ps', s)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {canWrite && (
        <Button disabled={to === ''} onClick={() => setOpen(true)}>
          {copy.t('pt.transition')}
        </Button>
      )}
      <ReasonConfirm
        open={open && to !== ''}
        title={copy.t('pt.transition')}
        description={`${copy.label('ps', partner.status)} → ${to ? copy.label('ps', to) : ''}`}
        confirmLabel={copy.t('pt.transition')}
        danger={to === 'Inactive'}
        extra={
          isAdmin && to === 'Inactive' ? (
            <Checkbox
              label={copy.t('pt.force')}
              hint={copy.t('pt.forceHint')}
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
          ) : null
        }
        onConfirm={async (reason) => {
          if (to === '') return;
          await move.mutateAsync({ to, reason, force: isAdmin && to === 'Inactive' && force });
          setOpen(false);
          setTo('');
          setForce(false);
        }}
        onClose={() => {
          setOpen(false);
          setForce(false);
        }}
      />
    </Card>
  );
}

function OwnerInvitation({ partner }: { partner: Partner }) {
  const copy = useCopy();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const form = useApiForm(OwnerForm, { fullName: '', email: '', phone: '' });
  const invite = useAction(
    (body: z.output<typeof OwnerForm>) =>
      unwrap(
        api.http.POST('/v1/ops/partners/{id}/owner-invitation', {
          params: { path: { id: partner.id } },
          body: { ...body, locationId: null },
        }),
      ),
    {
      success: 'pt.invited',
      invalidate: [['partner']],
      onSuccess: () => {
        setOpen(false);
        form.reset();
      },
      onError: form.setServerError,
    },
  );
  return (
    <>
      <Button onClick={() => setOpen(true)}>{copy.t('pt.inviteOwner')}</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={copy.t('pt.inviteOwner')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {copy.t('back')}
            </Button>
            <Button variant="primary" type="submit" form="owner-form" loading={invite.isPending}>
              {copy.t('pt.inviteOwner')}
            </Button>
          </>
        }
      >
        <form
          id="owner-form"
          noValidate
          onSubmit={form.handleSubmit((v) => {
            form.clearServerError();
            invite.mutate(v);
          })}
        >
          <FormProblem form={form} />
          <Field label={copy.t('pt.ownerName')} required error={form.messageFor('fullName')}>
            <Input {...form.register('fullName')} />
          </Field>
          <Field label={copy.t('pt.ownerEmail')} required error={form.messageFor('email')}>
            <Input type="email" {...form.register('email')} />
          </Field>
          <Field label={copy.t('pt.contactPhone')} error={form.messageFor('phone')}>
            <Input type="tel" dir="ltr" {...form.register('phone')} />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

type Member = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  mfaEnrolled: boolean;
};

function Team({ partner }: { partner: Partner }) {
  const copy = useCopy();
  const api = useApi();
  const canWrite = useCan('partners.write');
  const [target, setTarget] = useState<Member | null>(null);
  const q = useQuery({
    queryKey: ['partner', partner.id, 'team'],
    queryFn: () =>
      unwrap(api.http.GET('/v1/ops/partners/{id}/team', { params: { path: { id: partner.id } } })),
  });
  const reset = useAction(
    (v: { id: string; reason: string }) =>
      unwrap(
        api.http.POST('/v1/ops/seller-users/{id}/mfa-reset', {
          params: { path: { id: v.id } },
          body: { reason: v.reason },
        }),
      ),
    {
      success: 'pt.resetDone',
      successValues: (r) => ({ n: r.revokedSessions }),
      invalidate: [['partner']],
    },
  );
  const columns: Column<Member>[] = [
    { id: 'name', header: copy.t('name'), cell: (m) => m.fullName },
    { id: 'email', header: copy.t('email'), cell: (m) => <bdi>{m.email}</bdi> },
    { id: 'role', header: copy.t('role'), cell: (m) => copy.label('role', m.role) },
    { id: 'status', header: copy.t('status'), cell: (m) => <Status group="us" value={m.status} /> },
    { id: 'mfa', header: copy.t('pt.mfa'), cell: (m) => copy.t(m.mfaEnrolled ? 'yes' : 'no') },
    {
      id: 'actions',
      header: copy.t('actions'),
      cell: (m) =>
        canWrite && m.mfaEnrolled ? (
          <Button onClick={() => setTarget(m)}>{copy.t('pt.resetMfa')}</Button>
        ) : null,
    },
  ];
  return (
    <Card
      title={copy.t('pt.team')}
      actions={canWrite ? <OwnerInvitation partner={partner} /> : null}
    >
      <DataTable
        caption={copy.t('pt.team')}
        columns={columns}
        rows={q.data?.members ?? []}
        rowKey={(m) => m.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        empty={<EmptyState title={copy.t('pt.teamEmpty')} />}
      />
      <ReasonConfirm
        open={target !== null}
        title={copy.t('pt.resetMfaTitle')}
        description={`${target?.fullName ?? ''} — ${copy.t('pt.resetMfaBody')}`}
        confirmLabel={copy.t('pt.resetMfa')}
        danger
        onConfirm={async (reason) => {
          if (target) await reset.mutateAsync({ id: target.id, reason });
        }}
        onClose={() => setTarget(null)}
      />
    </Card>
  );
}

export function PartnerDetailScreen() {
  const copy = useCopy();
  const api = useApi();
  const { id } = useParams({ strict: false }) as { id: string };
  const canWrite = useCan('partners.write');
  const [editing, setEditing] = useState(false);
  const q = useQuery({
    queryKey: ['partner', id],
    queryFn: () => unwrap(api.http.GET('/v1/ops/partners/{id}', { params: { path: { id } } })),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  if (!p) return <Skeleton height="12rem" />;
  return (
    <div className="ops-stack">
      <PageHeader
        title={p.tradeName}
        description={<bdi>{p.code}</bdi>}
        actions={
          <>
            <Link to="/partners">{copy.t('back')}</Link>
            {canWrite && <Button onClick={() => setEditing(true)}>{copy.t('edit')}</Button>}
          </>
        }
      />
      <div className="ops-grid">
        <Card title={copy.t('details')}>
          <KeyValueList
            items={[
              { key: 'legal', label: copy.t('pt.legal'), value: p.legalName },
              {
                key: 'tax',
                label: copy.t('pt.taxNo'),
                value: p.taxRegistrationNo ?? copy.t('none'),
              },
              {
                key: 'commission',
                label: copy.t('pt.commission'),
                value: <bdi>{bpsToPct(p.commissionBps)}%</bdi>,
              },
              {
                key: 'terms',
                label: copy.t('pt.afterSales'),
                value: p.afterSalesTerms ?? copy.t('none'),
              },
              {
                key: 'email',
                label: copy.t('pt.contactEmail'),
                value: p.contactEmail ?? copy.t('none'),
              },
              {
                key: 'phone',
                label: copy.t('pt.contactPhone'),
                value: p.contactPhone ? <bdi>{p.contactPhone}</bdi> : copy.t('none'),
              },
              { key: 'created', label: copy.t('created'), value: <DateTime value={p.createdAt} /> },
            ]}
          />
          <Notice info>{copy.t('pt.commissionNote')}</Notice>
        </Card>
        <Lifecycle partner={p} />
        <Checklist id={p.id} />
      </div>
      <Team partner={p} />
      {editing && <PartnerDialog open partner={p} onClose={() => setEditing(false)} />}
    </div>
  );
}
