import { unwrap } from '@aidooi/api-client';
import { UpdateProfileBodySchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  ErrorState,
  Field,
  FormErrorSummary,
  Input,
  KeyValueList,
  PageHeader,
  Spinner,
  Textarea,
  useApi,
  useApiMutation,
  useProblemText,
  useToast,
} from '@aidooi/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Guard } from '../components/Guard.tsx';
import { useS } from '../i18n/index.tsx';
import { validateBody } from '../lib/forms.ts';
import { fieldErrorsOf, messageFor } from '../lib/problem.ts';

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function ProfileScreen() {
  return (
    <Guard action="editProfile">
      <ProfileBody />
    </Guard>
  );
}

function ProfileBody() {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const queries = useQueryClient();
  const problemText = useProblemText();
  const q = useQuery({
    queryKey: ['profile'],
    queryFn: () => unwrap(api.http.GET('/v1/seller/profile')),
  });
  const [f, setF] = useState({
    tradeName: '',
    contactEmail: '',
    contactPhone: '',
    afterSalesTerms: '',
  });
  const [local, setLocal] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data)
      setF({
        tradeName: q.data.tradeName,
        contactEmail: q.data.contactEmail ?? '',
        contactPhone: q.data.contactPhone ?? '',
        afterSalesTerms: q.data.afterSalesTerms ?? '',
      });
  }, [q.data]);
  const save = useApiMutation(
    async (body: Record<string, unknown>) =>
      unwrap(api.http.PATCH('/v1/seller/profile', { body: body as never })),
    {
      onSuccess: async () => {
        toast.push({ message: s.profileSaved, tone: 'ok' });
        await queries.invalidateQueries({ queryKey: ['profile'] });
      },
    },
  );
  const server = fieldErrorsOf(save.error);

  const submit = () => {
    const body = {
      tradeName: f.tradeName.trim(),
      contactEmail: f.contactEmail.trim() || null,
      contactPhone: f.contactPhone.trim() || null,
      afterSalesTerms: f.afterSalesTerms.trim() || null,
    };
    const v = validateBody(UpdateProfileBodySchema, body, s);
    if (!v.ok) return setLocal(v.errors);
    setLocal({});
    save.mutate(body);
  };
  const summary = [
    ...Object.entries(local).map(([path, message]) => ({ path, message })),
    ...server,
  ];
  const err = (p: string) => local[p] ?? messageFor(server, p);

  return (
    <>
      <PageHeader title={s.navProfile} description={s.profileIntro} />
      {q.isPending && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <>
          <Card title={s.yourRecord}>
            <p className="portal-note">{s.recordReadOnly}</p>
            <KeyValueList
              items={[
                { key: 'code', label: s.partnerCode, value: <bdi>{q.data.code}</bdi> },
                { key: 'legal', label: s.legalName, value: q.data.legalName },
                { key: 'status', label: s.status, value: q.data.status },
              ]}
            />
          </Card>
          <Card title={s.storeDetails}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              noValidate
            >
              <FormErrorSummary errors={summary} />
              {save.error && server.length === 0 && (
                <p role="alert" className="portal-error">
                  {problemText(save.error)}
                </p>
              )}
              <Field id="tradeName" label={s.tradeName} required error={err('tradeName')}>
                <Input
                  value={f.tradeName}
                  onChange={(e) => setF({ ...f, tradeName: e.target.value })}
                />
              </Field>
              <Field id="contactEmail" label={s.contactEmail} error={err('contactEmail')}>
                <Input
                  type="email"
                  value={f.contactEmail}
                  onChange={(e) => setF({ ...f, contactEmail: e.target.value })}
                />
              </Field>
              <Field
                id="contactPhone"
                label={s.contactPhone}
                hint={s.phoneHint}
                error={err('contactPhone')}
              >
                <Input
                  dir="ltr"
                  inputMode="tel"
                  value={f.contactPhone}
                  onChange={(e) => setF({ ...f, contactPhone: e.target.value })}
                />
              </Field>
              <Field
                id="afterSalesTerms"
                label={s.afterSalesTerms}
                hint={s.afterSalesHint}
                error={err('afterSalesTerms')}
              >
                <Textarea
                  rows={5}
                  value={f.afterSalesTerms}
                  onChange={(e) => setF({ ...f, afterSalesTerms: e.target.value })}
                />
              </Field>
              <Button type="submit" variant="primary" loading={save.isPending}>
                {s.save}
              </Button>
            </form>
          </Card>
        </>
      )}
    </>
  );
}
