import { unwrap } from '@aidooi/api-client';
import { InviteStaffBodySchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  useApi,
  useProblemText,
  type Column,
} from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { OPS_ROLES } from '../lib/roles.ts';
import { FormProblem, useApiForm } from '../lib/forms.tsx';
import { useCopy } from '../lib/i18n.ts';
import { useMe } from '../shell/Me.tsx';
import { Notice, Status, useAction } from './common.tsx';
import { ReasonConfirm } from './ReasonConfirm.tsx';

type Staff = {
  id: string;
  email: string;
  fullName: string;
  role: (typeof OPS_ROLES)[number];
  status: 'Active' | 'Disabled';
  mfaEnrolled: boolean;
  hasCredential: boolean;
};

function InviteDialog({ onClose }: { onClose: () => void }) {
  const copy = useCopy();
  const api = useApi();
  const form = useApiForm(InviteStaffBodySchema, { email: '', fullName: '', role: 'ops_support' });
  const invite = useAction(
    (body: { email: string; fullName: string; role: Staff['role'] }) =>
      unwrap(api.http.POST('/v1/ops/staff', { body })),
    {
      success: 'sf.invited',
      invalidate: [['staff']],
      onSuccess: onClose,
      onError: form.setServerError,
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={copy.t('sf.invite')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {copy.t('back')}
          </Button>
          <Button variant="primary" type="submit" form="staff-form" loading={invite.isPending}>
            {copy.t('sf.invite')}
          </Button>
        </>
      }
    >
      <form
        id="staff-form"
        noValidate
        onSubmit={form.handleSubmit((v) => {
          form.clearServerError();
          invite.mutate(v);
        })}
      >
        <FormProblem form={form} />
        <Field label={copy.t('sf.fullName')} required error={form.messageFor('fullName')}>
          <Input {...form.register('fullName')} />
        </Field>
        <Field label={copy.t('email')} required error={form.messageFor('email')}>
          <Input type="email" {...form.register('email')} />
        </Field>
        <Field label={copy.t('role')} required error={form.messageFor('role')}>
          <Select {...form.register('role')}>
            {OPS_ROLES.map((r) => (
              <option key={r} value={r}>
                {copy.label('role', r)}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}

export function StaffScreen() {
  const copy = useCopy();
  const api = useApi();
  const me = useMe();
  const problemText = useProblemText();
  const [inviting, setInviting] = useState(false);
  const [toggle, setToggle] = useState<Staff | null>(null);
  const [reset, setReset] = useState<Staff | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const q = useQuery({ queryKey: ['staff'], queryFn: () => unwrap(api.http.GET('/v1/ops/staff')) });
  const patch = useAction(
    (v: { id: string; role?: Staff['role']; status?: Staff['status'] }) =>
      unwrap(
        api.http.PATCH('/v1/ops/staff/{id}', {
          params: { path: { id: v.id } },
          body: { ...(v.role ? { role: v.role } : {}), ...(v.status ? { status: v.status } : {}) },
        }),
      ),
    {
      success: 'sf.updated',
      invalidate: [['staff']],
      onSuccess: () => setFailure(null),
      onError: setFailure,
    },
  );
  const mfa = useAction(
    (v: { id: string; reason: string }) =>
      unwrap(
        api.http.POST('/v1/ops/staff/{id}/mfa-reset', {
          params: { path: { id: v.id } },
          body: { reason: v.reason },
        }),
      ),
    {
      success: 'sf.resetDone',
      successValues: (r) => ({ n: r.revokedSessions }),
      invalidate: [['staff']],
    },
  );
  const columns: Column<Staff>[] = [
    {
      id: 'name',
      header: copy.t('name'),
      cell: (s) => (s.id === me.id ? `${s.fullName} ${copy.t('sf.you')}` : s.fullName),
    },
    { id: 'email', header: copy.t('email'), cell: (s) => <bdi>{s.email}</bdi> },
    {
      id: 'role',
      header: copy.t('role'),
      cell: (s) => (
        <Select
          aria-label={`${copy.t('role')}: ${s.fullName}`}
          value={s.role}
          onChange={(e) => patch.mutate({ id: s.id, role: e.target.value as Staff['role'] })}
        >
          {OPS_ROLES.map((r) => (
            <option key={r} value={r}>
              {copy.label('role', r)}
            </option>
          ))}
        </Select>
      ),
    },
    {
      id: 'status',
      header: copy.t('status'),
      cell: (s) => (
        <>
          <Status group="us" value={s.status} />
          {!s.hasCredential && <div>{copy.t('sf.pending')}</div>}
        </>
      ),
    },
    { id: 'mfa', header: copy.t('sf.mfa'), cell: (s) => copy.t(s.mfaEnrolled ? 'yes' : 'no') },
    {
      id: 'actions',
      header: copy.t('actions'),
      cell: (s) => (
        <>
          <Button onClick={() => setToggle(s)}>
            {copy.t(s.status === 'Active' ? 'sf.disable' : 'sf.enable')}
          </Button>{' '}
          {s.mfaEnrolled && <Button onClick={() => setReset(s)}>{copy.t('sf.resetMfa')}</Button>}
        </>
      ),
    },
  ];
  return (
    <div className="ops-stack">
      <PageHeader
        title={copy.t('sf.title')}
        description={copy.t('sf.desc')}
        actions={
          <Button variant="primary" onClick={() => setInviting(true)}>
            {copy.t('sf.invite')}
          </Button>
        }
      />
      <Notice info>{copy.t('sf.lastAdmin')}</Notice>
      {failure !== null && (
        <p role="alert" className="ui-field__error">
          {problemText(failure)}
        </p>
      )}
      <Card>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <DataTable
            caption={copy.t('sf.title')}
            columns={columns}
            rows={q.data?.staff ?? []}
            rowKey={(s) => s.id}
            loading={q.isPending}
            empty={<EmptyState title={copy.t('none')} />}
          />
        )}
      </Card>
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      <ConfirmDialog
        open={toggle !== null}
        danger={toggle?.status === 'Active'}
        title={copy.t(toggle?.status === 'Active' ? 'sf.disableTitle' : 'sf.enable')}
        description={`${toggle?.fullName ?? ''} — ${copy.t(toggle?.status === 'Active' ? 'sf.disableBody' : 'sf.updated')}`}
        confirmLabel={copy.t(toggle?.status === 'Active' ? 'sf.disable' : 'sf.enable')}
        onConfirm={async () => {
          if (toggle)
            await patch.mutateAsync({
              id: toggle.id,
              status: toggle.status === 'Active' ? 'Disabled' : 'Active',
            });
        }}
        onClose={() => setToggle(null)}
      />
      <ReasonConfirm
        open={reset !== null}
        danger
        title={copy.t('sf.resetTitle')}
        description={`${reset?.fullName ?? ''} — ${copy.t('sf.resetBody')}`}
        confirmLabel={copy.t('sf.resetMfa')}
        onConfirm={async (reason) => {
          if (reset) await mfa.mutateAsync({ id: reset.id, reason });
        }}
        onClose={() => setReset(null)}
      />
    </div>
  );
}
