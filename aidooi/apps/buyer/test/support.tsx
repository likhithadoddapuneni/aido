import type { ReactElement } from 'react';
import { render } from '@testing-library/react-native';
import type { QueryClient } from '@tanstack/react-query';
import { AppProviders, createQueryClient } from '../src/providers/AppProviders.tsx';
import { memoryKv, type KeyValueStore } from '../src/storage/index.ts';

export const router = (
  globalThis as unknown as { __mockRouter: Record<'push' | 'replace' | 'back', jest.Mock> }
).__mockRouter;
export const setParams = (p: Record<string, string>) => {
  (
    globalThis as unknown as { __mockParams: { current: Record<string, string> } }
  ).__mockParams.current = p;
};

export interface Reply {
  readonly status?: number;
  readonly body: unknown;
}
export const problem = (status: number, code: string): Reply => ({
  status,
  body: { code, correlationId: 'corr-1234' },
});

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  /** The query string, with its `?`, or ''. */
  readonly search: string;
  readonly body: unknown;
  /** Request headers, lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
}
export interface FakeApi {
  readonly fetch: typeof fetch;
  readonly calls: RecordedCall[];
  /** Calls whose method matches and whose path starts with `prefix`. */
  called(method: string, prefix: string): RecordedCall[];
}

const toRegex = (template: string): RegExp =>
  new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);

/** A scripted server: `'GET /v1/projects/{id}': () => ({ body })`. Anything unscripted is a loud 501. */
export function fakeApi(routes: Record<string, (call: RecordedCall) => Reply>): FakeApi {
  const table = Object.entries(routes).map(([key, handler]) => {
    const [method = '', template = ''] = key.split(' ');
    return { method, re: toRegex(template), handler };
  });
  const calls: RecordedCall[] = [];
  const fetchFn = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const text = req.method === 'GET' ? '' : await req.clone().text();
    const call: RecordedCall = {
      method: req.method,
      path: url.pathname,
      search: url.search,
      body: text ? JSON.parse(text) : undefined,
      headers: Object.fromEntries(req.headers.entries()),
    };
    calls.push(call);
    const hit = table.find((r) => r.method === call.method && r.re.test(call.path));
    const reply: Reply = hit
      ? hit.handler(call)
      : problem(501, `unscripted: ${call.method} ${call.path}`);
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    fetch: fetchFn,
    calls,
    called: (method, prefix) =>
      calls.filter((c) => c.method === method && c.path.startsWith(prefix)),
  };
}

export const userKv = (extra: Record<string, string> = {}): KeyValueStore =>
  memoryKv({
    'aidooi.session.v1': JSON.stringify({
      kind: 'user',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    }),
    'aidooi.onboarded.v1': '1',
    ...extra,
  });

export const guestKv = (extra: Record<string, string> = {}): KeyValueStore =>
  memoryKv({
    'aidooi.session.v1': JSON.stringify({ kind: 'guest', guestToken: 'guest-token' }),
    'aidooi.onboarded.v1': '1',
    ...extra,
  });

export async function renderApp(
  ui: ReactElement,
  opts: { api?: FakeApi; kv?: KeyValueStore } = {},
): Promise<{ client: QueryClient; api: FakeApi }> {
  const api = opts.api ?? fakeApi({});
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  await render(
    <AppProviders
      fetch={api.fetch}
      baseUrl="http://api.test"
      kv={opts.kv ?? guestKv()}
      queryClient={client}
    >
      {ui}
    </AppProviders>,
  );
  return { client, api };
}
