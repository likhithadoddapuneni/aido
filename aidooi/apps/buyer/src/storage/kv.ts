import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** The only persistence the app uses: small string values by key. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function memoryKv(initial: Readonly<Record<string, string>> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

/** iOS Keychain / Android Keystore. Tokens never touch plain AsyncStorage. */
const secureKv: KeyValueStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};

/**
 * Browsers have no keychain. On web the session lives in `sessionStorage` (gone when the tab closes),
 * never `localStorage`, so a stolen laptop profile does not hold a login. Falls back to memory where
 * storage is blocked (private modes, tests).
 */
function webKv(): KeyValueStore {
  try {
    const s = globalThis.sessionStorage;
    s.setItem('aidooi.probe', '1');
    s.removeItem('aidooi.probe');
    return {
      get: async (k) => s.getItem(k),
      set: async (k, v) => void s.setItem(k, v),
      remove: async (k) => void s.removeItem(k),
    };
  } catch {
    return memoryKv();
  }
}

export const platformKv = (): KeyValueStore => (Platform.OS === 'web' ? webKv() : secureKv);
