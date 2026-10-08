import { unwrap } from '@aidooi/api-client';
import { ErrorState, Spinner, useApi } from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { useCopy } from '../lib/i18n.ts';
import { can, type Capability } from '../lib/roles.ts';

export interface Me {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: string;
}
const MeContext = createContext<Me | null>(null);

export const useMe = (): Me => {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside <MeGate>');
  return me;
};

/** Does the signed-in person's role allow this? The API still decides; this keeps the UI honest. */
export const useCan = (cap: Capability): boolean => can(useMe().role, cap);

/**
 * Loads who is signed in. A seller account that somehow signed in here is turned away: this console is
 * for AIDOOi staff, and seller staff have their own portal.
 */
export function MeGate({ children, onNotOps }: { children: ReactNode; onNotOps: () => void }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: () => unwrap(api.http.GET('/v1/me')),
    staleTime: 60_000,
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const me = q.data;
  if (me.kind !== 'ops') {
    onNotOps();
    return null;
  }
  return <MeContext value={me}>{children}</MeContext>;
}

/** Wrap a screen: people whose role cannot use it see why, instead of a screen full of refused requests. */
export function Guard({ cap, children }: { cap: Capability; children: ReactNode }) {
  const allowed = useCan(cap);
  const copy = useCopy();
  if (allowed) return <>{children}</>;
  return (
    <div className="ui-state" role="alert">
      <h1 className="ui-state__title">{copy.t('forbiddenTitle')}</h1>
      <p className="ui-state__text">{copy.t('forbiddenBody')}</p>
    </div>
  );
}
