import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useMutation } from '@tanstack/react-query';
import { Banner, Button, Card, ErrorView, Screen, Text, useTheme } from '@aidooi/ui-native';
import { PageHeader } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { useServices } from '../../providers/AppProviders.tsx';
import { devicePushRegistrar, pushPlatform, type PushRegistrar } from './push.ts';
import { useTransact } from './useTransact.ts';

const TOKEN_KEY = 'aidooi.push-token.v1';

/**
 * Notifications are asked for in two steps: first we say what they are for (viewing confirmed, price
 * changes, delivery updates), and only when the buyer chooses to continue does the system prompt appear.
 * The prompt is a one-time chance on most phones, so it is never shown cold.
 */
export function NotificationsScreen({
  registrar = devicePushRegistrar,
}: {
  registrar?: PushRegistrar;
}) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const { kv } = useServices();
  const tx = useTransact();
  const [status, setStatus] = useState<'granted' | 'denied' | 'undetermined' | 'checking'>(
    'checking',
  );
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    void (async () => {
      setStatus(await registrar.permission().catch(() => 'undetermined' as const));
      setEnabled((await kv.get(TOKEN_KEY)) !== null);
    })();
  }, [registrar, kv]);

  const turnOn = useMutation({
    mutationFn: async () => {
      const token = await registrar.request();
      if (!token) {
        setStatus('denied');
        return;
      }
      await tx.registerDevice({
        platform: pushPlatform(),
        pushToken: token,
        appVersion: Constants.expoConfig?.version ?? '0.0.0',
      });
      await kv.set(TOKEN_KEY, token);
      setStatus('granted');
      setEnabled(true);
    },
  });
  const turnOff = useMutation({
    mutationFn: async () => {
      const token = await kv.get(TOKEN_KEY);
      if (token) await tx.removeDevice(token);
      await kv.remove(TOKEN_KEY);
      setEnabled(false);
    },
  });

  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        <PageHeader title={t('notifications.title')} onBack={() => router.back()} />
        <Card>
          <View style={{ gap: space[2] }}>
            <Text variant="label">{t('notifications.whyTitle')}</Text>
            {(['viewing', 'price', 'delivery'] as const).map((k) => (
              <Text key={k} tone="secondary">
                • {t(`notifications.why.${k}` as never)}
              </Text>
            ))}
            <Text variant="caption" tone="secondary">
              {t('notifications.noSpam')}
            </Text>
          </View>
        </Card>
        {status === 'denied' ? <Banner tone="warn" message={t('notifications.denied')} /> : null}
        {turnOn.isError ? <ErrorView error={turnOn.error} /> : null}
        {turnOff.isError ? <ErrorView error={turnOff.error} /> : null}
        {enabled ? (
          <Button
            title={t('notifications.turnOff')}
            variant="secondary"
            loading={turnOff.isPending}
            onPress={() => turnOff.mutateAsync().catch(() => undefined)}
          />
        ) : (
          <Button
            title={t('notifications.turnOn')}
            loading={turnOn.isPending}
            disabled={status === 'checking'}
            onPress={() => turnOn.mutateAsync().catch(() => undefined)}
          />
        )}
      </View>
    </Screen>
  );
}
