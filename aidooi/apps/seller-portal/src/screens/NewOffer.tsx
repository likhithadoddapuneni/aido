import { ApiProblem, unwrap } from '@aidooi/api-client';
import { CreateOfferBodySchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  ErrorState,
  Field,
  FormErrorSummary,
  Input,
  PageHeader,
  Select,
  Tabs,
  useApi,
  useApiMutation,
  useProblemText,
  useToast,
} from '@aidooi/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Guard } from '../components/Guard.tsx';
import {
  ProductForm,
  draftToBody,
  emptyDraft,
  type ProductDraft,
} from '../components/ProductForm.tsx';
import { useS } from '../i18n/index.tsx';
import { dirhamsToFils, validateBody } from '../lib/forms.ts';
import { fieldErrorsOf, messageFor } from '../lib/problem.ts';

const AID = /^AID-\d{8}$/;

export function NewOfferScreen() {
  const s = useS();
  return (
    <Guard action="createOffer">
      <PageHeader title={s.newOffer} description={s.newOfferIntro} />
      <NewOfferForm />
    </Guard>
  );
}

function NewOfferForm() {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const problemText = useProblemText();

  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [productId, setProductId] = useState('');
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('1');
  const [days, setDays] = useState('7');
  const [viewing, setViewing] = useState('Viewable on Request');
  const [locationId, setLocationId] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});

  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => unwrap(api.http.GET('/v1/seller/locations')),
  });
  const wanted = mode === 'existing' && AID.test(productId.trim()) ? productId.trim() : null;
  const found = useQuery({
    queryKey: ['product-card', wanted],
    enabled: wanted !== null,
    retry: false,
    queryFn: () =>
      unwrap(api.http.GET('/v1/products/{id}', { params: { path: { id: wanted as string } } })),
  });

  const create = useApiMutation(
    async (body: Record<string, unknown>) =>
      unwrap(api.http.POST('/v1/seller/offers', { body: body as never })),
    {
      onSuccess: async (r) => {
        toast.push({
          message: r.product.dataStatus === 'Verified' ? s.offerCreated : s.offerCreatedForReview,
          tone: 'ok',
        });
        await queries.invalidateQueries({ queryKey: ['offers'] });
        void navigate({ to: '/offers' });
      },
    },
  );

  const submit = () => {
    const errs: Record<string, string> = {};
    const priceFils = dirhamsToFils(price);
    if (!sku.trim()) errs['sku'] = s.vRequired;
    if (priceFils === null || priceFils <= 0) errs['sellingPrice'] = s.vInvalid;
    const stockN = Number(stock);
    if (!Number.isInteger(stockN) || stockN < 0) errs['stockQty'] = s.vInvalid;
    const daysN = Number(days);
    if (!Number.isInteger(daysN) || daysN < 0 || daysN > 120) errs['deliveryDays'] = s.vInvalid;
    if (!locationId) errs['locationId'] = s.vRequired;
    if (mode === 'existing' && !wanted) errs['productId'] = s.productIdInvalid;
    setLocal(errs);
    if (Object.keys(errs).length > 0) return;
    const body = {
      ...(mode === 'existing' ? { productId: wanted } : { newProduct: draftToBody(draft) }),
      sku: sku.trim(),
      sellingPrice: priceFils,
      stockQty: stockN,
      deliveryDays: daysN,
      viewingStatus: viewing,
      locationId,
    };
    // The same contract the server enforces: whatever the hand-parsing above could not express.
    const checked = validateBody(CreateOfferBodySchema, body, s);
    if (!checked.ok) return setLocal(checked.errors);
    create.mutate(body);
  };

  const server = fieldErrorsOf(create.error);
  const summary = [
    ...Object.entries(local).map(([path, message]) => ({ path, message })),
    ...server,
  ];
  const err = (p: string) => local[p] ?? messageFor(server, p);
  const generic = create.error && server.length === 0 ? create.error : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <FormErrorSummary errors={summary} />
      {generic && (
        <p role="alert" className="portal-error">
          {problemText(generic)}
        </p>
      )}
      <Card title={s.whichProduct}>
        <Tabs
          label={s.whichProduct}
          value={mode}
          onChange={(id) => setMode(id as 'existing' | 'new')}
          tabs={[
            {
              id: 'existing',
              label: s.existingProduct,
              panel: (
                <>
                  <Field
                    id="productId"
                    label={s.productId}
                    hint={s.productIdHint}
                    error={err('productId')}
                  >
                    <Input
                      value={productId}
                      onChange={(e) => setProductId(e.target.value)}
                      placeholder="AID-00000000"
                      dir="ltr"
                    />
                  </Field>
                  {found.isPending && wanted && <p>{s.loading}</p>}
                  {found.isError &&
                    (found.error instanceof ApiProblem && found.error.code === 'not_found' ? (
                      <p role="alert" className="portal-error">
                        {s.productNotFound}
                      </p>
                    ) : (
                      <ErrorState error={found.error} />
                    ))}
                  {found.data && (
                    <p className="portal-note">
                      {s.fmt('productFound', {
                        name: found.data.product.name,
                        type: found.data.product.type,
                      })}
                    </p>
                  )}
                </>
              ),
            },
            {
              id: 'new',
              label: s.newProduct,
              panel: (
                <>
                  <p className="portal-note">{s.newProductNote}</p>
                  <ProductForm
                    value={draft}
                    onChange={setDraft}
                    errors={err}
                    prefix="newProduct."
                  />
                </>
              ),
            },
          ]}
        />
      </Card>
      <Card title={s.yourOffer}>
        <Field id="sku" label={s.sku} required error={err('sku')}>
          <Input value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <div className="portal-row">
          <Field
            id="sellingPrice"
            label={s.sellingPrice}
            hint={s.priceHint}
            required
            error={err('sellingPrice')}
          >
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field id="stockQty" label={s.stockQty} required error={err('stockQty')}>
            <Input inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
          </Field>
          <Field id="deliveryDays" label={s.deliveryDays} required error={err('deliveryDays')}>
            <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        <Field id="viewingStatus" label={s.viewingStatus}>
          <Select value={viewing} onChange={(e) => setViewing(e.target.value)}>
            {(['On Display', 'Viewable on Request', 'Not Viewable'] as const).map((v) => (
              <option key={v} value={v}>
                {s.viewingLabels[v]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="locationId" label={s.showroom} required error={err('locationId')}>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{s.choose}</option>
            {(locations.data?.locations ?? [])
              .filter((l) => l.status === 'Active')
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </Select>
        </Field>
      </Card>
      <Button type="submit" variant="primary" loading={create.isPending}>
        {mode === 'existing' ? s.createOffer : s.submitForReview}
      </Button>
    </form>
  );
}
