import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createStaffStore, memoryKeyValue, type StaffStore } from './store.ts';

/**
 * Tokens live in the OS keychain/keystore. The web build has none, so it keeps them in memory only: a
 * page reload signs out, which is the safe default for a browser (docs/web.md explains why).
 */
export function createDeviceStore(): StaffStore {
  return createStaffStore(
    Platform.OS === 'web'
      ? memoryKeyValue()
      : {
          getItemAsync: (k) => SecureStore.getItemAsync(k),
          setItemAsync: (k, v) =>
            SecureStore.setItemAsync(k, v, {
              keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
            }),
          deleteItemAsync: (k) => SecureStore.deleteItemAsync(k),
        },
  );
}
