import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { SellerData } from '../data/seller.ts';

/** `aidooiseller://task/<id>` (or a path `/task/<id>`) → the task id. Anything else is not ours. */
export function taskIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^(?:aidooiseller:\/\/|\/)task\/([0-9a-fA-F-]{36})\/?(?:\?.*)?$/.exec(url.trim());
  return m ? (m[1] as string) : null;
}

/** Where a tapped notification should take the user. The payload comes from our server, but is still untrusted input. */
export function routeForNotification(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { url?: unknown; taskId?: unknown };
  const fromUrl = typeof d.url === 'string' ? taskIdFromUrl(d.url) : null;
  const id = fromUrl ?? (typeof d.taskId === 'string' ? taskIdFromUrl(`/task/${d.taskId}`) : null);
  return id ? `/task/${id}` : null;
}

export type PushOutcome = 'registered' | 'denied' | 'unavailable' | 'failed';

/**
 * Ask permission, obtain the Expo push token and tell the API. Push is how a seller learns a buyer is
 * waiting, so a refusal is surfaced to the user (see MoreScreen) rather than hidden. Simulators and the web
 * have no push token and report `unavailable`.
 */
export async function registerForPush(
  data: Pick<SellerData, 'registerDevice'>,
): Promise<PushOutcome> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unavailable';
  try {
    const existing = await Notifications.getPermissionsAsync();
    const granted = existing.granted
      ? true
      : (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return 'denied';
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await data.registerDevice({
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      pushToken: token.data,
      appVersion: Constants.expoConfig?.version ?? '0.0.0',
    });
    return 'registered';
  } catch {
    return 'failed';
  }
}
