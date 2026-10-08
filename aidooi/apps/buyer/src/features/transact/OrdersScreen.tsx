import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconTile,
  Money,
  Screen,
  Text,
  useLocale,
  useTheme,
} from '@aidooi/ui-native';
import { ListSkeleton, PageHeader } from '../../components/index.tsx';
import { keyFor, useTx } from '../../i18n/useTx.ts';
import { GatedError, toneOf } from './parts.tsx';
import { useTransact } from './useTransact.ts';
import { formatDateTime } from './time.ts';

const MASTER_TONE = {
  Confirmed: 'info',
  'In Progress': 'info',
  'Issue Reported': 'warn',
  Completed: 'ok',
  Cancelled: 'error',
} as const;

/** The buyer's orders, newest first. One row per order, however many sellers fulfil it. */
export function OrdersScreen() {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const { locale } = useLocale();
  const tx = useTransact();
  const q = useInfiniteQuery({
    queryKey: ['orders'],
    queryFn: ({ pageParam }) => tx.listOrders(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const orders = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        <PageHeader title={t('orders.title')} />
        {q.isPending ? <ListSkeleton /> : null}
        {q.isError ? (
          <GatedError error={q.error} resumeHref="/(tabs)/orders" onRetry={() => q.refetch()} />
        ) : null}
        {q.isSuccess && orders.length === 0 ? (
          <EmptyState icon="bag" title={t('orders.empty')} message={t('orders.emptyHint')} />
        ) : null}
        {orders.map((o) => (
          <Card
            key={o.id}
            accessibilityLabel={`${t('orders.placed', { when: formatDateTime(o.placedAt, locale) })}, ${t('orders.items', { n: o.lines.length })}`}
            onPress={() => router.push(`/orders/${o.id}` as never)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}
          >
            <IconTile name="box" />
            <View style={{ flex: 1, gap: space[1] }}>
              <Text variant="body" style={{ fontWeight: '600' }}>
                {t('orders.placed', { when: formatDateTime(o.placedAt, locale) })}
              </Text>
              <Text variant="caption" tone="secondary">
                {t('orders.items', { n: o.lines.length })}
              </Text>
              <Badge
                label={t(keyFor('orderStatus', o.status))}
                tone={MASTER_TONE[o.status] ?? toneOf(o.status)}
              />
            </View>
            <Money fils={o.grossFils} />
          </Card>
        ))}
        {q.hasNextPage ? (
          <Button
            variant="secondary"
            title={t('orders.more')}
            loading={q.isFetchingNextPage}
            onPress={() => q.fetchNextPage()}
          />
        ) : null}
      </View>
    </Screen>
  );
}
