import { useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Banner,
  BottomSheet,
  Button,
  Card,
  ConceptPlan,
  ErrorView,
  Icon,
  Money,
  ProductArt,
  Screen,
  ScoreRing,
  StickyBar,
  Text,
  useLocale,
  useTheme,
} from '@aidooi/ui-native';
import type { Composition } from '@aidooi/contracts';
import { PRODUCT_TYPE_AR } from '../../projects/productTypes.ts';
import { ListSkeleton, PageHeader, QueryBoundary, SectionTitle } from '../../components/index.tsx';
import { keyFor, useTx, type Tx } from '../../i18n/useTx.ts';
import { useServices } from '../../providers/AppProviders.tsx';

type Item = Composition['items'][number];

/**
 * The room: a measured concept plan drawn from verified product dimensions (labelled "Concept"),
 * every product tappable. Totals, scores and staleness come from the server; nothing is computed here.
 */
export function CompositionScreen({
  compositionId,
  projectId,
}: {
  compositionId: string;
  projectId?: string | undefined;
}) {
  const t = useTx();
  const router = useRouter();
  const qc = useQueryClient();
  const { space } = useTheme();
  const { services } = useServices();
  const [selected, setSelected] = useState<string | null>(null);
  const comp = useQuery({
    queryKey: ['composition', compositionId],
    queryFn: () => services.getComposition(compositionId),
  });

  const goBuy = (id: string) =>
    router.push({ pathname: '/checkout/start', params: { compositionId: id } } as never);
  const goView = (id: string) =>
    router.push({ pathname: '/viewing/new', params: { compositionId: id } } as never);

  return (
    <Screen
      footer={
        comp.data ? (
          <StickyBar>
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Button
                title={t('composition.viewInStore')}
                variant="secondary"
                icon="calendar"
                style={{ flex: 1 }}
                onPress={() => goView(compositionId)}
              />
              <Button
                title={t('composition.buy')}
                icon="bag"
                style={{ flex: 1 }}
                onPress={() => goBuy(compositionId)}
              />
            </View>
          </StickyBar>
        ) : undefined
      }
    >
      <QueryBoundary query={comp} skeleton={<ListSkeleton />}>
        {(c) => (
          <View style={{ gap: space[3] }}>
            <PageHeader
              title={t(keyFor('objective', c.objective))}
              subtitle={t(keyFor('objectiveBlurb', c.objective))}
              onBack={() => router.back()}
            />
            <Card tone="ink" style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              <View style={{ flex: 1, gap: space[1] }}>
                <Text variant="caption" tone="inverseMuted">
                  {t('composition.total')}
                </Text>
                <Money fils={c.total} tone="inverse" large />
              </View>
              {c.score !== null ? (
                <ScoreRing
                  tone="inverse"
                  score={c.score}
                  size={60}
                  accessibilityLabel={t('options.score', { score: c.score })}
                />
              ) : null}
            </Card>
            {c.stale ? (
              <Banner
                tone="warn"
                title={t('composition.staleTitle')}
                message={t('composition.stale')}
                action={{
                  label: t('options.refresh'),
                  onPress: () => {
                    if (projectId) {
                      qc.removeQueries({ queryKey: ['recommend', projectId] });
                      router.replace(`/project/${projectId}/options` as never);
                    } else router.back();
                  },
                }}
              />
            ) : null}
            <Plan c={c} selected={selected} onSelect={setSelected} t={t} />
            <SectionTitle>{t('composition.pieces')}</SectionTitle>
            {c.items.map((i) => (
              <Card
                key={i.slotKey}
                onPress={() => setSelected(i.slotKey)}
                accessibilityLabel={`${i.product.name}, ${t(keyFor('productType', i.product.type))} ×${i.quantity}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space[3],
                  padding: space[2],
                }}
              >
                <ProductArt product={i.product} size={76} decorative />
                <View style={{ flex: 1, gap: space[1] }}>
                  <Text variant="body" numberOfLines={2} style={{ fontWeight: '600' }}>
                    {i.product.name}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {`${t(keyFor('productType', i.product.type))} · ×${i.quantity}`}
                  </Text>
                  {i.stale ? (
                    <Badge label={t(keyFor('stale', i.stale))} tone="warn" />
                  ) : (
                    <Money fils={i.lineTotal} />
                  )}
                </View>
                <Icon name="chevron" size={20} tone="secondary" />
              </Card>
            ))}
            <ProductSheet
              composition={c}
              item={c.items.find((i) => i.slotKey === selected) ?? null}
              onClose={() => setSelected(null)}
              onReplace={(slot) => {
                setSelected(null);
                router.push({
                  pathname: '/composition/[id]/item/[slot]',
                  params: { id: compositionId, slot },
                } as never);
              }}
            />
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

function Plan({
  c,
  selected,
  onSelect,
  t,
}: {
  c: Composition;
  selected: string | null;
  onSelect: (k: string) => void;
  t: Tx;
}) {
  const { space } = useTheme();
  const planWidth = Math.max(0, useWindowDimensions().width - space[3] * 4 - 2);
  const items = useMemo(
    () =>
      c.items.map((i) => ({
        id: i.slotKey,
        label: i.product.name,
        widthCm: i.product.widthCm,
        depthCm: i.product.depthCm,
        type: i.product.type,
        colour: i.product.primaryColour,
        material: i.product.material,
        underlay: i.product.type === 'Rug',
      })),
    [c.items],
  );
  if (!c.room) return <Banner tone="info" message={t('composition.noPlan')} />;
  return (
    <Card tone="soft">
      <ConceptPlan
        roomWidthCm={c.room.widthCm}
        roomDepthCm={c.room.depthCm}
        items={items}
        selectedId={selected}
        onSelect={onSelect}
        width={planWidth}
      />
    </Card>
  );
}

/** Product Card: the product, why it was chosen, and the live offers with seller terms (AID-DATA-015). */
function ProductSheet({
  composition,
  item,
  onClose,
  onReplace,
}: {
  composition: Composition;
  item: Item | null;
  onClose: () => void;
  onReplace: (slotKey: string) => void;
}) {
  const t = useTx();
  const qc = useQueryClient();
  const { space } = useTheme();
  const { locale } = useLocale();
  const { services } = useServices();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const card = useQuery({
    queryKey: ['product-card', item?.product.id],
    queryFn: () => services.productCard((item as Item).product.id),
    enabled: item !== null,
  });
  const remove = useMutation({
    mutationFn: () => services.removeItem(composition.id, (item as Item).slotKey),
    onSuccess: (updated) => {
      qc.setQueryData(['composition', composition.id], updated);
      setConfirmRemove(false);
      onClose();
    },
  });
  const typeName = item
    ? locale === 'ar'
      ? (PRODUCT_TYPE_AR[item.product.type] ?? item.product.type)
      : item.product.type
    : '';

  return (
    <BottomSheet
      visible={item !== null}
      onClose={() => (setConfirmRemove(false), onClose())}
      title={item?.product.name ?? ''}
    >
      {item ? (
        <View style={{ gap: space[3] }}>
          <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
            <ProductArt product={item.product} size={120} />
            <View style={{ flex: 1, gap: space[2] }}>
              {item.match ? (
                <ScoreRing
                  score={item.match.score}
                  accessibilityLabel={t('options.score', { score: item.match.score })}
                />
              ) : null}
              <Money fils={item.lineTotal} />
            </View>
          </View>
          <Text tone="secondary">
            {typeName} ·{' '}
            {t('card.dims', {
              w: item.product.widthCm,
              d: item.product.depthCm,
              h: item.product.heightCm,
            })}
          </Text>
          <Text>
            {t(keyFor('colour', item.product.primaryColour))} ·{' '}
            {t(keyFor('style', item.product.primaryStyle))} · {item.product.material}
          </Text>
          {item.match ? (
            <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
              <Badge label={t('options.score', { score: item.match.score })} tone="info" />
              <Badge label={t('card.fit', { fit: item.match.fit })} />
            </View>
          ) : null}
          {item.stale ? <Banner tone="warn" message={t(keyFor('stale', item.stale))} /> : null}
          <Text variant="h3">{t('card.offers')}</Text>
          {card.isPending ? <ListSkeleton rows={1} /> : null}
          {card.isError ? <ErrorView error={card.error} onRetry={() => card.refetch()} /> : null}
          {card.data?.offers.map((o) => (
            <Card
              key={o.id}
              tone="soft"
              style={{ gap: space[2] }}
              accessible
              accessibilityLabel={`${o.partner.tradeName}`}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text variant="body" style={{ fontWeight: '600' }}>
                  {o.partner.tradeName}
                </Text>
                <Money fils={o.sellingPrice} originalFils={o.originalPrice} />
              </View>
              <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
                <Badge
                  label={t(keyFor('viewing', o.viewingStatus))}
                  tone={o.viewingStatus === 'On Display' ? 'ok' : 'neutral'}
                />
                <Badge
                  label={t(keyFor('availability', o.availability))}
                  tone={o.availability === 'Low Stock' ? 'warn' : 'ok'}
                />
                <Badge label={t('card.delivery', { days: o.deliveryDays })} />
              </View>
              <Text variant="caption" tone="secondary" onSurface>
                {o.location.name} · {o.location.emirate}
              </Text>
              {o.partner.afterSalesTerms ? (
                <Text variant="caption" tone="secondary" onSurface>
                  {t('card.afterSales')}: {o.partner.afterSalesTerms}
                </Text>
              ) : null}
            </Card>
          ))}
          {remove.isError ? <ErrorView error={remove.error} /> : null}
          <Button
            title={t('card.replace')}
            variant="secondary"
            onPress={() => onReplace(item.slotKey)}
          />
          {item.essential ? (
            <Text variant="caption" tone="secondary">
              {t('card.essential')}
            </Text>
          ) : confirmRemove ? (
            <Button
              title={t('card.confirmRemove')}
              variant="destructive"
              loading={remove.isPending}
              onPress={() => remove.mutateAsync().catch(() => undefined)}
            />
          ) : (
            <Button
              title={t('card.remove')}
              variant="ghost"
              onPress={() => setConfirmRemove(true)}
            />
          )}
        </View>
      ) : null}
    </BottomSheet>
  );
}
