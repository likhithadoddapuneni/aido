import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  Icon,
  Money,
  ProductArt,
  Screen,
  ScoreRing,
  Text,
  useTheme,
} from '@aidooi/ui-native';
import type { Composition, Project } from '@aidooi/contracts';
import { ListSkeleton, PageHeader, QueryBoundary } from '../../components/index.tsx';
import { keyFor, useTx, type Tx } from '../../i18n/useTx.ts';
import { useServices } from '../../providers/AppProviders.tsx';
import type { Ranking, Recommendation } from '../../api/services.ts';

type Run = Recommendation['runs'][number];

/**
 * Up to four differentiated options, shown as the engine returned them. If inventory only supports
 * fewer, fewer are shown and the screen says so — it never pads the list with a weaker option.
 */
export function OptionsScreen({ projectId }: { projectId: string }) {
  const t = useTx();
  const router = useRouter();
  const { services } = useServices();
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => services.getProject(projectId),
  });
  return (
    <Screen>
      <PageHeader title={t('options.title')} onBack={() => router.back()} />
      <QueryBoundary query={project} skeleton={<ListSkeleton />}>
        {(p) =>
          p.input.pathId === 'individualProduct' ? (
            <RankingList project={p} />
          ) : (
            <Recommendations project={p} />
          )
        }
      </QueryBoundary>
    </Screen>
  );
}

function Recommendations({ project }: { project: Project }) {
  const t = useTx();
  const router = useRouter();
  const qc = useQueryClient();
  const { space } = useTheme();
  const { services } = useServices();
  // A recommendation is a run, not a lookup: it is fetched once per visit and kept until refreshed.
  const rec = useQuery({
    queryKey: ['recommend', project.id],
    queryFn: () => services.recommend(project.id),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['recommend', project.id] });

  return (
    <QueryBoundary query={rec}>
      {(r) => (
        <View style={{ gap: space[4] }}>
          {r.project?.constraint ? (
            <Banner
              tone="warn"
              title={t('options.constraintTitle')}
              message={t('options.constraint')}
              action={{
                label: t('options.changeBudget'),
                onPress: () => router.push(`/project/${project.id}/budget` as never),
              }}
            />
          ) : null}
          {r.project ? (
            <View
              style={{
                flexDirection: 'row',
                gap: space[2],
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <Text variant="label">{t('options.projectTotal')}</Text>
              <Money fils={r.project.bestOverallTotalFils} />
              <Text tone="secondary">/</Text>
              <Money fils={r.project.totalBudgetFils} tone="secondary" />
            </View>
          ) : null}
          {r.runs.map((run) => (
            <RunSection
              key={run.id}
              run={run}
              projectId={project.id}
              multi={r.runs.length > 1}
              onRefresh={refresh}
            />
          ))}
        </View>
      )}
    </QueryBoundary>
  );
}

function RunSection({
  run,
  projectId,
  multi,
  onRefresh,
}: {
  run: Run;
  projectId: string;
  multi: boolean;
  onRefresh: () => unknown;
}) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const stale = run.compositions.some((c) => c.stale);
  return (
    <View style={{ gap: space[3] }}>
      {multi && run.moduleLabel ? <Text variant="h2">{run.moduleLabel}</Text> : null}
      {run.status === 'Limited Inventory' ? (
        <Banner tone="info" message={t('options.limited', { n: run.compositions.length })} />
      ) : null}
      {stale ? (
        <Banner
          tone="warn"
          message={t('options.stale')}
          action={{ label: t('options.refresh'), onPress: onRefresh }}
        />
      ) : null}
      {run.status === 'Failed' || run.compositions.length === 0 ? (
        <EmptyState
          icon="search"
          title={t('options.none')}
          message={t('options.noneHint')}
          action={{
            label: t('options.changeBudget'),
            onPress: () => router.push(`/project/${projectId}/budget` as never),
          }}
        />
      ) : (
        run.compositions.map((c) => (
          <CompositionCard key={c.id} c={c} t={t} projectId={projectId} />
        ))
      )}
    </View>
  );
}

function CompositionCard({ c, t, projectId }: { c: Composition; t: Tx; projectId: string }) {
  const router = useRouter();
  const { space, color } = useTheme();
  const label = t(keyFor('objective', c.objective));
  // The preview strip shows the room's pieces, largest first: what the buyer would actually be getting.
  const shown = [...c.items]
    .sort((a, b) => b.product.widthCm * b.product.depthCm - a.product.widthCm * a.product.depthCm)
    .slice(0, 4);
  return (
    <Card
      flush
      onPress={() =>
        router.push({ pathname: '/composition/[id]', params: { id: c.id, projectId } } as never)
      }
      accessibilityLabel={t('options.cardLabel', { label, score: c.score ?? 0 })}
    >
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: color.linen,
          paddingHorizontal: space[2],
          paddingTop: space[2],
        }}
      >
        {shown.map((i, n) => (
          <View key={i.slotKey} style={{ flex: 1, marginStart: n === 0 ? 0 : -space[2] }}>
            <ProductArt
              product={i.product}
              size={96}
              tile={false}
              decorative
              style={{ alignSelf: 'center' }}
            />
          </View>
        ))}
      </View>
      <View style={{ padding: space[3], gap: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <View style={{ flex: 1, gap: space[1] }}>
            <Text variant="title" tone="navy">
              {label}
            </Text>
            <Text variant="caption" tone="secondary">
              {t(keyFor('objectiveBlurb', c.objective))}
            </Text>
          </View>
          {c.score !== null ? (
            <ScoreRing
              score={c.score}
              accessibilityLabel={t('options.score', { score: c.score })}
            />
          ) : null}
        </View>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTopWidth: 1,
            borderTopColor: color.borderSoft,
            paddingTop: space[2],
          }}
        >
          <Money fils={c.total} large />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <Text variant="caption" tone="secondary">
              {t('options.items', { n: c.items.length })}
            </Text>
            <Icon name="chevron" size={18} tone="secondary" />
          </View>
        </View>
        {c.stale ? <Badge label={t('options.staleBadge')} tone="warn" /> : null}
        {c.unfilled.length > 0 ? (
          <Text variant="caption" tone="secondary">
            {t('options.unfilled', {
              list: c.unfilled.map((u) => t(keyFor('productType', u))).join(', '),
            })}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/** The Individual Product path (AID-SPC-009): ranked products, not a composed room. */
function RankingList({ project }: { project: Project }) {
  const t = useTx();
  const { space } = useTheme();
  const { services } = useServices();
  const rank = useQuery({
    queryKey: ['rank', project.id],
    queryFn: () => services.rank(project.id),
    staleTime: Infinity,
  });
  return (
    <QueryBoundary query={rank}>
      {(r: Ranking) => (
        <View style={{ gap: space[3] }}>
          {r.priceRange ? (
            <View
              style={{
                flexDirection: 'row',
                gap: space[2],
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <Text variant="label">{t('rank.range', { tier: t(keyFor('tier', r.tier)) })}</Text>
              <Money fils={r.priceRange.lowFils} />
              <Text>–</Text>
              <Money fils={r.priceRange.highFils} />
            </View>
          ) : null}
          {r.results.length === 0 ? (
            <EmptyState icon="search" title={t('rank.none')} message={t('rank.noneHint')} />
          ) : (
            r.results.map((x) => (
              <Card
                key={x.offer.id}
                accessibilityLabel={x.product.name}
                style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}
              >
                <ProductArt product={x.product} size={96} decorative />
                <View style={{ flex: 1, gap: space[1] }}>
                  <Text variant="h3">{x.product.name}</Text>
                  <Money fils={x.offer.sellingPrice} originalFils={x.offer.originalPrice} />
                  <Text variant="caption" tone="secondary">
                    {t('card.soldBy', { seller: x.offer.partner.tradeName })} ·{' '}
                    {t(keyFor('viewing', x.offer.viewingStatus))} ·{' '}
                    {t('card.delivery', { days: x.offer.deliveryDays })}
                  </Text>
                </View>
                <ScoreRing
                  score={x.match.score}
                  size={48}
                  accessibilityLabel={t('options.score', { score: x.match.score })}
                />
              </Card>
            ))
          )}
        </View>
      )}
    </QueryBoundary>
  );
}
