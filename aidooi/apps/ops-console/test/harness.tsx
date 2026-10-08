import { createApi, memoryStore, type Api, type SessionStore } from '@aidooi/api-client';
import type { Locale } from '@aidooi/i18n';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryHistory } from '@tanstack/react-router';
import { expect } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '../src/App.tsx';
import { createSignedOutBus } from '../src/lib/api.ts';
import type { OpsRole } from '../src/lib/roles.ts';

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

export const ME_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export const meFor = (role: OpsRole | 'seller_owner') =>
  role === 'seller_owner'
    ? {
        kind: 'seller',
        id: ME_ID,
        email: 's@seller.test',
        fullName: 'Sara',
        role,
        partnerId: ME_ID,
        locationId: null,
      }
    : { kind: 'ops', id: ME_ID, email: 'olu@aidooi.test', fullName: 'Olu Ops', role };

export const problem = (
  status: number,
  code: string,
  errors?: { path: string; message: string }[],
): Reply => ({ status, body: { status, code, detail: code, ...(errors ? { errors } : {}) } });

/**
 * A fake API keyed by "METHOD /path". Anything not routed answers 404 and is recorded, so a screen calling
 * an endpoint the test did not expect fails loudly instead of hanging.
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
  return {
    fetch: fetchImpl as typeof fetch,
    calls,
    unrouted,
    /** Calls made to one endpoint, in order. */
    to: (method: string, path: string) =>
      calls.filter((c) => c.method === method && c.path === path),
  };
}

export interface ConsoleOptions {
  path?: string;
  role?: OpsRole | 'seller_owner';
  locale?: Locale;
  routes?: Routes;
  signedIn?: boolean;
}

export function renderConsole(opts: ConsoleOptions = {}) {
  const role = opts.role ?? 'ops_admin';
  const be = backend({ 'GET /v1/me': { body: meFor(role) }, ...opts.routes });
  const store: SessionStore = memoryStore(
    opts.signedIn === false ? null : { kind: 'user', accessToken: 'a', refreshToken: 'r' },
  );
  const bus = createSignedOutBus();
  const api: Api = createApi({
    baseUrl: 'http://localhost',
    store,
    fetch: be.fetch,
    onSignedOut: bus.emit,
    uuid: () => crypto.randomUUID(),
  });
  const history = createMemoryHistory({ initialEntries: [opts.path ?? '/'] });
  const user = userEvent.setup();
  const view = render(
    <App api={api} store={store} bus={bus} history={history} locale={opts.locale ?? 'en'} />,
  );
  return { user, store, history, ...be, ...view };
}

/** Fails with each violation's rule and a pointer to the element, not an opaque object diff. */
export async function expectNoViolations(el: Element): Promise<void> {
  const { violations } = await axe(el, { rules: { region: { enabled: false } } });
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ')})`)).toEqual([]);
}

/** The links in the main navigation, by visible text. */
export function navLabels(): string[] {
  const nav = screen.getByRole('navigation');
  return within(nav)
    .getAllByRole('link')
    .map((a) => a.textContent ?? '');
}
