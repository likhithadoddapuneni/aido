import { unwrap } from '@aidooi/api-client';
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
  Input,
  PageHeader,
  useApi,
  type Column,
} from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { FormProblem, optionalText, useApiForm } from '../lib/forms.tsx';
import { useCopy } from '../lib/i18n.ts';
import { useAction } from './common.tsx';

type Flag = {
  key: string;
  enabled: boolean;
  rolloutPct: number;
  description: string | null;
  updatedAt: string;
};

const FlagForm = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]{1,60}$/),
  enabled: z.boolean(),
  rolloutPct: z.coerce.number().int().min(0).max(100),
  description: optionalText(z.string().max(300)),
});

function FlagDialog({ flag, onClose }: { flag: Flag | null; onClose: () => void }) {
  const copy = useCopy();
  const api = useApi();
  const form = useApiForm(FlagForm, {
    key: flag?.key ?? '',
    enabled: flag?.enabled ?? false,
    rolloutPct: flag?.rolloutPct ?? 100,
    description: flag?.description ?? '',
  });
  const save = useAction(
    (v: z.output<typeof FlagForm>) =>
      unwrap(
        api.http.PUT('/v1/ops/feature-flags/{key}', {
          params: { path: { key: v.key } },
          body: { enabled: v.enabled, rolloutPct: v.rolloutPct, description: v.description },
        }),
      ),
    {
      success: 'fl.saved',
      invalidate: [['flags']],
      onSuccess: onClose,
      onError: form.setServerError,
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={flag ? flag.key : copy.t('fl.new')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {copy.t('back')}
          </Button>
          <Button variant="primary" type="submit" form="flag-form" loading={save.isPending}>
            {copy.t('save')}
          </Button>
        </>
      }
    >
      <form
        id="flag-form"
        noValidate
        onSubmit={form.handleSubmit((v) => {
          form.clearServerError();
          save.mutate(v);
        })}
      >
        <FormProblem form={form} />
        <Field label={copy.t('fl.key')} required error={form.messageFor('key')}>
          <Input dir="ltr" readOnly={flag !== null} {...form.register('key')} />
        </Field>
        <Checkbox label={copy.t('fl.enabled')} {...form.register('enabled')} />
        <Field label={copy.t('fl.rollout')} required error={form.messageFor('rolloutPct')}>
          <Input inputMode="numeric" {...form.register('rolloutPct')} />
        </Field>
        <Field label={copy.t('fl.description')} error={form.messageFor('description')}>
          <Input {...form.register('description')} />
        </Field>
      </form>
    </Dialog>
  );
}

export function FlagsScreen() {
  const copy = useCopy();
  const api = useApi();
  const [editing, setEditing] = useState<Flag | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['flags'],
    queryFn: () => unwrap(api.http.GET('/v1/ops/feature-flags')),
  });
  const columns: Column<Flag>[] = [
    { id: 'key', header: copy.t('fl.key'), cell: (f) => <bdi>{f.key}</bdi> },
    {
      id: 'enabled',
      header: copy.t('fl.enabled'),
      cell: (f) => (
        <Badge tone={f.enabled ? 'ok' : 'neutral'}>{copy.t(f.enabled ? 'yes' : 'no')}</Badge>
      ),
    },
    {
      id: 'pct',
      header: copy.t('fl.rollout'),
      numeric: true,
      cell: (f) => <bdi>{f.rolloutPct}</bdi>,
    },
    { id: 'desc', header: copy.t('fl.description'), cell: (f) => f.description ?? copy.t('none') },
    { id: 'upd', header: copy.t('updated'), cell: (f) => <DateTime value={f.updatedAt} /> },
    {
      id: 'a',
      header: copy.t('actions'),
      cell: (f) => <Button onClick={() => setEditing(f)}>{copy.t('edit')}</Button>,
    },
  ];
  return (
    <div className="ops-stack">
      <PageHeader
        title={copy.t('fl.title')}
        description={copy.t('fl.desc')}
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            {copy.t('fl.new')}
          </Button>
        }
      />
      <Card>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <DataTable
            caption={copy.t('fl.title')}
            columns={columns}
            rows={q.data?.flags ?? []}
            rowKey={(f) => f.key}
            loading={q.isPending}
            empty={<EmptyState title={copy.t('fl.empty')} />}
          />
        )}
      </Card>
      {editing !== null && (
        <FlagDialog flag={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
