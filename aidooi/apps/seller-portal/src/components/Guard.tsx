import { EmptyState } from '@aidooi/ui-web';
import type { ReactNode } from 'react';
import { useS } from '../i18n/index.tsx';
import { useMe } from '../lib/me.tsx';
import { can, type Action } from '../lib/permissions.ts';

/** A screen for people who may use it. Anyone else sees why not, rather than a button the API would refuse. */
export function Guard({ action, children }: { action: Action; children: ReactNode }) {
  const s = useS();
  const me = useMe();
  if (!me.data) return null;
  if (!can(me.data.role, action))
    return <EmptyState title={s.noAccessTitle} description={s.noAccessText} />;
  return <>{children}</>;
}
