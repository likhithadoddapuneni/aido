import type { Session, SessionStore } from '@aidooi/api-client';

/** The subset of `expo-secure-store` we use, so the store is testable without a device. */
export interface KeyValue {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface StaffProfile {
  readonly id: string;
  readonly role: string;
  readonly partnerId: string;
  readonly email: string;
}

interface Saved {
  readonly session: Session;
  readonly staff: StaffProfile;
}

export const AUTH_KEY = 'aidooi.seller.auth.v1';

export interface StaffStore extends SessionStore {
  readStaff(): Promise<StaffProfile | null>;
  /** Begin a login: session and profile land together or not at all. */
  startLogin(session: Session, staff: StaffProfile): Promise<void>;
}

/**
 * The login lives in ONE secure-store item, written whole. The refresh token is single-use: if a
 * rotation wrote the new token and lost the profile (or the reverse), the user would be signed out.
 * Writes are also serialised, so a refresh in flight can never overwrite a newer write with older data.
 */
export function createStaffStore(kv: KeyValue): StaffStore {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };

  const load = async (): Promise<Saved | null> => {
    const raw = await kv.getItemAsync(AUTH_KEY);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as Saved;
      return v?.session && v?.staff ? v : null;
    } catch {
      // A corrupt item is no login at all; never crash start-up on it.
      await kv.deleteItemAsync(AUTH_KEY);
      return null;
    }
  };

  return {
    read: () => serial(async () => (await load())?.session ?? null),
    readStaff: () => serial(async () => (await load())?.staff ?? null),
    write: (session) =>
      serial(async () => {
        if (session === null) return kv.deleteItemAsync(AUTH_KEY);
        const current = await load();
        // A refresh can only replace an existing login; it must not conjure one after sign-out.
        if (!current) return;
        await kv.setItemAsync(AUTH_KEY, JSON.stringify({ session, staff: current.staff }));
      }),
    startLogin: (session, staff) =>
      serial(() => kv.setItemAsync(AUTH_KEY, JSON.stringify({ session, staff }))),
  };
}

/** A non-persistent store, for the web build (which has no secure enclave) and for tests. */
export function memoryKeyValue(): KeyValue {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => void m.set(k, v),
    deleteItemAsync: async (k) => void m.delete(k),
  };
}
