import { Tabs } from 'expo-router';
import { Icon, fontFamily, useLocale, useTheme, type IconName } from '@aidooi/ui-native';
import { elevate } from '@aidooi/ui-native';
import { useTx } from '../../src/i18n/useTx.ts';

const ICONS: Record<string, IconName> = {
  home: 'home',
  projects: 'folder',
  orders: 'bag',
  account: 'user',
};

/** Four fixed tabs, each with an icon: the active one is navy on a soft pill, the rest are quiet. */
export default function TabsLayout() {
  const t = useTx();
  const theme = useTheme();
  const { color, space, radius } = theme;
  const { locale } = useLocale();
  const screen = (name: keyof typeof ICONS, title: string) => (
    <Tabs.Screen
      name={name}
      options={{
        title,
        tabBarIcon: ({ focused }) => (
          <Icon name={ICONS[name] as IconName} size={24} tone={focused ? 'navy' : 'secondary'} />
        ),
      }}
    />
  );
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.navy,
        tabBarInactiveTintColor: color.text2,
        tabBarStyle: {
          backgroundColor: color.white,
          borderTopColor: color.borderSoft,
          paddingTop: space[1],
          ...elevate(theme, 'lg'),
        },
        tabBarItemStyle: { borderRadius: radius.lg, marginHorizontal: space[1] },
        tabBarLabelStyle: {
          fontFamily: fontFamily('ui', locale, '600'),
          fontSize: theme.fontSize.caption,
        },
      }}
    >
      {screen('home', t('tabs.home'))}
      {screen('projects', t('tabs.projects'))}
      {screen('orders', t('tabs.orders'))}
      {screen('account', t('tabs.account'))}
    </Tabs>
  );
}
