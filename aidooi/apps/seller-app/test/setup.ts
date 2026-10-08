/* Native modules have no device here; each is replaced by the smallest honest stand-in. */
jest.mock('expo-secure-store', () => {
  const m = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: async (k: string) => m.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void m.set(k, v),
    deleteItemAsync: async (k: string) => void m.delete(k),
  };
});

jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
});

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: () => undefined })),
}));

jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(async () => undefined) }));

jest.mock('expo-device', () => ({ isDevice: true }));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-token-0001]' })),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: () => undefined })),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///proof.jpg', mimeType: 'image/jpeg' }],
  })),
}));

jest.mock('expo-camera', () => {
  const { View } = jest.requireActual('react-native');
  const perm = { granted: true, canAskAgain: true };
  return {
    CameraView: View,
    useCameraPermissions: jest.fn(() => [perm, jest.fn(async () => perm)]),
  };
});

jest.mock('expo-linking', () => ({ getInitialURL: jest.fn(async () => null) }));

// Routing is exercised by the framework; screens only need to navigate and read params. Tests reach the
// same router object through `useRouter()`.
jest.mock('expo-router', () => {
  const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    Stack: () => null,
    Tabs: Object.assign(() => null, { Screen: () => null }),
  };
});
