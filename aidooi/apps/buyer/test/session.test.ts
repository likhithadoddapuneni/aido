import { createPendingActions } from '../src/session/pendingAction.ts';
import { createSessionStore } from '../src/session/sessionStore.ts';
import { memoryKv, type KeyValueStore } from '../src/storage/index.ts';

describe('session store', () => {
  it('keeps the whole session under ONE key written in ONE call (the refresh token is single-use)', async () => {
    const writes: [string, string][] = [];
    const base = memoryKv();
    const kv: KeyValueStore = {
      ...base,
      set: async (k, v) => (writes.push([k, v]), base.set(k, v)),
    };
    const store = createSessionStore(kv);
    await store.write({ kind: 'user', accessToken: 'A', refreshToken: 'R' });
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]![1])).toEqual({
      kind: 'user',
      accessToken: 'A',
      refreshToken: 'R',
    });
    expect(await store.read()).toEqual({ kind: 'user', accessToken: 'A', refreshToken: 'R' });
  });

  it('guest → user replaces the session; sign-out clears it', async () => {
    const store = createSessionStore(memoryKv());
    await store.write({ kind: 'guest', guestToken: 'G' });
    expect(await store.read()).toEqual({ kind: 'guest', guestToken: 'G' });
    await store.write({ kind: 'user', accessToken: 'A', refreshToken: 'R' });
    expect((await store.read())?.kind).toBe('user');
    await store.write(null);
    expect(await store.read()).toBeNull();
  });

  it('serialises concurrent writes so the last one wins in order', async () => {
    const base = memoryKv();
    let slow = true;
    const kv: KeyValueStore = {
      ...base,
      set: async (k, v) => {
        if (slow) await new Promise((r) => setTimeout(r, 30));
        slow = false;
        return base.set(k, v);
      },
    };
    const store = createSessionStore(kv);
    await Promise.all([
      store.write({ kind: 'user', accessToken: 'A1', refreshToken: 'R1' }),
      store.write({ kind: 'user', accessToken: 'A2', refreshToken: 'R2' }),
    ]);
    expect(await store.read()).toEqual({ kind: 'user', accessToken: 'A2', refreshToken: 'R2' });
  });

  it('notifies subscribers of every change, including ones the API client makes while refreshing', async () => {
    const store = createSessionStore(memoryKv());
    const seen: unknown[] = [];
    const off = store.subscribe((s) => seen.push(s?.kind ?? null));
    await store.write({ kind: 'guest', guestToken: 'G' });
    await store.write({ kind: 'user', accessToken: 'A', refreshToken: 'R' });
    off();
    await store.write(null);
    expect(seen).toEqual(['guest', 'user']);
  });

  it('treats a corrupt or foreign value as no session, never as a crash', async () => {
    for (const raw of [
      'not json',
      '{"kind":"user"}',
      '{"kind":"admin","accessToken":"x","refreshToken":"y"}',
      '[]',
    ]) {
      const store = createSessionStore(memoryKv({ 'aidooi.session.v1': raw }));
      expect(await store.read()).toBeNull();
    }
  });
});

describe('pending action (resume after sign-in, gap #13)', () => {
  it('is used once', async () => {
    const p = createPendingActions(memoryKv());
    await p.save('/checkout/abc');
    expect(await p.peek()).toBe('/checkout/abc');
    expect(await p.consume()).toBe('/checkout/abc');
    expect(await p.consume()).toBeNull();
  });

  it('only ever remembers in-app routes: an attacker cannot turn sign-in into an open redirect', async () => {
    const p = createPendingActions(memoryKv());
    for (const bad of [
      'https://evil.example',
      '//evil.example/x',
      'javascript:alert(1)',
      'aidooi://x',
    ]) {
      await p.save(bad);
      expect(await p.consume()).toBeNull();
    }
  });

  it('ignores a corrupted value', async () => {
    const p = createPendingActions(memoryKv({ 'aidooi.pending-action.v1': '{"href":42}' }));
    expect(await p.consume()).toBeNull();
  });
});
