import { ApiProblem, unwrap } from '@aidooi/api-client';
import { StaffLoginSchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  Field,
  FormErrorSummary,
  Input,
  useApi,
  useApiMutation,
  useAuth,
  useProblemText,
} from '@aidooi/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { EnrolPanel } from '../components/EnrolPanel.tsx';
import { useS } from '../i18n/index.tsx';
import { resolverFor } from '../lib/forms.ts';
import { toSession } from '../lib/staff-session.ts';

type Values = { email: string; password: string; totpCode: string };

export function SignInScreen() {
  const s = useS();
  const api = useApi();
  const auth = useAuth();
  const navigate = useNavigate();
  const problemText = useProblemText();
  const [enrol, setEnrol] = useState<{ email: string; password: string } | null>(null);

  const form = useForm<Values>({
    defaultValues: { email: '', password: '', totpCode: '' },
    resolver: resolverFor(StaffLoginSchema, s),
  });
  const login = useApiMutation(
    async (v: Values) => unwrap(api.http.POST('/v1/auth/staff/login', { body: v })),
    {
      onSuccess: async (session, v) => {
        if (session.staff.kind !== 'seller') {
          // An operations account belongs in the operations console, not here.
          form.setError('root', { message: 'ops' });
          return;
        }
        await auth.signIn(toSession(session));
        void navigate({ to: '/' });
        void v;
      },
      onError: (e, v) => {
        // Valid password but no authenticator yet: carry on to set one up.
        if (e instanceof ApiProblem && e.code === 'mfa_enrolment_required') {
          setEnrol({ email: v.email, password: v.password });
        }
      },
    },
  );

  if (enrol) {
    return (
      <main className="portal-center">
        <EnrolPanel
          email={enrol.email}
          password={enrol.password}
          onDone={() => void navigate({ to: '/' })}
        />
      </main>
    );
  }

  const problem = login.error instanceof ApiProblem ? login.error : null;
  const rootError = form.formState.errors.root ? s.signInOpsAccount : null;
  const summary = Object.entries(form.formState.errors)
    .filter(([k]) => k !== 'root')
    .map(([path, e]) => ({ path, message: String((e as { message?: string }).message ?? '') }));

  return (
    <main className="portal-center">
      <Card title={s.signInTitle}>
        <p>{s.signInIntro}</p>
        <FormErrorSummary errors={form.formState.isSubmitted ? summary : []} />
        <form onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
          <Field id="email" label={s.email} required error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="username" {...form.register('email')} />
          </Field>
          <Field
            id="password"
            label={s.password}
            required
            error={form.formState.errors.password?.message}
          >
            <Input type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <Field
            id="totpCode"
            label={s.totpCode}
            hint={s.totpHint}
            required
            error={form.formState.errors.totpCode?.message}
          >
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              {...form.register('totpCode')}
            />
          </Field>
          {(problem && problem.code !== 'mfa_enrolment_required') || rootError ? (
            <p role="alert" className="portal-error">
              {rootError ?? problemText(problem)}
            </p>
          ) : null}
          <Button type="submit" variant="primary" loading={login.isPending}>
            {s.signIn}
          </Button>
        </form>
      </Card>
    </main>
  );
}
