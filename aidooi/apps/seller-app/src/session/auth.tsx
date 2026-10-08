import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createApi, type Api, type Session } from '@aidooi/api-client';
import { createSellerData, type SellerData } from '../data/seller.ts';
import { capabilitiesForClaim, type Capabilities } from '../domain/roles.ts';
import type { StaffProfile, StaffStore } from './store.ts';

export interface AuthDeps {
  readonly baseUrl: string;
  readonly store: StaffStore;
  readonly appVersion: string;
  readonly uuid: () => string;
  readonly fetch?: typeof fetch;
}

type Status = 'loading' | 'signedOut' | 'signedIn';

export interface AuthValue {
  readonly status: Status;
  readonly staff: StaffProfile | null;
  readonly caps: Capabilities;
  readonly api: Api;
  readonly data: SellerData;
  /** Finish a sign-in with the tokens a login / MFA verification returned. */
  completeSignIn(
    tokens: { accessToken: string; refreshToken: string },
    staff: { id: string; role: string; partnerId: string },
    email: string,
  ): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export const useAuth = (): AuthValue => {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
};

const NO_CAPS = capabilitiesForClaim('seller_staff');

export function AuthProvider({ deps, children }: { deps: AuthDeps; children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  // The API is created once. It tells us when the login is gone (refresh refused) so the UI follows.
  const api = useMemo(
    () =>
      createApi({
        baseUrl: deps.baseUrl,
        store: deps.store,
        appVersion: deps.appVersion,
        uuid: deps.uuid,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        onSignedOut: () => {
          setStaff(null);
          setStatus('signedOut');
        },
      }),
    // One client per app run: the deps are stable by construction.
    [],
  );
  const data = useMemo(() => createSellerData(api), [api]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [session, profile] = await Promise.all([deps.store.read(), deps.store.readStaff()]);
      if (!live) return;
      if (session && profile) {
        setStaff(profile);
        setStatus('signedIn');
      } else {
        setStatus('signedOut');
      }
    })();
    return () => {
      live = false;
    };
  }, [deps.store]);

  const completeSignIn = useCallback<AuthValue['completeSignIn']>(async (tokens, who, email) => {
    const session: Session = {
      kind: 'user',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
    const profile: StaffProfile = { id: who.id, role: who.role, partnerId: who.partnerId, email };
    await depsRef.current.store.startLogin(session, profile);
    setStaff(profile);
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    const session = await depsRef.current.store.read();
    // Revoke on the server first, best effort: the device must be signed out even when offline.
    if (session?.kind === 'user') await data.logout(session.refreshToken).catch(() => undefined);
    await depsRef.current.store.write(null);
    setStaff(null);
    setStatus('signedOut');
  }, [data]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      staff,
      caps: staff ? capabilitiesForClaim(staff.role) : NO_CAPS,
      api,
      data,
      completeSignIn,
      signOut,
    }),
    [status, staff, api, data, completeSignIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
