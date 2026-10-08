import { unwrap } from '@aidooi/api-client';
import { InviteBodySchema, type TeamMemberSchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  FormErrorSummary,
  Input,
  PageHeader,
  Select,
  StatusPill,
  useApi,
  useApiMutation,
  useProblemText,
  useToast,
  type Column,
} from '@aidooi/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Guard } from '../components/Guard.tsx';
import { MEMBER_TONE, labelled } from '../components/pills.ts';
import { useS } from '../i18n/index.tsx';
import { resolverFor, serverErrorsByPath } from '../lib/forms.ts';
import { fieldErrorsOf } from '../lib/problem.ts';
import { useMe } from '../lib/me.tsx';

type Member = z.infer<typeof TeamMemberSchema>;
type Role = Member['role'];
const ROLES: readonly Role[] = ['seller_owner', 'seller_manager', 'seller_staff'];
interface Invite {
  email: string;
  fullName: string;
  role: Role;
  locationId: string | null;
}

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function TeamScreen() {
  return (
    <Guard action="manageTeam">
      <TeamBody />
    </Guard>
  );
}

function TeamBody() {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const queries = useQueryClient();
  const problemText = useProblemText();
  const me = useMe();
  const [disabling, setDisabling] = useState<Member | null>(null);

  const team = useQuery({
    queryKey: ['team'],
    queryFn: async () => (await unwrap(api.http.GET('/v1/seller/team'))).members,
  });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: async () => unwrap(api.http.GET('/v1/seller/locations')),
  });

  const form = useForm<Invite>({
    defaultValues: { email: '', fullName: '', role: 'seller_staff', locationId: null },
    resolver: resolverFor(InviteBodySchema, s),
  });
  const refresh = () => queries.invalidateQueries({ queryKey: ['team'] });
  const invite = useApiMutation(
    async (v: Invite) => unwrap(api.http.POST('/v1/seller/team/invitations', { body: v })),
    {
      onSuccess: async () => {
        toast.push({ message: s.inviteSent, tone: 'ok' });
        form.reset();
        await refresh();
      },
    },
  );
  const update = useApiMutation(
    async (v: { id: string; body: { role?: Role; status?: 'Active' | 'Disabled' } }) =>
      unwrap(
        api.http.PATCH('/v1/seller/team/{id}', { params: { path: { id: v.id } }, body: v.body }),
      ),
    { onSuccess: refresh },
  );

  const serverErrors = serverErrorsByPath(fieldErrorsOf(invite.error));
  const summary = [
    ...Object.entries(form.formState.errors).map(([path, e]) => ({
      path,
      message: String((e as { message?: string }).message ?? ''),
    })),
    ...fieldErrorsOf(invite.error),
  ];
  const locationList = locations.data?.locations ?? [];

  const columns: Column<Member>[] = [
    { id: 'name', header: s.name, cell: (m) => m.fullName },
    { id: 'email', header: s.email, cell: (m) => m.email },
    {
      id: 'role',
      header: s.role,
      cell: (m) => (
        <Select
          aria-label={s.fmt('roleFor', { name: m.fullName })}
          value={m.role}
          disabled={m.id === me.data?.id || update.isPending}
          onChange={(e) => update.mutate({ id: m.id, body: { role: e.target.value as Role } })}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {s.roles[r]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      id: 'status',
      header: s.status,
      cell: (m) => (
        <StatusPill status={s.memberStates[m.status]} map={labelled(s.memberStates, MEMBER_TONE)} />
      ),
    },
    {
      id: 'actions',
      header: <span className="ui-visually-hidden">{s.actions}</span>,
      cell: (m) =>
        m.id === me.data?.id ? null : m.status === 'Disabled' ? (
          <Button
            onClick={() => update.mutate({ id: m.id, body: { status: 'Active' } })}
            aria-label={s.fmt('enableFor', { name: m.fullName })}
          >
            {s.enable}
          </Button>
        ) : (
          <Button
            variant="danger"
            onClick={() => setDisabling(m)}
            aria-label={s.fmt('disableFor', { name: m.fullName })}
          >
            {s.disable}
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader title={s.navTeam} description={s.teamIntro} />
      {update.error ? (
        <p role="alert" className="portal-error">
          {problemText(update.error)}
        </p>
      ) : null}
      <DataTable
        caption={s.navTeam}
        columns={columns}
        rows={team.data ?? []}
        rowKey={(m) => m.id}
        loading={team.isPending}
        error={team.error}
        onRetry={() => void team.refetch()}
        empty={<EmptyState title={s.noTeam} />}
      />
      <Card title={s.inviteMember}>
        <FormErrorSummary errors={form.formState.isSubmitted ? summary : []} />
        <form onSubmit={form.handleSubmit((v) => invite.mutate(v))} noValidate>
          <Field
            id="invite-name"
            label={s.name}
            required
            error={form.formState.errors.fullName?.message ?? serverErrors.fullName}
          >
            <Input {...form.register('fullName')} />
          </Field>
          <Field
            id="invite-email"
            label={s.email}
            required
            error={form.formState.errors.email?.message ?? serverErrors.email}
          >
            <Input type="email" {...form.register('email')} />
          </Field>
          <Field id="invite-role" label={s.role}>
            <Select {...form.register('role')}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {s.roles[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="invite-location" label={s.showroom} hint={s.inviteLocationHint}>
            <Select
              {...form.register('locationId', { setValueAs: (v: string) => (v === '' ? null : v) })}
            >
              <option value="">{s.allShowrooms}</option>
              {locationList.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          {invite.error && fieldErrorsOf(invite.error).length === 0 ? (
            <p role="alert" className="portal-error">
              {problemText(invite.error)}
            </p>
          ) : null}
          <Button type="submit" variant="primary" loading={invite.isPending}>
            {s.sendInvite}
          </Button>
        </form>
      </Card>
      <ConfirmDialog
        open={disabling !== null}
        title={disabling ? s.fmt('disableFor', { name: disabling.fullName }) : ''}
        description={s.disableWarning}
        confirmLabel={s.disable}
        danger
        onClose={() => setDisabling(null)}
        onConfirm={async () => {
          if (disabling)
            await update.mutateAsync({ id: disabling.id, body: { status: 'Disabled' } });
          setDisabling(null);
        }}
      />
    </>
  );
}
