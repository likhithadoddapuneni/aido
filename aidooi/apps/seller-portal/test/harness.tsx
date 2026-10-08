import { createApi, memoryStore, type Api, type SessionStore } from '@aidooi/api-client';
import type { Locale } from '@aidooi/i18n';
import { render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryHistory } from '@tanstack/react-router';
import { expect } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '../src/App.tsx';
import { createSignedOutBus } from '../src/lib/bus.ts';

export const LOCALES: Locale[] = ['en', 'ar'];

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
}
export interface Reply {
  readonly status?: number;
  readonly body?: unknown;
}
type Handler = Reply | ((call: Call) => Reply | Promise<Reply>);
export type Routes = Record<string, Handler>;

const ID = '11111111-1111-4111-8111-111111111111';
const PARTNER = '22222222-2222-4222-8222-222222222222';
export const LOCATION_ID = '33333333-3333-4333-8333-333333333333';

export const meFor = (role: string) => ({
  kind: 'seller',
  id: ID,
  email: 'sara@seller.test',
  fullName: 'Sara Seller',
  role,
  partnerId: PARTNER,
  locationId: role === 'seller_staff' ? LOCATION_ID : null,
});

export const problem = (
  status: number,
  code: string,
  errors?: { path: string; message: string }[],
): Reply => ({
  status,
  body: { status, code, detail: code, ...(errors ? { errors } : {}) },
});

/**
 * A fake API keyed by "METHOD /path". Anything not routed answers 404 and is recorded, so a screen
 * calling an endpoint the test did not expect fails loudly instead of hanging.
 */
export function backend(routes: Routes) {
  const calls: Call[] = [];
  const unrouted: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url, 'http://localhost');
    const text = await req.clone().text();
    const call: Call = {
      method: req.method,
      path: url.pathname,
      query: url.searchParams,
      body: text ? (JSON.parse(text) as unknown) : undefined,
    };
    calls.push(call);
    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) {
      unrouted.push(key);
      return Response.json({ status: 404, code: 'not_found' }, { status: 404 });
    }
    const reply = typeof handler === 'function' ? await handler(call) : handler;
    const status = reply.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return Response.json(reply.body ?? {}, { status });
  };
  return { fetch: fetchImpl as typeof fetch, calls, unrouted };
}

export interface PortalOptions {
  path?: string;
  role?: 'seller_owner' | 'seller_manager' | 'seller_staff';
  locale?: Locale;
  routes?: Routes;
  signedIn?: boolean;
}

export function renderPortal(opts: PortalOptions = {}) {
  const role = opts.role ?? 'seller_owner';
  const be = backend({ 'GET /v1/me': { body: meFor(role) }, ...opts.routes });
  const store: SessionStore = memoryStore(
    opts.signedIn === false ? null : { kind: 'user', accessToken: 'a', refreshToken: 'r' },
  );
  const signedOut = createSignedOutBus();
  const api: Api = createApi({
    baseUrl: 'http://localhost',
    store,
    fetch: be.fetch,
    onSignedOut: () => signedOut.emit(),
    uuid: () => crypto.randomUUID(),
  });
  const history = createMemoryHistory({ initialEntries: [opts.path ?? '/'] });
  const user = userEvent.setup();
  const view = render(
    <App
      store={store}
      api={api}
      signedOut={signedOut}
      history={history}
      initialLocale={opts.locale ?? 'en'}
    />,
  );
  return { user, store, history, ...be, ...view };
}

/** Fails with each violation's rule and a pointer to the element, not an opaque object diff. */
export async function expectNoViolations(el: Element): Promise<void> {
  const { violations } = await axe(el, { rules: { region: { enabled: false } } });
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ')})`)).toEqual([]);
}
