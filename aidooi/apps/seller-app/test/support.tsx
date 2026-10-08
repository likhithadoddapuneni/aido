import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { createStaffStore, memoryKeyValue, type StaffProfile } from '../src/session/store.ts';
import { AppProviders } from '../src/shell/providers.tsx';
import type { Locale } from '@aidooi/i18n';

export interface FakeRoute {
  (req: {
    method: string;
    url: URL;
    body: unknown;
  }): { status?: number; body: unknown } | undefined;
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const problem = (status: number, code: string, detail = code) => ({
  status,
  body: { type: 'x', title: 'x', status, code, detail, correlationId: 'corr-1' },
});

/** A scripted API. Routes are tried in order; the first that answers wins; calls are recorded. */
export function fakeApi(routes: FakeRoute[]) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const text = await req.clone().text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({
      method: req.method,
      path: url.pathname + url.search,
      body,
      auth: req.headers.get('authorization'),
    });
    for (const r of routes) {
      const out = r({ method: req.method, url, body });
      if (out) return json(out.status ?? 200, out.body);
    }
    return json(404, {
      type: 'x',
      title: 'x',
      status: 404,
      code: 'route_not_found',
      correlationId: 'c',
    });
  };
  return { fetch: fetchImpl, calls };
}

export const route =
  (
    method: string,
    path: string | RegExp,
    reply: (b: unknown, url: URL) => { status?: number; body: unknown },
  ): FakeRoute =>
  (r) =>
    r.method === method &&
    (typeof path === 'string' ? r.url.pathname === path : path.test(r.url.pathname))
      ? reply(r.body, r.url)
      : undefined;

export const STAFF = (role = 'seller_manager'): StaffProfile => ({
  id: '11111111-1111-4111-8111-111111111111',
  role,
  partnerId: '22222222-2222-4222-8222-222222222222',
  email: 'owner@showroom.test',
});

export interface Harness {
  readonly calls: ReturnType<typeof fakeApi>['calls'];
  readonly store: ReturnType<typeof createStaffStore>;
}

/** Render a screen inside the real providers, signed in as `role`, talking to a scripted API. */
export async function renderApp(
  ui: ReactElement,
  opts: { routes?: FakeRoute[]; role?: string; locale?: Locale; signedIn?: boolean } = {},
): Promise<Harness> {
  const { fetch: fetchImpl, calls } = fakeApi(opts.routes ?? []);
  const store = createStaffStore(memoryKeyValue());
  if (opts.signedIn !== false)
    await store.startLogin(
      { kind: 'user', accessToken: 'ACCESS-1', refreshToken: 'REFRESH-1' },
      STAFF(opts.role),
    );
  await render(
    <AppProviders
      auth={{
        baseUrl: 'https://api.test',
        store,
        appVersion: '1.0.0',
        uuid: () => `00000000-0000-4000-8000-${String(Math.random()).slice(2, 14).padEnd(12, '0')}`,
        fetch: fetchImpl,
      }}
      initialLocale={opts.locale ?? 'en'}
      safeAreaMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {ui}
    </AppProviders>,
  );
  // Wait for the stored session to be read, so screens see a signed-in user.
  if (opts.signedIn !== false) await waitFor(() => expect(store).toBeDefined());
  return { calls, store };
}

export { screen, waitFor };
