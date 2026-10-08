import { unwrap } from '@aidooi/api-client';
import {
  CreateLocationBodySchema,
  UpdateLocationBodySchema,
  type LocationSchema,
} from '@aidooi/contracts';
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  FormErrorSummary,
  Input,
  PageHeader,
  Select,
  useApi,
  useApiMutation,
  useProblemText,
  useToast,
  type Column,
} from '@aidooi/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { Guard } from '../components/Guard.tsx';
import { HoursEditor, type Hours } from '../components/HoursEditor.tsx';
import { useS } from '../i18n/index.tsx';
import { validateBody } from '../lib/forms.ts';
import { fieldErrorsOf, messageFor } from '../lib/problem.ts';

type Location = z.infer<typeof LocationSchema>;
const EMIRATES = [
  'Abu Dhabi',
  'Dubai',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah',
] as const;

interface Draft {
  name: string;
  address: string;
  emirate: (typeof EMIRATES)[number];
  lat: string;
  lng: string;
  hours: Hours;
  status: 'Active' | 'Inactive';
}
const blank = (): Draft => ({
  name: '',
  address: '',
  emirate: 'Dubai',
  lat: '',
  lng: '',
  hours: {},
  status: 'Active',
});
const toDraft = (l: Location): Draft => ({
  name: l.name,
  address: l.address,
  emirate: l.emirate,
  lat: l.lat === null ? '' : String(l.lat),
  lng: l.lng === null ? '' : String(l.lng),
  hours: l.openingHours as Hours,
  status: l.status,
});

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function ShowroomsScreen() {
  return (
    <Guard action="manageLocations">
      <ShowroomsBody />
    </Guard>
  );
}

function ShowroomsBody() {
  const s = useS();
  const api = useApi();
  const [editing, setEditing] = useState<Location | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['locations'],
    queryFn: () => unwrap(api.http.GET('/v1/seller/locations')),
  });
  const columns: Column<Location>[] = [
    { id: 'name', header: s.showroom, cell: (l) => <strong>{l.name}</strong> },
    { id: 'address', header: s.address, cell: (l) => `${l.address}, ${l.emirate}` },
    {
      id: 'status',
      header: s.status,
      cell: (l) => (
        <Badge tone={l.status === 'Active' ? 'ok' : 'neutral'}>
          {l.status === 'Active' ? s.statusActive : s.statusInactive}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: <span className="ui-visually-hidden">{s.actions}</span>,
      cell: (l) => (
        <Button onClick={() => setEditing(l)} aria-label={s.fmt('editOffer', { name: l.name })}>
          {s.edit}
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title={s.navShowrooms}
        description={s.showroomsIntro}
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            {s.addShowroom}
          </Button>
        }
      />
      <DataTable
        caption={s.navShowrooms}
        columns={columns}
        rows={q.data?.locations ?? []}
        rowKey={(l) => l.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        empty={<EmptyState title={s.noShowrooms} description={s.noShowroomsText} />}
      />
      <LocationEditor target={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function LocationEditor({
  target,
  onClose,
}: {
  target: Location | 'new' | null;
  onClose: () => void;
}) {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const queries = useQueryClient();
  const problemText = useProblemText();
  const [draft, setDraft] = useState<Draft>(blank);
  const [local, setLocal] = useState<Record<string, string>>({});
  useEffect(() => {
    if (target === null) return;
    setDraft(target === 'new' ? blank() : toDraft(target));
    setLocal({});
  }, [target]);

  const isNew = target === 'new';
  const save = useApiMutation(
    async (body: Record<string, unknown>) =>
      isNew
        ? unwrap(api.http.POST('/v1/seller/locations', { body: body as never }))
        : unwrap(
            api.http.PATCH('/v1/seller/locations/{id}', {
              params: { path: { id: (target as Location).id } },
              body: body as never,
            }),
          ),
    {
      onSuccess: async () => {
        toast.push({ message: s.showroomSaved, tone: 'ok' });
        await queries.invalidateQueries({ queryKey: ['locations'] });
        onClose();
      },
    },
  );
  const server = fieldErrorsOf(save.error);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = () => {
    const geo = draft.lat.trim() !== '' || draft.lng.trim() !== '';
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      address: draft.address.trim(),
      emirate: draft.emirate,
      openingHours: draft.hours,
      ...(geo
        ? { lat: Number(draft.lat), lng: Number(draft.lng) }
        : isNew
          ? {}
          : { lat: null, lng: null }),
      ...(isNew ? {} : { status: draft.status }),
    };
    const v = validateBody(isNew ? CreateLocationBodySchema : UpdateLocationBodySchema, body, s);
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
    <Drawer
      open={target !== null}
      onClose={onClose}
      title={isNew ? s.addShowroom : s.editShowroom}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {s.cancel}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {s.save}
          </Button>
        </>
      }
    >
      <FormErrorSummary errors={summary} />
      {save.error && server.length === 0 && (
        <p role="alert" className="portal-error">
          {problemText(save.error)}
        </p>
      )}
      <Field id="name" label={s.showroomName} required error={err('name')}>
        <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <Field id="address" label={s.address} required error={err('address')}>
        <Input value={draft.address} onChange={(e) => set('address', e.target.value)} />
      </Field>
      <Field id="emirate" label={s.emirate} required>
        <Select
          value={draft.emirate}
          onChange={(e) => set('emirate', e.target.value as Draft['emirate'])}
        >
          {EMIRATES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </Select>
      </Field>
      <div className="portal-row">
        <Field id="lat" label={s.latitude} error={err('lat')}>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={draft.lat}
            onChange={(e) => set('lat', e.target.value)}
          />
        </Field>
        <Field id="lng" label={s.longitude} error={err('lng')}>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={draft.lng}
            onChange={(e) => set('lng', e.target.value)}
          />
        </Field>
      </div>
      {!isNew && (
        <Field id="status" label={s.status} hint={s.showroomStatusHint}>
          <Select
            value={draft.status}
            onChange={(e) => set('status', e.target.value as Draft['status'])}
          >
            <option value="Active">{s.statusActive}</option>
            <option value="Inactive">{s.statusInactive}</option>
          </Select>
        </Field>
      )}
      <HoursEditor value={draft.hours} onChange={(h) => set('hours', h)} />
    </Drawer>
  );
}
