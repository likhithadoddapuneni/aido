/**
 * What the app holds to prove who it is. A *guest* session has one long-lived token and cannot refresh;
 * a *user* session has a short access token and a single-use refresh token.
 */
export type Session =
  | { readonly kind: 'guest'; readonly guestToken: string }
  | { readonly kind: 'user'; readonly accessToken: string; readonly refreshToken: string };

/**
 * Where the session lives. Mobile apps back this with the OS keychain/keystore (never AsyncStorage),
 * web with memory plus an httpOnly-free fallback chosen by the app. Writes must be atomic: the refresh
 * token is single-use, so losing the new one after the server accepted the old one signs the user out.
 */
export interface SessionStore {
  read(): Promise<Session | null>;
  write(session: Session | null): Promise<void>;
}

export function memoryStore(initial: Session | null = null): SessionStore {
  let current = initial;
  return { read: async () => current, write: async (s) => void (current = s) };
}

export const authorizationHeader = (s: Session): string =>
  s.kind === 'guest' ? `Guest ${s.guestToken}` : `Bearer ${s.accessToken}`;
