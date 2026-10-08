import { unwrap } from '@aidooi/api-client';
import { StaffAcceptInviteSchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Stepper,
  useApi,
  useApiMutation,
  useAuth,
} from '@aidooi/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { FormProblem, useApiForm } from '../lib/forms.tsx';
import { useCopy } from '../lib/i18n.ts';

const PasswordForm = StaffAcceptInviteSchema.pick({ password: true }).extend({
  confirm: z.string(),
});
const CodeForm = z.object({ totpCode: z.string().regex(/^\d{6}$/) });

/**
 * Accepting an invitation: choose a password, add the account to an authenticator app, prove it works.
 * The password lives only in this component's memory — it is needed twice more to enrol, never stored.
 */
export function InviteFlow() {
  const copy = useCopy();
  const api = useApi();
  const auth = useAuth();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const { token } = useSearch({ strict: false }) as { token?: string };
  const [step, setStep] = useState<0 | 1>(0);
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  const [setup, setSetup] = useState<{ seed: string; otpauthUri: string } | null>(null);

  const passwordForm = useApiForm(PasswordForm, { password: '', confirm: '' });
  const codeForm = useApiForm(CodeForm, { totpCode: '' });

  const accept = useApiMutation(
    async (v: { password: string }) => {
      const { email } = await unwrap(
        api.http.POST('/v1/auth/staff/accept-invite', {
          body: { token: token as string, password: v.password },
        }),
      );
      const seed = await unwrap(
        api.http.POST('/v1/auth/staff/mfa/enroll', { body: { email, password: v.password } }),
      );
      return { email, password: v.password, seed };
    },
    {
      onSuccess: (r) => {
        setCreds({ email: r.email, password: r.password });
        setSetup(r.seed);
        setStep(1);
      },
      onError: passwordForm.setServerError,
    },
  );

  const verify = useApiMutation(
    (v: { totpCode: string }) =>
      unwrap(
        api.http.POST('/v1/auth/staff/mfa/verify', {
          body: { ...(creds as { email: string; password: string }), totpCode: v.totpCode },
        }),
      ),
    {
      onSuccess: async (s) => {
        queries.clear();
        await auth.signIn({
          kind: 'user',
          accessToken: s.accessToken,
          refreshToken: s.refreshToken,
        });
        await navigate({ to: '/' });
      },
      onError: codeForm.setServerError,
    },
  );

  if (!token) {
    return (
      <main id="main-content" tabIndex={-1} className="ui-signin">
        <PageHeader title={copy.t('auth.inviteTitle')} />
        <p role="alert">{copy.t('auth.inviteMissing')}</p>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="ui-signin">
      <PageHeader title={copy.t('auth.inviteTitle')} />
      <Stepper current={step} steps={[copy.t('auth.setPassword'), copy.t('auth.scanTitle')]} />
      {step === 0 && (
        <Card>
          <form
            noValidate
            onSubmit={passwordForm.handleSubmit((v) => {
              passwordForm.clearServerError();
              if (v.password !== v.confirm) {
                passwordForm.setError('confirm', { message: copy.t('auth.mismatch') });
                return;
              }
              accept.mutate({ password: v.password });
            })}
          >
            <FormProblem form={passwordForm} />
            <Field
              label={copy.t('auth.setPassword')}
              id="password"
              required
              hint={copy.t('auth.passwordHint')}
              error={passwordForm.messageFor('password')}
            >
              <Input
                type="password"
                autoComplete="new-password"
                {...passwordForm.register('password')}
              />
            </Field>
            <Field
              label={copy.t('auth.confirmPassword')}
              id="confirm"
              required
              error={passwordForm.messageFor('confirm')}
            >
              <Input
                type="password"
                autoComplete="new-password"
                {...passwordForm.register('confirm')}
              />
            </Field>
            <Button type="submit" variant="primary" loading={accept.isPending}>
              {copy.t('auth.continue')}
            </Button>
          </form>
        </Card>
      )}
      {step === 1 && setup && (
        <Card title={copy.t('auth.scanTitle')}>
          <p>{copy.t('auth.scanBody')}</p>
          <dl className="ui-kv">
            <div className="ui-kv__row">
              <dt>{copy.t('auth.seed')}</dt>
              <dd>
                <bdi>
                  <code data-testid="seed">{setup.seed}</code>
                </bdi>
              </dd>
            </div>
            <div className="ui-kv__row">
              <dt>{copy.t('auth.uri')}</dt>
              <dd>
                <a href={setup.otpauthUri}>{copy.t('auth.uri')}</a>
              </dd>
            </div>
          </dl>
          <form
            noValidate
            onSubmit={codeForm.handleSubmit((v) => {
              codeForm.clearServerError();
              verify.mutate(v);
            })}
          >
            <FormProblem form={codeForm} />
            <Field
              label={copy.t('auth.code')}
              id="totpCode"
              required
              hint={copy.t('auth.codeHint')}
              error={codeForm.messageFor('totpCode')}
            >
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                {...codeForm.register('totpCode')}
              />
            </Field>
            <Button type="submit" variant="primary" loading={verify.isPending}>
              {copy.t('auth.finish')}
            </Button>
          </form>
        </Card>
      )}
    </main>
  );
}
