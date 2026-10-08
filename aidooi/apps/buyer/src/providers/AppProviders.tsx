import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Component } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProblem, NetworkError, type Api, type Session } from '@aidooi/api-client';
import type { Locale } from '@aidooi/i18n';
import {
  ErrorView,
  LocaleProvider,
  ThemeProvider,
  ToastProvider,
  applyLocale,
} from '@aidooi/ui-native';
import { createBuyerApi } from '../api/createApi.ts';
import { discoveryServices, type DiscoveryServices } from '../api/services.ts';
import { createPendingActions, type PendingActions } from '../session/pendingAction.ts';
import { createSessionStore, type ObservableSessionStore } from '../session/sessionStore.ts';
import { platformKv, type KeyValueStore } from '../storage/index.ts';

const LOCALE_KEY = 'aidooi.locale.v1';
const ONBOARDED_KEY = 'aidooi.onboarded.v1';

export interface AppServices {
  readonly api: Api;
  readonly services: DiscoveryServices;
  readonly store: ObservableSessionStore;
  readonly kv: KeyValueStore;
  readonly pending: PendingActions;
}

export interface AppState {
  /** False until the stored session, language and onboarding flag have been read. */
  readonly ready: boolean;
  readonly onboarded: boolean;
  readonly session: Session | null;
  readonly isGuest: boolean;
  readonly locale: Locale;
  setLanguage(next: Locale): Promise<{ needsReload: boolean }>;
  completeOnboarding(): Promise<void>;
  /** Take the tokens a successful sign-in returned. The guest session is upgraded server-side. */
  signInWithTokens(t: { accessToken: string; refreshToken: string }): Promise<void>;
  signOut(): Promise<void>;
}

const ServicesContext = createContext<AppServices | null>(null);
const StateContext = createContext<AppState | null>(null);

export const useServices = (): AppServices => {
  const v = useContext(ServicesContext);
  if (!v) throw new Error('useServices must be used inside <AppProviders>');
  return v;
};
export const useAppState = (): AppState => {
  const v = useContext(StateContext);
  if (!v) throw new Error('useAppState must be used inside <AppProviders>');
  return v;
};

/** Retry only what could succeed on a second try: a dropped connection or a server that said "try again". */
const shouldRetry = (count: number, error: unknown): boolean =>
  count < 2 && ((error instanceof ApiProblem && error.retryable) || error instanceof NetworkError);

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 15_000, refetchOnWindowFocus: false },
    },
  });

export interface AppProvidersProps {
  children: ReactNode;
  /** Tests and the smoke script inject these; the app uses the platform defaults. */
  kv?: KeyValueStore;
  fetch?: typeof fetch;
  baseUrl?: string;
  queryClient?: QueryClient;
  /** Don't call the server on start (UI tests that need no session). */
  skipGuestBootstrap?: boolean;
}

export function AppProviders({
  children,
  kv: kvOverride,
  fetch: fetchOverride,
  baseUrl,
  queryClient,
  skipGuestBootstrap = false,
}: AppProvidersProps) {
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [locale, setLocale] = useState<Locale>('en');
  const [session, setSession] = useState<Session | null>(null);
  const guestInFlight = useRef<Promise<void> | null>(null);
  const ensureGuestRef = useRef<() => Promise<void>>(async () => undefined);

  // Created once per mount: a re-render must never build a second session store or API client.
  const servicesRef = useRef<AppServices | null>(null);
  servicesRef.current ??= (() => {
    const kv = kvOverride ?? platformKv();
    const store = createSessionStore(kv);
    const api = createBuyerApi({
      store,
      onSignedOut: () => void ensureGuestRef.current(),
      ...(fetchOverride ? { fetch: fetchOverride } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    });
    return { api, services: discoveryServices(api), store, kv, pending: createPendingActions(kv) };
  })();
  const services = servicesRef.current;
  const client = useMemo(() => queryClient ?? createQueryClient(), [queryClient]);

  /** Browsing needs no account: make sure there is always a session, a guest one if nothing else. */
  const ensureGuest = useCallback(async () => {
    guestInFlight.current ??= (async () => {
      try {
        if (await services.store.read()) return;
        const g = await services.services.createGuest();
        await services.store.write({ kind: 'guest', guestToken: g.guestToken });
      } finally {
        guestInFlight.current = null;
      }
    })();
    return guestInFlight.current;
  }, [services]);
  ensureGuestRef.current = ensureGuest;

  useEffect(() => {
    const off = services.store.subscribe(setSession);
    let cancelled = false;
    void (async () => {
      const [storedLocale, flag, current] = await Promise.all([
        services.kv.get(LOCALE_KEY),
        services.kv.get(ONBOARDED_KEY),
        services.store.read(),
      ]);
      if (cancelled) return;
      if (storedLocale === 'en' || storedLocale === 'ar') {
        setLocale(storedLocale);
        applyLocale(storedLocale);
      }
      setOnboarded(flag === '1');
      setSession(current);
      if (!current && !skipGuestBootstrap) await ensureGuest().catch(() => undefined);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
      off();
    };
  }, [services, ensureGuest, skipGuestBootstrap]);

  const state = useMemo<AppState>(
    () => ({
      ready,
      onboarded,
      session,
      isGuest: session?.kind !== 'user',
      locale,
      async setLanguage(next) {
        setLocale(next);
        await services.kv.set(LOCALE_KEY, next);
        return applyLocale(next);
      },
      async completeOnboarding() {
        await services.kv.set(ONBOARDED_KEY, '1');
        setOnboarded(true);
      },
      async signInWithTokens(t) {
        await services.store.write({
          kind: 'user',
          accessToken: t.accessToken,
          refreshToken: t.refreshToken,
        });
        client.clear(); // everything cached belonged to the guest session
      },
      async signOut() {
        const s = await services.store.read();
        if (s?.kind === 'user')
          await services.services.logout(s.refreshToken).catch(() => undefined);
        await services.store.write(null);
        client.clear();
        await ensureGuest().catch(() => undefined);
      },
    }),
    [ready, onboarded, session, locale, services, client, ensureGuest],
  );

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <LocaleProvider locale={locale}>
            <ToastProvider>
              <ServicesContext.Provider value={services}>
                <StateContext.Provider value={state}>
                  <QueryClientProvider client={client}>{children}</QueryClientProvider>
                </StateContext.Provider>
              </ServicesContext.Provider>
            </ToastProvider>
          </LocaleProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

/** A render error anywhere shows an apology and a way back, never a white screen. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <ThemeProvider>
        <LocaleProvider locale="en">
          <ErrorView error={this.state.error} onRetry={() => this.setState({ error: null })} />
        </LocaleProvider>
      </ThemeProvider>
    );
  }
}
