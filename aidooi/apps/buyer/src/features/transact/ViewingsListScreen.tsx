import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, ListRow, Screen, useLocale, useTheme } from '@aidooi/ui-native';
import { ListSkeleton, PageHeader } from '../../components/index.tsx';
import { keyFor, useTx } from '../../i18n/useTx.ts';
import { GatedError, toneOf } from './parts.tsx';
import { useTransact } from './useTransact.ts';
import { formatDateTime } from './time.ts';

export function ViewingsListScreen() {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const { locale } = useLocale();
  const tx = useTransact();
  const q = useQuery({ queryKey: ['viewings'], queryFn: () => tx.listViewings() });
  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        <PageHeader title={t('viewings.title')} onBack={() => router.back()} />
        {q.isPending ? <ListSkeleton /> : null}
        {q.isError ? (
          <GatedError error={q.error} resumeHref="/viewing" onRetry={() => q.refetch()} />
        ) : null}
        {q.data && q.data.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={t('viewings.empty')}
            message={t('viewings.emptyHint')}
          />
        ) : null}
        {q.data?.map((v) => (
          <ListRow
            key={v.id}
            title={v.stops.map((s) => s.locationName).join(', ') || t('viewing.title')}
            subtitle={
              v.scheduledAt
                ? formatDateTime(v.scheduledAt, locale)
                : formatDateTime(v.createdAt, locale)
            }
            trailing={<Badge label={t(keyFor('viewingState', v.state))} tone={toneOf(v.state)} />}
            chevron
            onPress={() => router.push(`/viewing/${v.id}` as never)}
          />
        ))}
      </View>
    </Screen>
  );
}
