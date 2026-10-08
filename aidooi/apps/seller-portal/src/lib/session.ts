import { createApi, type Api, type SessionStore } from '@aidooi/api-client';
import { createBrowserSessionStore } from '@aidooi/ui-web';

/**
 * Staff sessions live in `sessionStorage` (per tab, gone when the tab closes), never `localStorage`:
 * see docs/web.md. Mandatory two-step sign-in makes the re-login cheap.
 */
export const sessionStore = (): SessionStore => createBrowserSessionStore({ persist: true });

export function createPortalApi(opts: {
  store: SessionStore;
  baseUrl?: string;
  onSignedOut: () => void;
  fetch?: typeof fetch;
}): Api {
  return createApi({
    baseUrl: opts.baseUrl ?? '',
    store: opts.store,
    appVersion: '1.0.0',
    onSignedOut: opts.onSignedOut,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}
