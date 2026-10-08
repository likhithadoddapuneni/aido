import type { Session, SessionStore } from '@aidooi/api-client';
import type { KeyValueStore } from '../storage/index.ts';

const KEY = 'aidooi.session.v1';

export interface ObservableSessionStore extends SessionStore {
  /** Called after every change, including changes made by the API client's own token refresh. */
  subscribe(listener: (s: Session | null) => void): () => void;
}

const parse = (raw: string | null): Session | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Record<string, unknown>>;
    if (v['kind'] === 'guest' && typeof v['guestToken'] === 'string') {
      return { kind: 'guest', guestToken: v['guestToken'] };
    }
    if (
      v['kind'] === 'user' &&
      typeof v['accessToken'] === 'string' &&
      typeof v['refreshToken'] === 'string'
    ) {
      return { kind: 'user', accessToken: v['accessToken'], refreshToken: v['refreshToken'] };
    }
  } catch {
    /* a corrupt value is treated as no session */
  }
  return null;
};

/**
 * The session as ONE key written in ONE call. The refresh token is single-use, so access and refresh
 * must never be stored separately: a crash between two writes would leave a refresh token the server
 * has already spent, and the next refresh would look like theft and end the login.
 */
export function createSessionStore(kv: KeyValueStore): ObservableSessionStore {
  const listeners = new Set<(s: Session | null) => void>();
  let queue: Promise<unknown> = Promise.resolve();
  return {
    read: async () => parse(await kv.get(KEY)),
    // Writes are serialised so two near-simultaneous writes cannot land out of order.
    write(session) {
      const run = queue.then(async () => {
        if (session) await kv.set(KEY, JSON.stringify(session));
        else await kv.remove(KEY);
        for (const l of listeners) l(session);
      });
      queue = run.catch(() => undefined);
      return run;
    },
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}
