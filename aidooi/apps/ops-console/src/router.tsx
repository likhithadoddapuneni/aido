import {
  Outlet,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
  type RouterHistory,
} from '@tanstack/react-router';
import { Spinner, useAuth } from '@aidooi/ui-web';
import { useEffect, useState, type ReactElement } from 'react';
import { useApi } from '@aidooi/ui-web';
import { useCopy } from './lib/i18n.ts';
import { Guard, MeGate } from './shell/Me.tsx';
import { Shell } from './shell/Shell.tsx';
import { AuditScreen } from './screens/Audit.tsx';
import { CompatMapsScreen } from './screens/CompatMaps.tsx';
import { FlagsScreen } from './screens/Flags.tsx';
import { InviteFlow } from './screens/InviteFlow.tsx';
import { IssuesScreen } from './screens/Issues.tsx';
import { OrderDetailScreen, OrdersScreen } from './screens/Orders.tsx';
import { OverviewScreen } from './screens/Overview.tsx';
import { PartnerDetailScreen, PartnersScreen } from './screens/Partners.tsx';
import { ProductDetailScreen, ProductsScreen } from './screens/Products.tsx';
import { SettlementScreen } from './screens/Settlement.tsx';
import { SignIn } from './screens/SignIn.tsx';
import { StaffScreen } from './screens/Staff.tsx';
import { ViewingDetailScreen, ViewingsScreen } from './screens/Viewings.tsx';
import type { SignedOutBus } from './lib/api.ts';

function NotFound() {
  const copy = useCopy();
  return (
    <div className="ui-state">
      <h1 className="ui-state__title">{copy.t('notFoundTitle')}</h1>
      <p className="ui-state__text">{copy.t('notFoundBody')}</p>
    </div>
  );
}

/**
 * The front door. Invitations are public (the person has no session yet); everything else needs a
 * session, and once there is one the staff frame and the role-gated screens render inside it.
 */
function Root({ bus }: { bus: SignedOutBus }) {
  const auth = useAuth();
  const api = useApi();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [booted, setBooted] = useState(false);

  // The session may already be in the store (a reload); the provider reads it asynchronously.
  useEffect(() => {
    let live = true;
    void api.session().then(async (s) => {
      if (live && s && !auth.signedIn) await auth.signIn(s);
      if (live) setBooted(true);
    });
    return () => {
      live = false;
    };
  }, []);
  // The API client gave up on the session (a refresh was refused): sign out in the UI too.
  useEffect(() => bus.subscribe(() => void auth.signOut()), [bus, auth]);

  if (path === '/accept-invite') return <InviteFlow />;
  if (!booted) return <Spinner />;
  if (!auth.signedIn) return <SignIn />;
  return (
    <MeGate onNotOps={() => void auth.signOut()}>
      <Shell />
    </MeGate>
  );
}

export function buildRouter(opts: { bus: SignedOutBus; history?: RouterHistory }) {
  const root = createRootRoute({
    component: () => <Root bus={opts.bus} />,
    notFoundComponent: NotFound,
  });
  const page = (
    path: string,
    cap: Parameters<typeof Guard>[0]['cap'],
    Screen: () => ReactElement,
  ) =>
    createRoute({
      getParentRoute: () => root,
      path,
      component: () => (
        <Guard cap={cap}>
          <Screen />
        </Guard>
      ),
    });

  const routeTree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: '/accept-invite',
      validateSearch: (s: Record<string, unknown>): { token?: string } =>
        typeof s['token'] === 'string' ? { token: s['token'] } : {},
      component: () => <Outlet />,
    }),
    page('/', 'overview', OverviewScreen),
    page('/partners', 'partners.read', PartnersScreen),
    page('/partners/$id', 'partners.read', PartnerDetailScreen),
    page('/products', 'products.read', ProductsScreen),
    page('/products/$id', 'products.read', ProductDetailScreen),
    page('/compat-maps', 'maps.read', CompatMapsScreen),
    page('/orders', 'desk.read', OrdersScreen),
    page('/orders/$id', 'desk.read', OrderDetailScreen),
    page('/viewings', 'desk.read', ViewingsScreen),
    page('/viewings/$id', 'desk.read', ViewingDetailScreen),
    page('/issues', 'issues', IssuesScreen),
    page('/settlement', 'settlement.read', SettlementScreen),
    page('/staff', 'staff', StaffScreen),
    page('/audit', 'audit', AuditScreen),
    page('/flags', 'flags', FlagsScreen),
  ]);
  return createRouter({
    routeTree,
    ...(opts.history ? { history: opts.history } : {}),
    defaultPreload: false,
  });
}

export { createMemoryHistory };
