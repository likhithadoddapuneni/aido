import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { ApiProblem, NetworkError } from '@aidooi/api-client';
import type { Locale } from '@aidooi/i18n';
import { LocaleProvider, ThemeProvider, ToastProvider, applyLocale } from '@aidooi/ui-native';
import { AuthProvider, type AuthDeps } from '../session/auth.tsx';
import { createDeviceStore } from '../session/secure.ts';
import { uuid } from '../session/ids.ts';

const LOCALE_KEY = 'aidooi.seller.locale';

interface LanguageControl {
  readonly locale: Locale;
  /** Switch language. Native layout direction only changes after a reload; `needsReload` says when. */
  setLanguage(next: Locale): { needsReload: boolean };
}
const LanguageContext = createContext<LanguageControl | null>(null);

export const useLanguage = (): LanguageControl => {
  const v = useContext(LanguageContext);
  if (!v) throw new Error('useLanguage must be used inside <AppProviders>');
  return v;
};

/** Never retry a refusal (4xx): it would be refused again. Retry a lost connection a couple of times, gently. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiProblem) return error.retryable && failureCount < 2;
  if (error instanceof NetworkError) return failureCount < 2;
  return false;
}

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 5_000, refetchOnReconnect: true },
      mutations: { retry: false },
    },
  });

export interface LocalePersistence {
  load(): Promise<Locale | null>;
  save(l: Locale): Promise<void>;
}

const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  process.env['EXPO_PUBLIC_API_URL'] ??
  'http://localhost:3000';

export function defaultAuthDeps(): AuthDeps {
  return {
    baseUrl: API_URL,
    store: createDeviceStore(),
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    uuid,
  };
}

export function AppProviders({
  auth,
  initialLocale = 'en',
  persistence,
  safeAreaMetrics,
  children,
}: {
  auth: AuthDeps;
  initialLocale?: Locale;
  persistence?: LocalePersistence;
  /** Fixed screen metrics, for tests (a device measures its own). */
  safeAreaMetrics?: Metrics;
  children: ReactNode;
}) {
  const [client] = useState(createQueryClient);
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    let live = true;
    void persistence?.load().then((saved) => {
      if (live && saved) {
        setLocale(saved);
        applyLocale(saved);
      }
    });
    return () => {
      live = false;
    };
  }, [persistence]);

  const setLanguage = useCallback(
    (next: Locale) => {
      setLocale(next);
      void persistence?.save(next);
      return applyLocale(next);
    },
    [persistence],
  );
  const language = useMemo(() => ({ locale, setLanguage }), [locale, setLanguage]);

  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider {...(safeAreaMetrics ? { initialMetrics: safeAreaMetrics } : {})}>
        <ThemeProvider>
          <LocaleProvider locale={locale}>
            <LanguageContext.Provider value={language}>
              <ToastProvider>
                <AuthProvider deps={auth}>{children}</AuthProvider>
              </ToastProvider>
            </LanguageContext.Provider>
          </LocaleProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

export { LOCALE_KEY };
