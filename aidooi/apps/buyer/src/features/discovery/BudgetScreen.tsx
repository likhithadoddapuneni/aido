import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Card, ErrorView, Icon, Money, Screen, Text, useTheme } from '@aidooi/ui-native';
import { ListSkeleton, PageHeader, QueryBoundary } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { useServices } from '../../providers/AppProviders.tsx';
import { isMultiRoom, type PathId } from '../../projects/wizard.ts';

/**
 * The five budget tiers with their AED ranges for THIS project. The size class is shown, read-only: the
 * buyer never chooses it — the server derives it from the dimensions.
 */
export function BudgetScreen({ projectId }: { projectId: string }) {
  const t = useTx();
  const router = useRouter();
  const qc = useQueryClient();
  const { space } = useTheme();
  const { services } = useServices();
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => services.getProject(projectId),
  });
  const cards = useQuery({
    queryKey: ['budget-cards', projectId],
    queryFn: () => services.budgetCards(projectId),
  });

  const choose = useMutation({
    mutationFn: async (card: { tier: string; highFils: number }) => {
      const p = project.data;
      if (!p) throw new Error('no project');
      const input = { ...p.input, tier: card.tier } as typeof p.input;
      // A whole property is budgeted from one total; picking a tier sets it to that tier's ceiling.
      if (isMultiRoom(p.input.pathId as PathId) && 'totalBudgetFils' in input)
        input.totalBudgetFils = card.highFils;
      return services.updateProject(projectId, input);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.removeQueries({ queryKey: ['recommend', projectId] });
      router.replace(`/project/${projectId}/options` as never);
    },
  });

  return (
    <Screen>
      <PageHeader
        title={t('budget.title')}
        subtitle={t('budget.subtitle')}
        onBack={() => router.back()}
      />
      <QueryBoundary query={project} skeleton={<ListSkeleton rows={1} />}>
        {(p) =>
          p.sizeClass ? (
            <View
              accessible
              accessibilityLabel={t('budget.size', { size: t(`size.${p.sizeClass}` as never) })}
            >
              <Badge
                label={t('budget.size', { size: t(`size.${p.sizeClass}` as never) })}
                tone="info"
              />
            </View>
          ) : null
        }
      </QueryBoundary>
      <QueryBoundary query={cards}>
        {(c) => (
          <View style={{ gap: space[3] }}>
            {c.cards.map((card, index) => (
              <Card
                key={card.tier}
                onPress={() => choose.mutate(card)}
                accessibilityLabel={`${t(`tier.${card.tier}` as never)}`}
                style={{ gap: space[2] }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                  <Text variant="title" tone="navy" style={{ flex: 1 }}>
                    {t(`tier.${card.tier}` as never)}
                  </Text>
                  <TierMeter level={index + 1} total={c.cards.length} />
                  <Icon name="chevron" size={20} tone="secondary" />
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    gap: space[2],
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <Money fils={card.lowFils} large />
                  <Text tone="secondary">–</Text>
                  <Money fils={card.highFils} large />
                </View>
                <Text tone="secondary">{t(`tierBlurb.${card.tier}` as never)}</Text>
              </Card>
            ))}
          </View>
        )}
      </QueryBoundary>
      {choose.isError ? <ErrorView error={choose.error} /> : null}
    </Screen>
  );
}

/** Five rising bars: a glanceable sense of where this tier sits. Decorative — the tier name carries the meaning. */
function TierMeter({ level, total }: { level: number; total: number }) {
  const { color, space, radius } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[1] / 2, height: space[4] }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: space[1],
            height: space[2] + i * space[1],
            borderRadius: radius.sm / 4,
            backgroundColor: i < level ? color.navy : color.sand200,
          }}
        />
      ))}
    </View>
  );
}
