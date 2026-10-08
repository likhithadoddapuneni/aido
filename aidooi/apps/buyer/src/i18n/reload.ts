import { Platform } from 'react-native';

/**
 * Layout direction changes only after a reload on native. Returns false when the platform could not
 * reload itself (a development client), so the caller can ask the person to reopen the app.
 */
export async function reloadApp(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      globalThis.location?.reload();
      return true;
    }
    const Updates = await import('expo-updates');
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}
