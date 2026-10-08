import { ApiProblem, unwrap } from '@aidooi/api-client';
import { UpdateOfferBodySchema, type OfferSchema } from '@aidooi/contracts';
import {
  Button,
  Checkbox,
  Drawer,
  ErrorState,
  Field,
  FormErrorSummary,
  Input,
  Money,
  Select,
  useApi,
  useApiMutation,
  useProblemText,
  useToast,
} from '@aidooi/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useS } from '../i18n/index.tsx';
import { dirhamsToFils, filsToDirhams, validateBody } from '../lib/forms.ts';
import { fieldErrorsOf, messageFor } from '../lib/problem.ts';
import { can, type Role } from '../lib/permissions.ts';
import type { z } from 'zod';

type Offer = z.infer<typeof OfferSchema>;

interface FormState {
  sku: string;
  sellingPrice: string;
  originalPrice: string;
  stockQty: string;
  availability: Offer['availability'];
  deliveryDays: string;
  viewingStatus: Offer['viewingStatus'];
  displayConfirmed: boolean;
  locationId: string;
  status: Offer['status'];
}

const toForm = (o: Offer): FormState => ({
  sku: o.sku,
  sellingPrice: filsToDirhams(o.sellingPrice),
  originalPrice: o.originalPrice === null ? '' : filsToDirhams(o.originalPrice),
  stockQty: String(o.stockQty),
  availability: o.availability,
  deliveryDays: String(o.deliveryDays),
  viewingStatus: o.viewingStatus,
  displayConfirmed: false,
  locationId: o.locationId,
  status: o.status,
});

/**
 * Edit one offer. Staff see and send only what they may change (stock and display); managers and owners
 * see everything. The offer's `version` goes back with every save: if someone else saved first the API
 * refuses, and this explains it and offers to reload rather than silently overwriting their change.
 */
export function OfferEditor({
  offerId,
  role,
  onClose,
}: {
  offerId: string | null;
  role: Role;
  onClose: () => void;
}) {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const queries = useQueryClient();
  const problemText = useProblemText();
  const manager = can(role, 'editPrice');

  const offer = useQuery({
    queryKey: ['offer', offerId],
    enabled: offerId !== null,
    gcTime: 0,
    queryFn: () =>
      unwrap(
        api.http.GET('/v1/seller/offers/{id}', { params: { path: { id: offerId as string } } }),
      ),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    enabled: offerId !== null && manager,
    queryFn: () => unwrap(api.http.GET('/v1/seller/locations')),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});
  useEffect(() => {
    if (offer.data) {
      setForm(toForm(offer.data));
      setLocal({});
    }
  }, [offer.data]);

  const save = useApiMutation(
    async (body: Record<string, unknown>) =>
      unwrap(
        api.http.PATCH('/v1/seller/offers/{id}', {
          params: { path: { id: offerId as string } },
          body: body as never,
        }),
      ),
    {
      onSuccess: async () => {
        toast.push({ message: s.offerSaved, tone: 'ok' });
        await queries.invalidateQueries({ queryKey: ['offers'] });
        onClose();
      },
    },
  );

  const o = offer.data;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const submit = () => {
    if (!o || !form) return;
    const errs: Record<string, string> = {};
    const patch: Record<string, unknown> = { expectedVersion: o.version };
    const stock = Number(form.stockQty);
    if (!Number.isInteger(stock) || stock < 0) errs['stockQty'] = s.vInvalid;
    else if (stock !== o.stockQty) patch['stockQty'] = stock;
    if (form.availability !== o.availability) patch['availability'] = form.availability;
    if (form.viewingStatus !== o.viewingStatus) patch['viewingStatus'] = form.viewingStatus;
    if (form.displayConfirmed) patch['displayConfirmed'] = true;
    if (manager) {
      const price = dirhamsToFils(form.sellingPrice);
      if (price === null || price <= 0) errs['sellingPrice'] = s.vInvalid;
      else if (price !== o.sellingPrice) patch['sellingPrice'] = price;
      const orig = form.originalPrice.trim() === '' ? null : dirhamsToFils(form.originalPrice);
      if (form.originalPrice.trim() !== '' && (orig === null || orig <= 0))
        errs['originalPrice'] = s.vInvalid;
      else if (orig !== o.originalPrice) patch['originalPrice'] = orig;
      const days = Number(form.deliveryDays);
      if (!Number.isInteger(days) || days < 0 || days > 120) errs['deliveryDays'] = s.vInvalid;
      else if (days !== o.deliveryDays) patch['deliveryDays'] = days;
      if (form.sku !== o.sku) patch['sku'] = form.sku.trim();
      if (form.locationId !== o.locationId) patch['locationId'] = form.locationId;
      if (form.status !== o.status) patch['status'] = form.status;
    }
    setLocal(errs);
    if (Object.keys(errs).length > 0) return;
    if (Object.keys(patch).length === 1) {
      onClose();
      return;
    }
    const checked = validateBody(UpdateOfferBodySchema, patch, s);
    if (!checked.ok) return setLocal(checked.errors);
    save.mutate(patch);
  };

  const err = save.error;
  const conflict = err instanceof ApiProblem && err.code === 'offer_version_conflict';
  const server = fieldErrorsOf(err);
  const summary = [
    ...Object.entries(local).map(([path, message]) => ({ path, message })),
    ...server,
  ];
  const fieldError = (p: string) => local[p] ?? messageFor(server, p);

  return (
    <Drawer
      open={offerId !== null}
      onClose={onClose}
      title={o ? o.productName : s.offerEdit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {s.cancel}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!o || conflict}
            onClick={submit}
          >
            {s.save}
          </Button>
        </>
      }
    >
      {offer.isPending && offerId !== null && <p>{s.loading}</p>}
      {offer.isError && <ErrorState error={offer.error} onRetry={() => void offer.refetch()} />}
      {o && form && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          {conflict ? (
            <div role="alert" className="portal-conflict">
              <p>{s.offerConflict}</p>
              <Button
                onClick={() => {
                  save.reset();
                  void offer.refetch();
                }}
              >
                {s.offerReload}
              </Button>
            </div>
          ) : err ? (
            <p role="alert" className="portal-error">
              {problemText(err)}
            </p>
          ) : null}
          <FormErrorSummary errors={conflict ? [] : summary} />
          {!manager && <p className="portal-note">{s.staffLimit}</p>}
          {manager && (
            <>
              <Field id="sku" label={s.sku} error={fieldError('sku')}>
                <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} />
              </Field>
              <Field
                id="sellingPrice"
                label={s.sellingPrice}
                hint={s.priceHint}
                error={fieldError('sellingPrice')}
              >
                <Input
                  inputMode="decimal"
                  value={form.sellingPrice}
                  onChange={(e) => set('sellingPrice', e.target.value)}
                />
              </Field>
              <Field
                id="originalPrice"
                label={s.originalPrice}
                hint={s.originalPriceHint}
                error={fieldError('originalPrice')}
              >
                <Input
                  inputMode="decimal"
                  value={form.originalPrice}
                  onChange={(e) => set('originalPrice', e.target.value)}
                />
              </Field>
              <Field id="deliveryDays" label={s.deliveryDays} error={fieldError('deliveryDays')}>
                <Input
                  inputMode="numeric"
                  value={form.deliveryDays}
                  onChange={(e) => set('deliveryDays', e.target.value)}
                />
              </Field>
            </>
          )}
          <Field
            id="stockQty"
            label={s.stockQty}
            hint={s.fmt('stockHint', { reserved: o.reservedQty })}
            error={fieldError('stockQty')}
          >
            <Input
              inputMode="numeric"
              value={form.stockQty}
              onChange={(e) => set('stockQty', e.target.value)}
            />
          </Field>
          <Field id="availability" label={s.availability} hint={s.availabilityHint}>
            <Select
              value={form.availability}
              onChange={(e) => set('availability', e.target.value as Offer['availability'])}
            >
              {(['In Stock', 'Low Stock', 'Out of Stock'] as const).map((a) => (
                <option key={a} value={a}>
                  {s.availabilityLabels[a]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="viewingStatus" label={s.viewingStatus}>
            <Select
              value={form.viewingStatus}
              onChange={(e) => set('viewingStatus', e.target.value as Offer['viewingStatus'])}
            >
              {(['On Display', 'Viewable on Request', 'Not Viewable'] as const).map((v) => (
                <option key={v} value={v}>
                  {s.viewingLabels[v]}
                </option>
              ))}
            </Select>
          </Field>
          {form.viewingStatus === 'On Display' && (
            <Checkbox
              label={s.displayConfirm}
              checked={form.displayConfirmed}
              onChange={(e) => set('displayConfirmed', e.target.checked)}
            />
          )}
          {manager && (
            <>
              <Field id="locationId" label={s.showroom}>
                <Select value={form.locationId} onChange={(e) => set('locationId', e.target.value)}>
                  {(locations.data?.locations ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                  {!locations.data?.locations.some((l) => l.id === form.locationId) && (
                    <option value={form.locationId}>{form.locationId.slice(0, 8)}</option>
                  )}
                </Select>
              </Field>
              <Field id="status" label={s.status}>
                <Select
                  value={form.status}
                  onChange={(e) => set('status', e.target.value as Offer['status'])}
                >
                  <option value="Active">{s.statusActive}</option>
                  <option value="Inactive">{s.statusInactive}</option>
                </Select>
              </Field>
            </>
          )}
          <p className="portal-note">
            {s.currentPrice}: <Money fils={o.sellingPrice} />
          </p>
        </form>
      )}
    </Drawer>
  );
}
