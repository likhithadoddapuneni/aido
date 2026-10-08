import { unwrap } from '@aidooi/api-client';
import { StaffLoginSchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  Field,
  Input,
  useApi,
  useApiMutation,
  useAuth,
  PageHeader,
} from '@aidooi/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormProblem, useApiForm } from '../lib/forms.tsx';
import { useCopy } from '../lib/i18n.ts';

/** Email, password and the six-digit code from the authenticator app. Two-step is mandatory for staff. */
export function SignIn() {
  const copy = useCopy();
  const api = useApi();
  const auth = useAuth();
  const queries = useQueryClient();
  const [notOps, setNotOps] = useState(false);
  const form = useApiForm(StaffLoginSchema, { email: '', password: '', totpCode: '' });

  const login = useApiMutation(
    (v: { email: string; password: string; totpCode: string }) =>
      unwrap(api.http.POST('/v1/auth/staff/login', { body: v })),
    {
      onSuccess: async (s) => {
        if (s.staff.kind !== 'ops') {
          // A seller signed in to the wrong place: end the session we just created and say so.
          await api.http
            .POST('/v1/auth/logout', { body: { refreshToken: s.refreshToken } })
            .catch(() => undefined);
          setNotOps(true);
          return;
        }
        queries.clear();
        await auth.signIn({
          kind: 'user',
          accessToken: s.accessToken,
          refreshToken: s.refreshToken,
        });
      },
      onError: form.setServerError,
    },
  );

  return (
    <main id="main-content" tabIndex={-1} className="ui-signin">
      <PageHeader title={copy.t('auth.title')} description={copy.t('auth.intro')} />
      <Card>
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => {
            form.clearServerError();
            setNotOps(false);
            login.mutate(v);
          })}
        >
          <FormProblem form={form} />
          {notOps && (
            <p role="alert" className="ui-field__error">
              {copy.t('auth.notOps')}
            </p>
          )}
          <Field label={copy.t('email')} id="email" required error={form.messageFor('email')}>
            <Input type="email" autoComplete="username" {...form.register('email')} />
          </Field>
          <Field
            label={copy.t('password')}
            id="password"
            required
            error={form.messageFor('password')}
          >
            <Input type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <Field
            label={copy.t('auth.code')}
            id="totpCode"
            required
            hint={copy.t('auth.codeHint')}
            error={form.messageFor('totpCode')}
          >
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              {...form.register('totpCode')}
            />
          </Field>
          <Button type="submit" variant="primary" loading={login.isPending}>
            {copy.t('auth.submit')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
