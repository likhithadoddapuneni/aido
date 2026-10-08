import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { View, useWindowDimensions } from 'react-native';
import {
  Badge,
  Card,
  EmptyState,
  Icon,
  RoomScene,
  Screen,
  Text,
  useTheme,
} from '@aidooi/ui-native';
import { PageHeader, QueryBoundary } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { useServices } from '../../providers/AppProviders.tsx';

export function ProjectsScreen() {
  const t = useTx();
  const { space, color } = useTheme();
  const w = useWindowDimensions().width - space[3] * 2 - 2;
  const router = useRouter();
  const { services } = useServices();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => services.listProjects() });
  return (
    <Screen>
      <PageHeader title={t('projects.title')} />
      <QueryBoundary query={projects}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              icon="folder"
              title={t('projects.empty')}
              message={t('projects.emptyHint')}
              action={{
                label: t('projects.start'),
                onPress: () => router.push('/(tabs)/home' as never),
              }}
            />
          ) : (
            <View style={{ gap: space[3] }}>
              {list.map((p) => (
                <Card
                  key={p.id}
                  flush
                  accessibilityLabel={[
                    t(`path.${p.input.pathId}.title` as never),
                    p.sizeClass
                      ? t('projects.size', { size: t(`size.${p.sizeClass}` as never) })
                      : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  // Resuming goes straight to the options: nothing is asked again.
                  onPress={() => router.push(`/project/${p.id}/options` as never)}
                >
                  <View style={{ backgroundColor: color.linen }}>
                    <RoomScene kind={p.input.pathId} width={w} height={Math.round(w * 0.42)} />
                  </View>
                  <View
                    style={{
                      padding: space[3],
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space[2],
                    }}
                  >
                    <View style={{ flex: 1, gap: space[1] }}>
                      <Text variant="title" tone="navy">
                        {t(`path.${p.input.pathId}.title` as never)}
                      </Text>
                      {p.sizeClass ? (
                        <Text variant="caption" tone="secondary">
                          {t('projects.size', { size: t(`size.${p.sizeClass}` as never) })}
                        </Text>
                      ) : null}
                    </View>
                    <Badge
                      label={t(`state.${p.state}` as never)}
                      tone={p.state === 'Ready for Recommendation' ? 'ok' : 'neutral'}
                    />
                    <Icon name="chevron" size={20} tone="secondary" />
                  </View>
                </Card>
              ))}
            </View>
          )
        }
      </QueryBoundary>
    </Screen>
  );
}
