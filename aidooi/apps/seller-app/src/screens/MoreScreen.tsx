import { useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { type Locale } from '@aidooi/i18n';
import {
  Badge,
  Banner,
  Button,
  Screen,
  SegmentedControl,
  Text,
  useT,
  useTheme,
} from '@aidooi/ui-native';
import { catalogue } from '../i18n/index.ts';
import { isSellerRole } from '../domain/roles.ts';
import { registerForPush, type PushOutcome } from '../notifications/push.ts';
import { useAuth } from '../session/auth.tsx';
import { useLanguage } from '../shell/providers.tsx';
import { useOnline } from '../net/online.ts';

/** Restart so a new layout direction takes effect. Falls back to doing nothing in environments without updates. */
async function restartApp(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    /* development builds cannot reload this way; the banner already told the user to restart */
  }
}

const NOTE: Record<PushOutcome, 'registered' | 'denied' | 'unavailable' | 'failed'> = {
  registered: 'registered',
  denied: 'denied',
  unavailable: 'unavailable',
  failed: 'failed',
};

export function MoreScreen() {
  const t = useT(catalogue);
  const { space } = useTheme();
  const router = useRouter();
  const { staff, data, signOut } = useAuth();
  const { locale, setLanguage } = useLanguage();
  const online = useOnline();
  const [needsReload, setNeedsReload] = useState(false);
  const [push, setPush] = useState<PushOutcome | null>(null);

  return (
    <Screen>
      <Text variant="h1">{t('more.title')}</Text>
      {staff ? (
        <View style={{ gap: space[1] }}>
          <Text>{t('more.role', { email: staff.email })}</Text>
          <Badge
            label={isSellerRole(staff.role) ? t(`more.role.${staff.role}`) : staff.role}
            tone="info"
          />
        </View>
      ) : null}

      <Text variant="h3">{t('more.language')}</Text>
      <SegmentedControl
        accessibilityLabel={t('more.language')}
        options={[
          { value: 'en', label: 'English' },
          { value: 'ar', label: 'العربية' },
        ]}
        value={locale}
        onChange={(next: Locale) => setNeedsReload(setLanguage(next).needsReload)}
      />
      {needsReload ? (
        <Banner
          tone="info"
          message={t('more.reload')}
          action={{ label: t('more.reload.now'), onPress: () => void restartApp() }}
        />
      ) : null}

      <Text variant="h3">{t('more.notifications')}</Text>
      {push ? (
        <Text tone={push === 'registered' ? 'ok' : 'warn'}>
          {t(`more.notifications.${NOTE[push]}`)}
        </Text>
      ) : null}
      <Button
        title={t('more.notifications.enable')}
        variant="secondary"
        disabled={!online}
        onPress={async () => setPush(await registerForPush(data))}
      />

      <Button title={t('more.issues')} variant="ghost" onPress={() => router.push('/issues')} />
      <Button title={t('auth.signOut')} variant="destructive" onPress={signOut} />
      <Text variant="caption" tone="secondary">
        {t('more.version', { version: Constants.expoConfig?.version ?? '0.0.0' })}
      </Text>
    </Screen>
  );
}
