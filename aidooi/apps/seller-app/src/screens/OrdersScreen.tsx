import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  ListRow,
  Screen,
  Text,
  useT,
  useTheme,
} from '@aidooi/ui-native';
import { catalogue } from '../i18n/index.ts';
import type { LineState } from '../data/seller.ts';
import { OfflineBanner } from '../ui/OfflineBanner.tsx';
import { QueryState } from '../ui/Query.tsx';
import { useLines, type LineFilter } from './useLines.ts';

const FILTERS: readonly LineFilter[] = [
  'active',
  'Confirmed',
  'Preparing',
  'Ready for Dispatch',
  'Dispatched',
  'Delivered',
];

export function OrdersScreen() {
  const t = useT(catalogue);
  const { space } = useTheme();
  const router = useRouter();
  const [filter, setFilter] = useState<LineFilter>('active');
  const q = useLines(filter);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <Text variant="h1">{t('orders.title')}</Text>
      <OfflineBanner />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space[2] }}
      >
        {FILTERS.map((f) => (
          <Chip
            key={f}
            label={f === 'active' ? t('orders.filter.all') : (f as LineState)}
            selected={filter === f}
            onPress={() => setFilter(f)}
          />
        ))}
      </ScrollView>
      <Button title={t('issues.title')} variant="ghost" onPress={() => router.push('/issues')} />
      <QueryState loading={q.isPending} error={q.error} onRetry={() => q.refetch()}>
        {items.length === 0 ? (
          <EmptyState title={t('orders.empty.title')} message={t('orders.empty.message')} />
        ) : (
          <View>
            {items.map((l) => (
              <ListRow
                key={l.id}
                title={l.productName}
                subtitle={`${t('orders.qty', { n: l.quantity })}${l.delivery ? ` · ${l.delivery.emirate}` : ''}`}
                chevron
                onPress={() => router.push(`/line/${l.id}`)}
                trailing={
                  <View style={{ alignItems: 'flex-end', gap: space[1] }}>
                    <Badge label={l.state} tone="info" />
                    {l.openIssues > 0 ? (
                      <Badge label={t('orders.issues', { n: l.openIssues })} tone="warn" />
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
    </Screen>
  );
}
