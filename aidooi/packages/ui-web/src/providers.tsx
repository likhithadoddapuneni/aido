import {
  ApiProblem,
  NetworkError,
  withIntent,
  type Api,
  type Session,
  type SessionStore,
} from '@aidooi/api-client';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** At most three retries, and only when trying again could help: never a 4xx, which would just be refused again. */
export const shouldRetry = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= 3) return false;
  if (error instanceof NetworkError) return true;
  return error instanceof ApiProblem && error.retryable;
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 15_000, refetchOnWindowFocus: false },
      // Mutations are not retried blindly: only `useApiMutation` with an idempotency intent retries, safely.
      mutations: { retry: false },
    },
  });
}

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({
  api,
  client,
  children,
}: {
  api: Api;
  client?: QueryClient;
  children: ReactNode;
}) {
  const [own] = useState(createQueryClient);
  return (
    <ApiContext value={api}>
      <QueryClientProvider client={client ?? own}>{children}</QueryClientProvider>
    </ApiContext>
  );
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}

export interface MutationContext {
  readonly api: Api;
  /** Present when the mutation is `idempotent`: send it as the `Idempotency-Key` header. */
  readonly idempotencyKey: string | undefined;
}

/**
 * A mutation that is safe to retry. With `idempotent: true`, one user action gets ONE key; a dropped
 * connection or a 503 retries with that same key, so the server returns the first outcome instead of
 * acting twice. Without it, there are no automatic retries.
 */
export function useApiMutation<TData, TVars = void>(
  fn: (vars: TVars, ctx: MutationContext) => Promise<TData>,
  options: { idempotent?: boolean; intentRetry?: Parameters<typeof withIntent>[2] } & Omit<
    UseMutationOptions<TData, Error, TVars>,
    'mutationFn'
  > = {},
): UseMutationResult<TData, Error, TVars> {
  const api = useApi();
  const { idempotent = false, intentRetry, ...rest } = options;
  return useMutation<TData, Error, TVars>({
    ...rest,
    mutationFn: (vars) =>
      idempotent
        ? withIntent(api.uuid, (key) => fn(vars, { api, idempotencyKey: key }), intentRetry)
        : fn(vars, { api, idempotencyKey: undefined }),
  });
}

/* ------------------------------ staff session ------------------------------ */

/**
 * A session store for a browser tab. `persist: false` keeps it in memory only (gone on reload).
 * `persist: true` uses sessionStorage: it survives a reload but ends when the tab closes and is not
 * shared with other tabs. localStorage is deliberately NOT offered: it lives forever, is shared across
 * tabs, and any script injected into the origin could read a long-lived staff token from it. Staff
 * sessions are short and end with the working session; mandatory 2FA covers the re-login.
 */
export function createBrowserSessionStore(opts: { persist: boolean; key?: string }): SessionStore {
  const key = opts.key ?? 'aidooi.session';
  let memory: Session | null = null;
  if (opts.persist) {
    try {
      const raw = sessionStorage.getItem(key);
      memory = raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      memory = null;
    }
  }
  return {
    read: async () => memory,
    write: async (s) => {
      memory = s;
      if (!opts.persist) return;
      try {
        if (s) sessionStorage.setItem(key, JSON.stringify(s));
        else sessionStorage.removeItem(key);
      } catch {
        /* storage may be blocked; the in-memory session still works for this page load */
      }
    },
  };
}

interface AuthValue {
  readonly session: Session | null;
  readonly signedIn: boolean;
  signIn(session: Session): Promise<void>;
  signOut(): Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);

/** Mirrors the store into React state. The API client calls `onSignedOut` when a refresh is refused. */
export function AuthProvider({ store, children }: { store: SessionStore; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let live = true;
    void store.read().then((s) => live && setSession(s));
    return () => {
      live = false;
    };
  }, [store]);
  const value = useMemo<AuthValue>(
    () => ({
      session,
      signedIn: session !== null,
      signIn: async (s) => {
        await store.write(s);
        setSession(s);
      },
      signOut: async () => {
        await store.write(null);
        setSession(null);
      },
    }),
    [session, store],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
