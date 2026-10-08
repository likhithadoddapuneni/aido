import { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { NetworkError } from '@aidooi/api-client';
import { Banner, Card, Icon, Screen, Skeleton, Text, useLocale, useTheme } from '@aidooi/ui-native';
import { PageHeader } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { useServices } from '../../providers/AppProviders.tsx';
import { GatedError } from './parts.tsx';
import { useBrightnessBoost, type BrightnessModule } from './brightness.ts';
import { createPassCache, toCached, type CachedPass } from './passCache.ts';
import { QrCode } from './QrCode.tsx';
import { useTransact } from './useTransact.ts';
import { formatDateTime, remaining } from './time.ts';
import { useNow, wallClockIso } from './useNow.ts';

/**
 * The viewing pass. Fetched when there is a connection and cached on the device, so it opens in a
 * showroom basement with no signal; only a failed *connection* falls back to the cache — a server
 * refusal (cancelled, expired) is shown, never papered over with a stale pass.
 */
export function PassScreen({
  viewingId,
  brightness,
}: {
  viewingId: string;
  brightness?: BrightnessModule | null;
}) {
  const t = useTx();
  const router = useRouter();
  const { space, color, radius } = useTheme();
  const { locale } = useLocale();
  const { kv } = useServices();
  const tx = useTransact();
  const cache = useMemo(() => createPassCache(kv), [kv]);

  const q = useQuery({
    queryKey: ['pass', viewingId],
    queryFn: async (): Promise<{ pass: CachedPass; offline: boolean }> => {
      try {
        const [viewing, pass] = await Promise.all([
          tx.getViewing(viewingId),
          tx.getPass(viewingId),
        ]);
        const fresh = toCached(viewing, pass, wallClockIso());
        await cache.save(fresh);
        return { pass: fresh, offline: false };
      } catch (e) {
        if (e instanceof NetworkError) {
          const stored = await cache.read(viewingId);
          if (stored) return { pass: stored, offline: true };
        }
        throw e;
      }
    },
    retry: false,
  });

  useBrightnessBoost(q.isSuccess, brightness);
  const now = useNow(1000);

  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        <PageHeader
          title={t('pass.title')}
          subtitle={t('pass.subtitle')}
          onBack={() => router.back()}
        />
        {q.isPending ? <Skeleton height={280} /> : null}
        {q.isError ? (
          <GatedError
            error={q.error}
            resumeHref={`/viewing/${viewingId}/pass`}
            onRetry={() => q.refetch()}
          />
        ) : null}
        {q.data ? (
          <View style={{ gap: space[3] }}>
            {q.data.offline ? <Banner tone="info" message={t('pass.offline')} /> : null}
            <Card tone="ink" style={{ alignItems: 'center', gap: space[3], padding: space[4] }}>
              <View
                style={{
                  backgroundColor: color.white,
                  borderRadius: radius.lg,
                  padding: space[2],
                }}
              >
                <QrCode value={q.data.pass.token} size={240} label={t('pass.qrLabel')} />
              </View>
              {q.data.pass.scheduledAt ? (
                <View style={{ alignItems: 'center', gap: space[1] }}>
                  <Text variant="h3" tone="inverse">
                    {formatDateTime(q.data.pass.scheduledAt, locale)}
                  </Text>
                  {(() => {
                    const left = remaining(q.data.pass.scheduledAt, now);
                    return left.expired ? null : (
                      <Text tone="inverseMuted">
                        {t('viewing.countdown', { clock: left.clock })}
                      </Text>
                    );
                  })()}
                </View>
              ) : null}
            </Card>
            {remaining(q.data.pass.validUntil, now).expired ? (
              <Banner tone="warn" message={t('pass.expired')} />
            ) : (
              <Text variant="caption" tone="secondary">
                {t('pass.validUntil', { when: formatDateTime(q.data.pass.validUntil, locale) })}
              </Text>
            )}
            <Text variant="label" accessibilityRole="header">
              {t('pass.showAt')}
            </Text>
            {q.data.pass.stops.map((s) => (
              <Card
                key={s.stopNo}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}
                accessible
                accessibilityLabel={`${s.stopNo}. ${s.locationName} — ${s.address}`}
              >
                <Icon name="pin" size={24} />
                <View style={{ flex: 1, gap: space[1] }}>
                  <Text style={{ fontWeight: '600' }}>
                    {s.stopNo}. {s.locationName}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {s.address}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
