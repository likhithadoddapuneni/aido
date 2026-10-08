import { ApiProblem, NetworkError, createApi, memoryStore } from '@aidooi/api-client';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthProvider,
  LocaleProvider,
  createBrowserSessionStore,
  shouldRetry,
  useApiMutation,
  useAuth,
  useDebounce,
  useLocale,
  useT,
  ApiProvider,
} from '../src/index.ts';
import { renderIn } from './helpers.tsx';

describe('retry policy', () => {
  it('retries only what retrying can fix, at most three times', () => {
    expect(shouldRetry(0, new NetworkError(new Error('x')))).toBe(true);
    expect(shouldRetry(0, new ApiProblem({ status: 503, code: 'x' }))).toBe(true);
    expect(shouldRetry(0, new ApiProblem({ status: 404, code: 'not_found' }))).toBe(false);
    expect(shouldRetry(0, new ApiProblem({ status: 422, code: 'x' }))).toBe(false);
    expect(shouldRetry(0, new ApiProblem({ status: 409, code: 'price_approval_required' }))).toBe(
      false,
    );
    expect(shouldRetry(0, new Error('bug'))).toBe(false);
    expect(shouldRetry(3, new ApiProblem({ status: 503, code: 'x' }))).toBe(false);
  });
});

describe('useApiMutation', () => {
  const wrapper =
    (
      api = createApi({
        baseUrl: 'https://api.test',
        store: memoryStore(),
        fetch: async () => new Response('{}'),
        uuid: () => crypto.randomUUID(),
      }),
    ) =>
    ({ children }: { children: ReactNode }) => (
      <LocaleProvider locale="en">
        <ApiProvider api={api}>{children}</ApiProvider>
      </LocaleProvider>
    );

  it('GATE: an idempotent mutation retries a 503 and a lost response with the SAME key', async () => {
    const keys: (string | undefined)[] = [];
    let n = 0;
    const { result } = renderHook(
      () =>
        useApiMutation(
          async (_: void, ctx) => {
            keys.push(ctx.idempotencyKey);
            n++;
            if (n === 1) throw new NetworkError(new Error('timeout'));
            if (n === 2)
              throw new ApiProblem({ status: 503, code: 'payment_provider_unavailable' });
            return 'paid';
          },
          { idempotent: true, intentRetry: { sleep: async () => undefined } },
        ),
      { wrapper: wrapper() },
    );
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/[0-9a-f-]{36}/);
  });

  it('a non-idempotent mutation gets no key and no automatic retry', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiProblem({ status: 503, code: 'x' }));
    const { result } = renderHook(() => useApiMutation(fn), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]?.[1].idempotencyKey).toBeUndefined();
  });

  it('a business refusal is never retried, even when idempotent', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiProblem({ status: 402, code: 'payment_declined' }));
    const { result } = renderHook(
      () => useApiMutation(fn, { idempotent: true, intentRetry: { sleep: async () => undefined } }),
      { wrapper: wrapper() },
    );
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('session and auth', () => {
  it('the browser store keeps the session in memory, or in sessionStorage when asked — never localStorage', async () => {
    const mem = createBrowserSessionStore({ persist: false });
    await mem.write({ kind: 'user', accessToken: 'a', refreshToken: 'r' });
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);

    const persisted = createBrowserSessionStore({ persist: true, key: 'k' });
    await persisted.write({ kind: 'user', accessToken: 'a', refreshToken: 'r' });
    expect(sessionStorage.getItem('k')).toContain('"refreshToken":"r"');
    expect(localStorage.length).toBe(0);
    // A reload (a new store over the same tab) finds it.
    expect(await createBrowserSessionStore({ persist: true, key: 'k' }).read()).toEqual({
      kind: 'user',
      accessToken: 'a',
      refreshToken: 'r',
    });
    await persisted.write(null);
    expect(sessionStorage.getItem('k')).toBeNull();
  });

  it('survives corrupt or blocked storage', async () => {
    sessionStorage.setItem('bad', '{not json');
    expect(await createBrowserSessionStore({ persist: true, key: 'bad' }).read()).toBeNull();
  });

  it('AuthProvider reflects sign-in and sign-out into the store and the UI', async () => {
    const store = memoryStore();
    function Probe() {
      const a = useAuth();
      return (
        <>
          <output>{a.signedIn ? 'in' : 'out'}</output>
          <button
            onClick={() => void a.signIn({ kind: 'user', accessToken: 'a', refreshToken: 'r' })}
          >
            in
          </button>
          <button onClick={() => void a.signOut()}>out</button>
        </>
      );
    }
    const { user } = renderIn(
      <AuthProvider store={store}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('out');
    await user.click(screen.getByRole('button', { name: 'in' }));
    expect(screen.getByRole('status')).toHaveTextContent('in');
    expect(await store.read()).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'out' }));
    expect(await store.read()).toBeNull();
  });

  it('AuthProvider picks up a session that already exists (a reload)', async () => {
    const store = memoryStore({ kind: 'user', accessToken: 'a', refreshToken: 'r' });
    function Probe() {
      return <output>{useAuth().signedIn ? 'in' : 'out'}</output>;
    }
    renderIn(
      <AuthProvider store={store}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('in'));
  });
});

describe('locale and hooks', () => {
  it('LocaleProvider owns lang and dir; useT formats placeholders in the current language', () => {
    const { result, rerender } = renderHook(() => ({ l: useLocale(), t: useT() }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <LocaleProvider locale="ar">{children}</LocaleProvider>
      ),
    });
    expect(result.current.l.dir).toBe('rtl');
    expect(result.current.t.fmt('selectedCount', { n: 3 })).toBe('تم تحديد 3');
    expect(document.documentElement.dir).toBe('rtl');
    rerender();
  });

  it('useLocale outside a provider is a loud error, not a silent default', () => {
    expect(() => renderHook(() => useLocale())).toThrow(/LocaleProvider/);
  });

  it('useDebounce settles after the delay and restarts on each change', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'ab' });
    act(() => void vi.advanceTimersByTime(200));
    rerender({ v: 'abc' });
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current).toBe('a');
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBe('abc');
    vi.useRealTimers();
  });
});
