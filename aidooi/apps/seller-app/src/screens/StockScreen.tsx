import { useState } from 'react';
import { View } from 'react-native';
import { ApiProblem } from '@aidooi/api-client';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Field,
  ListRow,
  QuantityStepper,
  Screen,
  SegmentedControl,
  Text,
  useLocale,
  useT,
  useTheme,
  useToast,
} from '@aidooi/ui-native';
import { catalogue } from '../i18n/index.ts';
import {
  aedToFils,
  buildPatch,
  filsToAedText,
  interpretEditFailure,
  lowestAllowedStock,
  type OfferLike,
} from '../domain/stock.ts';
import { useOnline } from '../net/online.ts';
import { useAuth } from '../session/auth.tsx';
import { ConfirmSheet } from '../ui/ConfirmSheet.tsx';
import { messageFor } from '../ui/errors.ts';
import { OfflineBanner } from '../ui/OfflineBanner.tsx';
import { QueryState } from '../ui/Query.tsx';
import { useDebounced, useOffers, usePatchOffer } from './useOffers.ts';

type Offer = OfferLike & { productName: string; sku: string; availability: string };
const STATUSES = ['On Display', 'Viewable on Request', 'Not Viewable'] as const;

/** Find a product and fix its stock or display status in a few taps. Staff cannot touch price; managers can. */
export function StockScreen() {
  const t = useT(catalogue);
  const { locale } = useLocale();
  const { space } = useTheme();
  const toast = useToast();
  const online = useOnline();
  const { caps } = useAuth();
  const [search, setSearch] = useState('');
  const q = useOffers(useDebounced(search));
  const patch = usePatchOffer();
  const [editing, setEditing] = useState<Offer | null>(null);
  const [stock, setStock] = useState(0);
  const [viewing, setViewing] = useState<OfferLike['viewingStatus']>('On Display');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | undefined>();

  const items = (q.data?.pages.flatMap((p) => p.items) ?? []) as unknown as Offer[];

  const open = (o: Offer) => {
    setEditing(o);
    setStock(o.stockQty);
    setViewing(o.viewingStatus);
    setPrice(filsToAedText(o.sellingPrice));
    setError(undefined);
  };

  const save = async () => {
    if (!editing) return;
    const fils = caps.editPrice ? aedToFils(price) : undefined;
    const body = buildPatch(
      editing,
      { stockQty: stock, viewingStatus: viewing, ...(fils ? { sellingPrice: fils } : {}) },
      caps,
    );
    if (!body) return setEditing(null);
    try {
      await patch.mutateAsync({ id: editing.id, body });
      setEditing(null);
      toast.show({ message: t('stock.saved'), tone: 'ok' });
    } catch (e) {
      if (e instanceof ApiProblem) {
        const f = interpretEditFailure(e.code, e.message, editing);
        if (f.kind === 'held') {
          setError(t('stock.heldError', { n: f.held ?? lowestAllowedStock(editing) }));
          return;
        }
        if (f.kind === 'conflict') {
          // Someone else changed it: load the latest and make the user look again before saving.
          setEditing(null);
          await q.refetch();
          toast.show({ message: t('stock.conflict'), tone: 'warn' });
          return;
        }
      }
      setError(messageFor(e, locale));
    }
  };

  return (
    <Screen>
      <Text variant="h1">{t('stock.title')}</Text>
      <OfflineBanner />
      <Field
        label={t('stock.search')}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        returnKeyType="search"
      />
      <QueryState loading={q.isPending} error={q.error} onRetry={() => q.refetch()}>
        {items.length === 0 ? (
          <EmptyState title={t('stock.empty')} />
        ) : (
          <View>
            {items.map((o) => (
              <ListRow
                key={o.id}
                title={o.productName}
                subtitle={`${o.sku} · ${t('stock.qty')} ${o.stockQty}`}
                chevron
                onPress={() => open(o)}
                trailing={
                  <View style={{ alignItems: 'flex-end', gap: space[1] }}>
                    <Badge
                      label={t(`viewing.${o.viewingStatus}`)}
                      tone={o.viewingStatus === 'On Display' ? 'ok' : 'neutral'}
                    />
                    {o.reservedQty > 0 ? (
                      <Badge label={t('stock.reserved', { n: o.reservedQty })} tone="warn" />
                    ) : null}
                  </View>
                }
              />
            ))}
            {q.hasNextPage ? (
              <Button
                title={t('common.loadMore')}
                variant="secondary"
                loading={q.isFetchingNextPage}
                onPress={() => q.fetchNextPage()}
              />
            ) : null}
          </View>
        )}
      </QueryState>

      <ConfirmSheet
        visible={editing !== null}
        title={editing?.productName ?? ''}
        body={editing && editing.reservedQty > 0 ? t('stock.held', { n: editing.reservedQty }) : ''}
        confirmLabel={t('common.save')}
        disabled={!online || (caps.editPrice && aedToFils(price) === null)}
        onConfirm={save}
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <View style={{ gap: space[3] }}>
            <Text variant="label">{t('stock.qty')}</Text>
            <QuantityStepper
              value={stock}
              onChange={setStock}
              min={lowestAllowedStock(editing)}
              max={100000}
            />
            {editing.reservedQty > 0 ? (
              <Text variant="caption" tone="secondary">
                {t('stock.minHint', { n: lowestAllowedStock(editing) })}
              </Text>
            ) : null}
            <Text variant="label">{t('stock.viewing')}</Text>
            <SegmentedControl
              accessibilityLabel={t('stock.viewing')}
              options={STATUSES.map((s) => ({ value: s, label: t(`viewing.${s}`) }))}
              value={viewing}
              onChange={setViewing}
            />
            {caps.editPrice ? (
              <Field
                label={t('stock.price')}
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
              />
            ) : null}
            {error ? <Banner tone="error" message={error} /> : null}
          </View>
        ) : null}
      </ConfirmSheet>
    </Screen>
  );
}
