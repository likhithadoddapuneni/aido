import type { Api, SessionStore } from '@aidooi/api-client';
import type { Locale } from '@aidooi/i18n';
import {
  ApiProvider,
  AuthProvider,
  LocaleProvider,
  ToastProvider,
  createQueryClient,
  useAuth,
} from '@aidooi/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { RouterProvider, createRouter, type RouterHistory } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import type { SignedOutBus } from './lib/bus.ts';
import { readLocale, writeLocale } from './lib/locale-pref.ts';
import { routeTree } from './router.tsx';

export interface AppProps {
  readonly store: SessionStore;
  readonly api: Api;
  readonly signedOut: SignedOutBus;
  readonly history?: RouterHistory;
  readonly initialLocale?: Locale;
}

/** When the API gives up on the session, clear everything that belongs to the previous user. */
function SessionEnd({ bus }: { bus: SignedOutBus }) {
  const auth = useAuth();
  const queries = useQueryClient();
  useEffect(
    () =>
      bus.subscribe(() => {
        queries.clear();
        void auth.signOut();
      }),
    [bus, auth, queries],
  );
  return null;
}

export function App({ store, api, signedOut, history, initialLocale }: AppProps) {
  const [locale, setLocale] = useState<Locale>(initialLocale ?? readLocale());
  const client = useMemo(createQueryClient, []);
  const router = useMemo(
    () =>
      createRouter({
        routeTree,
        context: { store },
        ...(history ? { history } : {}),
        defaultPreload: false,
      }),
    [store, history],
  );
  return (
    <LocaleProvider
      locale={locale}
      onLocaleChange={(l) => {
        writeLocale(l);
        setLocale(l);
      }}
    >
      <AuthProvider store={store}>
        <ApiProvider api={api} client={client}>
          <ToastProvider>
            <SessionEnd bus={signedOut} />
            <RouterProvider router={router} />
          </ToastProvider>
        </ApiProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
