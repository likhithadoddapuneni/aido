import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { createApi, type Api } from '@aidooi/api-client';
import type { ObservableSessionStore } from '../session/sessionStore.ts';

export const API_BASE_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export function createBuyerApi(opts: {
  store: ObservableSessionStore;
  onSignedOut: () => void;
  baseUrl?: string;
  fetch?: typeof fetch;
  appVersion?: string;
}): Api {
  return createApi({
    baseUrl: opts.baseUrl ?? API_BASE_URL,
    store: opts.store,
    appVersion: opts.appVersion ?? Constants.expoConfig?.version ?? '0.0.0',
    onSignedOut: opts.onSignedOut,
    uuid: randomUUID,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}
