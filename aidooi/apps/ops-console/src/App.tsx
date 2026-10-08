import type { Api, SessionStore } from '@aidooi/api-client';
import type { Locale } from '@aidooi/i18n';
import { ApiProvider, AuthProvider, LocaleProvider, ToastProvider } from '@aidooi/ui-web';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { SignedOutBus } from './lib/api.ts';
import { buildRouter } from './router.tsx';

export interface AppProps {
  readonly api: Api;
  readonly store: SessionStore;
  readonly bus: SignedOutBus;
  readonly history?: RouterHistory;
  readonly locale?: Locale;
  readonly queryClient?: QueryClient;
}

/** Providers outermost first (docs/web.md): locale → auth → api → toasts → router. */
export function App({ api, store, bus, history, locale = 'en', queryClient }: AppProps) {
  const [current, setCurrent] = useState<Locale>(locale);
  const router = useMemo(
    () => buildRouter({ bus, ...(history ? { history } : {}) }),
    [bus, history],
  );
  return (
    <LocaleProvider locale={current} onLocaleChange={setCurrent}>
      <AuthProvider store={store}>
        <ApiProvider api={api} {...(queryClient ? { client: queryClient } : {})}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </ApiProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
