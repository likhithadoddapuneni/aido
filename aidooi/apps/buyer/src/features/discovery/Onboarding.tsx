import { View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Backdrop,
  Button,
  IconTile,
  Screen,
  SegmentedControl,
  StickyBar,
  Text,
  useTheme,
  useToast,
  RoomScene,
  type IconName,
} from '@aidooi/ui-native';
import { useTx } from '../../i18n/useTx.ts';
import { reloadApp } from '../../i18n/reload.ts';
import { useAppState } from '../../providers/AppProviders.tsx';

/** First screen: language only. No account, no permissions, no questions about the buyer. */
export function LanguageScreen() {
  const t = useTx();
  const router = useRouter();
  const { locale, setLanguage } = useAppState();
  const toast = useToast();
  const { space, radius } = useTheme();
  const width = useWindowDimensions().width;
  return (
    <Screen
      padded={false}
      footer={
        <StickyBar>
          <Button
            title={t('common.continue')}
            onPress={() => router.push('/(onboarding)/intro' as never)}
          />
        </StickyBar>
      }
    >
      <View
        style={{
          overflow: 'hidden',
          borderBottomLeftRadius: radius.xl,
          borderBottomRightRadius: radius.xl,
        }}
      >
        <Backdrop variant="room" />
        <View style={{ padding: space[4], gap: space[2], paddingTop: space[6] }}>
          <Text variant="hero" tone="navy" accessibilityRole="header">
            AiDOOi
          </Text>
          <Text tone="secondary">{t('brand.tagline')}</Text>
        </View>
        <RoomScene bare kind="livingRoom" width={width} height={Math.round((width * 5) / 8)} />
      </View>
      <View style={{ padding: space[3], gap: space[2] }}>
        <Text variant="label">{t('language.label')}</Text>
        <SegmentedControl
          accessibilityLabel={t('language.label')}
          options={[
            { value: 'en', label: 'English' },
            { value: 'ar', label: 'العربية' },
          ]}
          value={locale}
          onChange={async (next) => {
            const { needsReload } = await setLanguage(next);
            // Direction flips only on restart on native; reload now, or say so if the platform cannot.
            if (needsReload && !(await reloadApp()))
              toast.show({ message: t('language.restart'), tone: 'info' });
          }}
        />
      </View>
    </Screen>
  );
}

const PROMISES: readonly {
  icon: IconName;
  title: 'intro.p1.title' | 'intro.p2.title' | 'intro.p3.title';
  body: 'intro.p1.body' | 'intro.p2.body' | 'intro.p3.body';
}[] = [
  { icon: 'ruler', title: 'intro.p1.title', body: 'intro.p1.body' },
  { icon: 'shield', title: 'intro.p2.title', body: 'intro.p2.body' },
  { icon: 'calendar', title: 'intro.p3.title', body: 'intro.p3.body' },
];

export function IntroScreen() {
  const t = useTx();
  const router = useRouter();
  const { completeOnboarding } = useAppState();
  const { space } = useTheme();
  return (
    <Screen
      footer={
        <StickyBar>
          <Button
            title={t('intro.start')}
            onPress={async () => {
              await completeOnboarding();
              router.replace('/(tabs)/home' as never);
            }}
          />
        </StickyBar>
      }
    >
      <View style={{ gap: space[2], paddingTop: space[4] }}>
        <Text variant="display" tone="navy" accessibilityRole="header">
          {t('intro.title')}
        </Text>
        <Text tone="secondary">{t('intro.body')}</Text>
      </View>
      <View style={{ gap: space[4], paddingTop: space[3] }}>
        {PROMISES.map((p) => (
          <View key={p.title} style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
            <IconTile name={p.icon} size={52} tone="sand" />
            <View style={{ flex: 1, gap: space[1] }}>
              <Text variant="h3">{t(p.title)}</Text>
              <Text variant="caption" tone="secondary">
                {t(p.body)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}
