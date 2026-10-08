import { Platform } from 'react-native';

/** The push-permission operations the app needs, so screens and tests do not touch the native module directly. */
export interface PushRegistrar {
  permission(): Promise<'granted' | 'denied' | 'undetermined'>;
  /** Ask the OS. Returns the device token, or null if the buyer declined. */
  request(): Promise<string | null>;
}

/**
 * `expo-notifications` is loaded on demand: nothing about push is touched until the buyer chooses to turn it on,
 * and the app (and web) run without it.
 */
export const devicePushRegistrar: PushRegistrar = {
  async permission() {
    const N = await import('expo-notifications');
    const { status } = await N.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  },
  async request() {
    const N = await import('expo-notifications');
    const { status } = await N.requestPermissionsAsync();
    if (status !== 'granted') return null;
    const token = await N.getDevicePushTokenAsync();
    return typeof token.data === 'string' ? token.data : JSON.stringify(token.data);
  },
};

export const pushPlatform = (): 'ios' | 'android' | 'web' =>
  Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
