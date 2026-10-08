/* Native modules and the router do not exist under Jest; replace them once, here. */
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockParams: { current: Record<string, string> } = { current: {} };
(globalThis as Record<string, unknown>)['__mockRouter'] = mockRouter;
(globalThis as Record<string, unknown>)['__mockParams'] = mockParams;

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
  Redirect: ({ href }: { href: string }) => {
    mockRouter.replace(href);
    return null;
  },
  Stack: () => null,
  Tabs: Object.assign(() => null, { Screen: () => null }),
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(async () => undefined) }));

const mockBrowser = {
  openAuthSessionAsync: jest.fn(async () => ({ type: 'dismiss' })),
  openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })),
};
(globalThis as Record<string, unknown>)['__mockBrowser'] = mockBrowser;
jest.mock('expo-web-browser', () => (globalThis as Record<string, unknown>)['__mockBrowser']);
jest.mock('expo-brightness', () => ({
  getBrightnessAsync: jest.fn(async () => 0.4),
  setBrightnessAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: 'device-push-token-1' })),
}));
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  };
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: unknown }) => (
      <actual.SafeAreaProvider initialMetrics={metrics}>
        {children as never}
      </actual.SafeAreaProvider>
    ),
  };
});

beforeEach(() => {
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
  mockParams.current = {};
  mockBrowser.openAuthSessionAsync.mockClear();
  mockBrowser.openBrowserAsync.mockClear();
});
