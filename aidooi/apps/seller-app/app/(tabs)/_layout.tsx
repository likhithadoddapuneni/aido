import { Tabs } from 'expo-router';
import { useT, useTheme } from '@aidooi/ui-native';
import { catalogue } from '../../src/i18n/index.ts';

export default function TabsLayout() {
  const t = useT(catalogue);
  const { color, touchTarget } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.navy,
        tabBarInactiveTintColor: color.text2,
        tabBarStyle: {
          backgroundColor: color.white,
          borderTopColor: color.border,
          minHeight: touchTarget + 8,
        },
        // Labels only: five clear words beat five ambiguous icons on a shop floor.
        tabBarIcon: () => null,
        tabBarLabelStyle: { fontSize: 14, fontWeight: '600' },
        tabBarIconStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tab.tasks') }} />
      <Tabs.Screen name="scan" options={{ title: t('tab.scan') }} />
      <Tabs.Screen name="orders" options={{ title: t('tab.orders') }} />
      <Tabs.Screen name="stock" options={{ title: t('tab.stock') }} />
      <Tabs.Screen name="more" options={{ title: t('tab.more') }} />
    </Tabs>
  );
}
