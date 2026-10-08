import createClient, { type Client } from 'openapi-fetch';
import type { paths } from './generated/schema.d.ts';
import { NetworkError, problemFrom } from './problem.ts';
import { authorizationHeader, type Session, type SessionStore } from './session.ts';

export interface ApiOptions {
  readonly baseUrl: string;
  readonly store: SessionStore;
  /** Sent as `x-app-version`; the server answers 426 to builds it no longer supports. */
  readonly appVersion?: string;
  /** Called once when the session can no longer be recovered (refresh rejected, guest token invalid). */
  readonly onSignedOut?: () => void;
  readonly fetch?: typeof fetch;
  /** UUID source. React Native has no `crypto.randomUUID`; the app passes `expo-crypto`'s. */
  readonly uuid?: () => string;
}

export interface Api {
  readonly http: Client<paths>;
  /** Current session, for the UI's own use. */
  session(): Promise<Session | null>;
  /** Start (or replace) a session, e.g. after OTP verification. */
  setSession(s: Session | null): Promise<void>;
  uuid(): string;
}

const defaultUuid = () => globalThis.crypto.randomUUID();

/**
 * One client for every app. What it does that no screen should do by hand:
 *
 *  - attaches the session, a correlation id and the app version to every request;
 *  - on an expired access token, refreshes **once** — however many requests failed at the same time —
 *    and replays them. The server treats a refresh token used twice as theft and revokes the whole
 *    login, so concurrent refreshes would sign the user out;
 *  - signs out cleanly when the refresh is refused.
 */
export function createApi(opts: ApiOptions): Api {
  const baseFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const uuid = opts.uuid ?? defaultUuid;
  let refreshing: Promise<Session | null> | null = null;

  async function refresh(stale: Extract<Session, { kind: 'user' }>): Promise<Session | null> {
    // Someone else may have refreshed while we were waiting: use their result instead of spending the token again.
    const now = await opts.store.read();
    if (now?.kind === 'user' && now.refreshToken !== stale.refreshToken) return now;
    if (!now || now.kind !== 'user') return null;

    refreshing ??= (async () => {
      try {
        const res = await baseFetch(`${opts.baseUrl}/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-correlation-id': uuid(),
            ...(opts.appVersion ? { 'x-app-version': opts.appVersion } : {}),
          },
          body: JSON.stringify({ refreshToken: stale.refreshToken }),
        });
        if (res.ok) {
          const t = (await res.json()) as { accessToken: string; refreshToken: string };
          const next: Session = {
            kind: 'user',
            accessToken: t.accessToken,
            refreshToken: t.refreshToken,
          };
          await opts.store.write(next);
          return next;
        }
        if (res.status === 401 || res.status === 400 || res.status === 422) {
          // Refused: the login is over (expired, revoked, or reuse was detected).
          await opts.store.write(null);
          opts.onSignedOut?.();
          return null;
        }
        throw await problemFrom(res); // a server fault: keep the session and let the caller retry later
      } catch (e) {
        if (e instanceof TypeError) throw new NetworkError(e);
        throw e;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  const send = (req: Request, session: Session | null): Promise<Response> => {
    const headers = new Headers(req.headers);
    if (session) headers.set('authorization', authorizationHeader(session));
    if (!headers.has('x-correlation-id')) headers.set('x-correlation-id', uuid());
    if (opts.appVersion) headers.set('x-app-version', opts.appVersion);
    return baseFetch(new Request(req, { headers })).catch((e: unknown) => {
      throw new NetworkError(e);
    });
  };

  const authedFetch = async (request: Request): Promise<Response> => {
    const replay = request.clone(); // the body is consumed by the first attempt
    const session = await opts.store.read();
    const res = await send(request, session);
    if (res.status !== 401 || !session) return res;

    const problem = await problemFrom(res);
    if (session.kind === 'guest') {
      if (problem.code === 'invalid_token') {
        await opts.store.write(null);
        opts.onSignedOut?.();
      }
      return res;
    }
    if (problem.code !== 'invalid_token') return res;
    const fresh = await refresh(session);
    return fresh ? send(replay, fresh) : res;
  };

  return {
    http: createClient<paths>({ baseUrl: opts.baseUrl, fetch: authedFetch }),
    session: () => opts.store.read(),
    setSession: (s) => opts.store.write(s),
    uuid,
  };
}
