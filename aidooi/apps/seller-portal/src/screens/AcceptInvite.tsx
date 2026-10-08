import { unwrap } from '@aidooi/api-client';
import { StaffAcceptInviteSchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  Field,
  FormErrorSummary,
  Input,
  useApi,
  useApiMutation,
  useProblemText,
} from '@aidooi/ui-web';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { EnrolPanel } from '../components/EnrolPanel.tsx';
import { useS } from '../i18n/index.tsx';
import { resolverFor } from '../lib/forms.ts';

type Values = { token: string; password: string; confirm: string };

/** An invited colleague sets a password, then continues straight into authenticator setup. */
export function AcceptInviteScreen() {
  const s = useS();
  const api = useApi();
  const navigate = useNavigate();
  const problemText = useProblemText();
  const { token } = getRouteApi('/accept-invite').useSearch();
  const [done, setDone] = useState<{ email: string; password: string } | null>(null);

  const form = useForm<Values>({
    defaultValues: { token, password: '', confirm: '' },
    resolver: resolverFor(
      StaffAcceptInviteSchema.extend({ confirm: StaffAcceptInviteSchema.shape.password }),
      s,
    ),
  });
  const accept = useApiMutation(
    async (v: Values) =>
      unwrap(
        api.http.POST('/v1/auth/staff/accept-invite', {
          body: { token: v.token, password: v.password },
        }),
      ),
    { onSuccess: (r, v) => setDone({ email: r.email, password: v.password }) },
  );

  if (done) {
    return (
      <main className="portal-center">
        <EnrolPanel
          email={done.email}
          password={done.password}
          onDone={() => void navigate({ to: '/' })}
        />
      </main>
    );
  }
  if (!StaffAcceptInviteSchema.shape.token.safeParse(token).success) {
    return (
      <main className="portal-center">
        <Card title={s.inviteTitle}>
          <p role="alert">{s.inviteLinkInvalid}</p>
        </Card>
      </main>
    );
  }
  const mismatch =
    form.formState.isSubmitted && form.watch('password') !== form.watch('confirm')
      ? s.passwordsDiffer
      : undefined;
  const summary = [
    ...Object.entries(form.formState.errors).map(([path, e]) => ({
      path,
      message: String((e as { message?: string }).message ?? ''),
    })),
    ...(mismatch ? [{ path: 'confirm', message: mismatch }] : []),
  ];

  return (
    <main className="portal-center">
      <Card title={s.inviteTitle}>
        <p>{s.inviteIntro}</p>
        <FormErrorSummary errors={form.formState.isSubmitted ? summary : []} />
        <form
          onSubmit={form.handleSubmit((v) => {
            if (v.password !== v.confirm) return;
            accept.mutate(v);
          })}
          noValidate
        >
          <Field
            id="password"
            label={s.newPassword}
            hint={s.passwordHint}
            required
            error={form.formState.errors.password?.message}
          >
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field
            id="confirm"
            label={s.confirmPassword}
            required
            error={mismatch ?? form.formState.errors.confirm?.message}
          >
            <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          {accept.error ? (
            <p role="alert" className="portal-error">
              {problemText(accept.error)}
            </p>
          ) : null}
          <Button type="submit" variant="primary" loading={accept.isPending} disabled={!token}>
            {s.inviteContinue}
          </Button>
        </form>
      </Card>
    </main>
  );
}
