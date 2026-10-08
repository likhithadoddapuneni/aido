import { createApi, type Api, type SessionStore } from '@aidooi/api-client';

/** Told when the API client gives up on the session (a refresh was refused), so the UI can sign out. */
export function createSignedOutBus() {
  const listeners = new Set<() => void>();
  return {
    emit: () => listeners.forEach((l) => l()),
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}
export type SignedOutBus = ReturnType<typeof createSignedOutBus>;

export function createConsoleApi(opts: {
  store: SessionStore;
  bus: SignedOutBus;
  baseUrl?: string;
  fetch?: typeof fetch;
  appVersion?: string;
}): Api {
  return createApi({
    baseUrl: opts.baseUrl ?? '',
    store: opts.store,
    appVersion: opts.appVersion ?? '1.0.0',
    onSignedOut: opts.bus.emit,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}
