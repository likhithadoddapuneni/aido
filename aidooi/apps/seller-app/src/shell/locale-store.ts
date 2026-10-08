import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { Locale } from '@aidooi/i18n';
import { LOCALE_KEY, type LocalePersistence } from './providers.tsx';

/** The language choice survives restarts (it is what makes an RTL reload stick). Web keeps it in memory. */
export const deviceLocale: LocalePersistence = {
  load: async () => {
    if (Platform.OS === 'web') return null;
    const v = await SecureStore.getItemAsync(LOCALE_KEY);
    return v === 'en' || v === 'ar' ? v : null;
  },
  save: async (l: Locale) => {
    if (Platform.OS !== 'web') await SecureStore.setItemAsync(LOCALE_KEY, l);
  },
};
