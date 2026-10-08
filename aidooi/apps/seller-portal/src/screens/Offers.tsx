import { unwrap } from '@aidooi/api-client';
import {
  Badge,
  Button,
  CursorPagination,
  DataTable,
  FilterBar,
  Field,
  Input,
  Money,
  PageHeader,
  Select,
  StatusPill,
  useApi,
  type Column,
} from '@aidooi/ui-web';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { z } from 'zod';
import type { OfferSchema } from '@aidooi/contracts';
import { OfferEditor } from '../components/OfferEditor.tsx';
import { AVAILABILITY_TONE, labelled } from '../components/pills.ts';
import { useS } from '../i18n/index.tsx';
import { useMe } from '../lib/me.tsx';
import { usePaged } from '../lib/paged.ts';
import { can } from '../lib/permissions.ts';

type Offer = z.infer<typeof OfferSchema>;
type Filters = {
  q: string;
  status: '' | 'Active' | 'Inactive';
  availability: '' | Offer['availability'];
};
const NONE: Filters = { q: '', status: '', availability: '' };

export function OffersScreen() {
  const s = useS();
  const api = useApi();
  const me = useMe();
  const role = me.data?.role;
  const [draft, setDraft] = useState<Filters>(NONE);
  const [applied, setApplied] = useState<Filters>(NONE);
  const [editing, setEditing] = useState<string | null>(null);

  const { pager, query } = usePaged<Offer>(['offers', applied], (cursor) =>
    unwrap(
      api.http.GET('/v1/seller/offers', {
        params: {
          query: {
            limit: 25,
            ...(cursor ? { cursor } : {}),
            ...(applied.q ? { q: applied.q } : {}),
            ...(applied.status ? { status: applied.status } : {}),
            ...(applied.availability ? { availability: applied.availability } : {}),
          },
        },
      }),
    ),
  );

  const columns: Column<Offer>[] = [
    {
      id: 'product',
      header: s.product,
      cell: (o) => (
        <>
          <strong>{o.productName}</strong>
          <br />
          <small>
            {o.productType} · <bdi>{o.sku}</bdi>
          </small>
        </>
      ),
    },
    {
      id: 'price',
      header: s.sellingPrice,
      numeric: true,
      cell: (o) => <Money fils={o.sellingPrice} />,
    },
    {
      id: 'stock',
      header: s.stockQty,
      numeric: true,
      cell: (o) => (
        <>
          {o.stockQty}
          {o.reservedQty > 0 && <small> ({s.fmt('reservedShort', { n: o.reservedQty })})</small>}
        </>
      ),
    },
    {
      id: 'availability',
      header: s.availability,
      cell: (o) => (
        <StatusPill
          status={s.availabilityLabels[o.availability]}
          map={labelled(s.availabilityLabels, AVAILABILITY_TONE)}
        />
      ),
    },
    { id: 'viewing', header: s.viewingStatus, cell: (o) => s.viewingLabels[o.viewingStatus] },
    {
      id: 'live',
      header: s.live,
      cell: (o) =>
        o.live ? <Badge tone="ok">{s.liveYes}</Badge> : <Badge tone="warn">{s.liveNo}</Badge>,
    },
    {
      id: 'actions',
      header: <span className="ui-visually-hidden">{s.actions}</span>,
      cell: (o) => (
        <Button
          onClick={() => setEditing(o.id)}
          aria-label={s.fmt('editOffer', { name: o.productName })}
        >
          {s.edit}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={s.navOffers}
        description={s.offersIntro}
        actions={
          can(role, 'createOffer') ? (
            <Link to="/offers/new" className="ui-btn ui-btn--primary">
              {s.newOffer}
            </Link>
          ) : undefined
        }
      />
      <FilterBar
        onSubmit={() => {
          pager.reset();
          setApplied(draft);
        }}
        onClear={() => {
          pager.reset();
          setDraft(NONE);
          setApplied(NONE);
        }}
      >
        <Field label={s.search}>
          <Input value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        </Field>
        <Field label={s.status}>
          <Select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as Filters['status'] })}
          >
            <option value="">{s.any}</option>
            <option value="Active">{s.statusActive}</option>
            <option value="Inactive">{s.statusInactive}</option>
          </Select>
        </Field>
        <Field label={s.availability}>
          <Select
            value={draft.availability}
            onChange={(e) =>
              setDraft({ ...draft, availability: e.target.value as Filters['availability'] })
            }
          >
            <option value="">{s.any}</option>
            {(['In Stock', 'Low Stock', 'Out of Stock'] as const).map((a) => (
              <option key={a} value={a}>
                {s.availabilityLabels[a]}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <DataTable
        caption={s.navOffers}
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(o) => o.id}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
      <CursorPagination
        page={pager.page}
        hasPrevious={pager.hasPrevious}
        nextCursor={query.data?.nextCursor}
        onNext={pager.next}
        onPrevious={pager.previous}
        busy={query.isFetching}
      />
      {role && <OfferEditor offerId={editing} role={role} onClose={() => setEditing(null)} />}
    </>
  );
}
