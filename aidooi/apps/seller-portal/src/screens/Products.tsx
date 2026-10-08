import { unwrap } from '@aidooi/api-client';
import type { SellerProductSchema } from '@aidooi/contracts';
import {
  Button,
  DataTable,
  Drawer,
  EmptyState,
  FormErrorSummary,
  PageHeader,
  StatusPill,
  useApi,
  useApiMutation,
  useProblemText,
  useToast,
  type Column,
} from '@aidooi/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { Guard } from '../components/Guard.tsx';
import { PhotoUpload } from '../components/PhotoUpload.tsx';
import {
  ProductForm,
  attributeOf,
  draftToBody,
  emptyDraft,
  type ProductDraft,
} from '../components/ProductForm.tsx';
import { DATA_TONE, labelled } from '../components/pills.ts';
import { useS } from '../i18n/index.tsx';
import { fieldErrorsOf, messageFor } from '../lib/problem.ts';

type Product = z.infer<typeof SellerProductSchema>;

const draftOf = (p: Product): ProductDraft => {
  const attr = attributeOf(p.type);
  const raw = attr ? p.attributes[attr.key] : undefined;
  return {
    ...emptyDraft(),
    name: p.name,
    type: p.type,
    widthCm: p.widthCm?.toString() ?? '',
    depthCm: p.depthCm?.toString() ?? '',
    heightCm: p.heightCm?.toString() ?? '',
    primaryColour: p.primaryColour ?? '',
    primaryStyle: p.primaryStyle ?? '',
    material: p.material ?? '',
    attribute: raw === undefined ? '' : String(raw),
  };
};

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function ProductsScreen() {
  return (
    <Guard action="submitProduct">
      <ProductsBody />
    </Guard>
  );
}

function ProductsBody() {
  const s = useS();
  const api = useApi();
  const [editing, setEditing] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['products'],
    queryFn: () => unwrap(api.http.GET('/v1/seller/products')),
  });
  const rows = q.data?.products ?? [];
  const columns: Column<Product>[] = [
    {
      id: 'name',
      header: s.product,
      cell: (p) => (
        <>
          <strong>{p.name || s.untitled}</strong>
          <br />
          <small>
            {p.type || '—'} · <bdi>{p.id}</bdi>
          </small>
        </>
      ),
    },
    {
      id: 'status',
      header: s.status,
      cell: (p) => (
        <StatusPill
          status={s.dataStatusLabels[p.dataStatus]}
          map={labelled(s.dataStatusLabels, DATA_TONE)}
        />
      ),
    },
    {
      id: 'missing',
      header: s.missing,
      cell: (p) =>
        p.missing.length ? p.missing.join(', ') : <span aria-label={s.nothingMissing}>—</span>,
    },
    { id: 'photos', header: s.photos, numeric: true, cell: (p) => p.media.length },
    {
      id: 'actions',
      header: <span className="ui-visually-hidden">{s.actions}</span>,
      cell: (p) => (
        <Button
          onClick={() => setEditing(p.id)}
          aria-label={s.fmt('editOffer', { name: p.name || p.id })}
        >
          {s.edit}
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title={s.navProducts}
        description={s.productsIntro}
        actions={
          <Link to="/offers/new" className="ui-btn ui-btn--primary">
            {s.newProduct}
          </Link>
        }
      />
      <DataTable
        caption={s.navProducts}
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        empty={<EmptyState title={s.noProducts} description={s.noProductsText} />}
      />
      <ProductEditor
        product={rows.find((p) => p.id === editing) ?? null}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function ProductEditor({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const queries = useQueryClient();
  const problemText = useProblemText();
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  useEffect(() => {
    if (product) setDraft(draftOf(product));
  }, [product?.id]); // reset only when a different product opens

  const save = useApiMutation(
    async (body: Record<string, unknown>) =>
      unwrap(
        api.http.PATCH('/v1/seller/products/{id}', {
          params: { path: { id: product?.id as string } },
          body: body as never,
        }),
      ),
    {
      onSuccess: async (p) => {
        toast.push({
          message: p.dataStatus === 'Verified' ? s.productSaved : s.productSavedForReview,
          tone: 'ok',
        });
        await queries.invalidateQueries({ queryKey: ['products'] });
        onClose();
      },
    },
  );
  const server = fieldErrorsOf(save.error);
  return (
    <Drawer
      open={product !== null}
      onClose={onClose}
      title={product?.name || s.untitled}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {s.cancel}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              const body = draftToBody(draft, { partial: true });
              // Send only what changed: the API returns a verified product to review for identity edits.
              const original = product ? draftToBody(draftOf(product), { partial: true }) : {};
              const changed = Object.fromEntries(
                Object.entries(body).filter(
                  ([k, v]) => JSON.stringify(v) !== JSON.stringify(original[k]),
                ),
              );
              if (Object.keys(changed).length === 0) return onClose();
              save.mutate(changed);
            }}
          >
            {s.save}
          </Button>
        </>
      }
    >
      {product && (
        <>
          {product.dataStatus === 'Verified' && (
            <p className="portal-note">{s.verifiedEditWarning}</p>
          )}
          <FormErrorSummary errors={server} />
          {save.error && server.length === 0 && (
            <p role="alert" className="portal-error">
              {problemText(save.error)}
            </p>
          )}
          <ProductForm value={draft} onChange={setDraft} errors={(p) => messageFor(server, p)} />
          <PhotoUpload
            productId={product.id}
            taken={product.media.map((m) => m.position)}
            altText={product.name}
          />
        </>
      )}
    </Drawer>
  );
}
