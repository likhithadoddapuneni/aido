import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '@aidooi/i18n';
import {
  EmptyState,
  ErrorView,
  ListRow,
  Money,
  ProductArt,
  ScoreRing,
  Screen,
  Text,
  useLocale,
  useTheme,
} from '@aidooi/ui-native';
import { PageHeader, QueryBoundary } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { useServices } from '../../providers/AppProviders.tsx';

/**
 * Replacements for one slot, re-scored by the server against the live catalogue. The server revalidates
 * on replace and may refuse ("that would stop this room working"); its answer is shown, translated.
 */
export function ReplaceScreen({
  compositionId,
  slotKey,
}: {
  compositionId: string;
  slotKey: string;
}) {
  const t = useTx();
  const router = useRouter();
  const qc = useQueryClient();
  const { locale } = useLocale();
  const { space } = useTheme();
  const { services } = useServices();
  const alts = useQuery({
    queryKey: ['alternatives', compositionId, slotKey],
    queryFn: () => services.alternatives(compositionId, slotKey),
  });
  const replace = useMutation({
    mutationFn: (offerId: string) => services.replaceItem(compositionId, slotKey, offerId),
    onSuccess: (updated) => {
      qc.setQueryData(['composition', compositionId], updated);
      qc.removeQueries({ queryKey: ['alternatives', compositionId] });
      router.back();
    },
  });

  return (
    <Screen>
      <PageHeader
        title={t('replace.title')}
        subtitle={t('replace.subtitle')}
        onBack={() => router.back()}
      />
      {replace.isError ? <ErrorView error={replace.error} /> : null}
      <QueryBoundary query={alts}>
        {(a) =>
          a.alternatives.length === 0 ? (
            <EmptyState icon="swap" title={t('replace.none')} message={t('replace.noneHint')} />
          ) : (
            <View style={{ gap: space[2] }}>
              {a.alternatives.map((x) => (
                <ListRow
                  key={x.offer.id}
                  title={x.product.name}
                  subtitle={`${x.offer.partner.tradeName} · ${
                    x.priceDelta === 0
                      ? t('replace.same')
                      : t(x.priceDelta < 0 ? 'replace.cheaper' : 'replace.dearer', {
                          amount: formatMoney(Math.abs(x.priceDelta), locale),
                        })
                  }`}
                  leading={<ProductArt product={x.product} size={72} decorative />}
                  trailing={
                    <View style={{ alignItems: 'flex-end', gap: space[1] }}>
                      <Money fils={x.offer.sellingPrice} originalFils={x.offer.originalPrice} />
                      <ScoreRing
                        score={x.match.score}
                        size={40}
                        accessibilityLabel={t('options.score', { score: x.match.score })}
                      />
                    </View>
                  }
                  onPress={() => replace.mutate(x.offer.id)}
                  accessibilityLabel={`${x.product.name}, ${x.offer.partner.tradeName}`}
                />
              ))}
              <Text variant="caption" tone="secondary">
                {t('replace.note')}
              </Text>
            </View>
          )
        }
      </QueryBoundary>
    </Screen>
  );
}
