import { ApiProblem, unwrap } from '@aidooi/api-client';
import { StaffMfaVerifySchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Spinner,
  useApi,
  useApiMutation,
  useAuth,
} from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useS } from '../i18n/index.tsx';
import { resolverFor } from '../lib/forms.ts';
import { toSession } from '../lib/staff-session.ts';

/** Groups a base32 seed in fours so it can be typed into an authenticator by hand. */
export const groupSeed = (seed: string): string => seed.replace(/(.{4})/g, '$1 ').trim();

/**
 * Two-step setup: show the authenticator QR (and the secret, for people who cannot scan), then confirm
 * with the first code. Confirming also signs the person in.
 */
export function EnrolPanel({
  email,
  password,
  onDone,
}: {
  email: string;
  password: string;
  onDone: () => void;
}) {
  const s = useS();
  const api = useApi();
  const auth = useAuth();
  const [qr, setQr] = useState<string | null>(null);

  const enrol = useQuery({
    queryKey: ['mfa-enrol', email],
    // The seed is shown once; refetching it would be refused, and must never happen implicitly.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: () =>
      unwrap(api.http.POST('/v1/auth/staff/mfa/enroll', { body: { email, password } })),
  });
  const uri = enrol.data?.otpauthUri;
  useEffect(() => {
    if (!uri) return;
    let live = true;
    void QRCode.toDataURL(uri, { margin: 1, width: 220 }).then((d) => live && setQr(d));
    return () => {
      live = false;
    };
  }, [uri]);

  const form = useForm<{ email: string; password: string; totpCode: string }>({
    defaultValues: { email, password, totpCode: '' },
    resolver: resolverFor(StaffMfaVerifySchema, s),
  });
  const confirm = useApiMutation(
    async (v: { totpCode: string }) =>
      unwrap(
        api.http.POST('/v1/auth/staff/mfa/verify', {
          body: { email, password, totpCode: v.totpCode },
        }),
      ),
    {
      onSuccess: async (session) => {
        await auth.signIn(toSession(session));
        onDone();
      },
    },
  );

  if (enrol.isPending) return <Spinner />;
  if (enrol.isError) return <ErrorState error={enrol.error} />;

  const wrong = confirm.error instanceof ApiProblem ? confirm.error : null;
  return (
    <Card title={s.enrolTitle}>
      <ol className="portal-steps">
        <li>{s.enrolStep1}</li>
        <li>{s.enrolStep2}</li>
      </ol>
      {qr && <img className="portal-qr" src={qr} alt={s.qrAlt} width={220} height={220} />}
      <p>
        {s.enrolManual}
        <br />
        <code dir="ltr" className="portal-secret" data-testid="seed">
          {groupSeed(enrol.data.seed)}
        </code>
      </p>
      <form
        onSubmit={form.handleSubmit((v) => confirm.mutate({ totpCode: v.totpCode }))}
        noValidate
      >
        <Field
          label={s.totpCode}
          required
          error={form.formState.errors.totpCode?.message ?? (wrong ? s.totpWrong : undefined)}
        >
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            {...form.register('totpCode')}
          />
        </Field>
        <Button type="submit" variant="primary" loading={confirm.isPending}>
          {s.enrolConfirm}
        </Button>
      </form>
    </Card>
  );
}
