import type { SessionStore } from '@aidooi/api-client';
import {
  createRootRouteWithContext,
  createRoute,
  Outlet,
  type createRouter,
} from '@tanstack/react-router';
import { Layout } from './components/Layout.tsx';
import { AcceptInviteScreen } from './screens/AcceptInvite.tsx';
import { DashboardScreen } from './screens/Dashboard.tsx';
import { ImportDetailScreen, ImportsScreen } from './screens/Imports.tsx';
import { IssuesScreen } from './screens/Issues.tsx';
import { NewOfferScreen } from './screens/NewOffer.tsx';
import { OffersScreen } from './screens/Offers.tsx';
import { OrdersScreen } from './screens/Orders.tsx';
import { PerformanceScreen } from './screens/Performance.tsx';
import { ProductsScreen } from './screens/Products.tsx';
import { ProfileScreen } from './screens/Profile.tsx';
import { ShowroomsScreen } from './screens/Showrooms.tsx';
import { SignInScreen } from './screens/SignIn.tsx';
import { StatementDetailScreen, StatementsScreen } from './screens/Statements.tsx';
import { TasksScreen } from './screens/Tasks.tsx';
import { TeamScreen } from './screens/Team.tsx';

export interface RouterContext {
  readonly store: SessionStore;
}

const root = createRootRouteWithContext<RouterContext>()({ component: Outlet });

const signIn = createRoute({
  getParentRoute: () => root,
  path: '/sign-in',
  component: SignInScreen,
});
const acceptInvite = createRoute({
  getParentRoute: () => root,
  path: '/accept-invite',
  component: AcceptInviteScreen,
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s['token'] === 'string' ? s['token'] : '',
  }),
});

/** Everything behind the sign-in: one layout that checks the session and the role. */
const authed = createRoute({ getParentRoute: () => root, id: 'authed', component: Layout });
const at = <P extends string>(path: P, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => authed, path, component });

const dashboard = at('/', DashboardScreen);
const offers = at('/offers', OffersScreen);
const newOffer = at('/offers/new', NewOfferScreen);
const products = at('/products', ProductsScreen);
const imports = at('/imports', ImportsScreen);
const importDetail = createRoute({
  getParentRoute: () => authed,
  path: '/imports/$id',
  component: ImportDetailScreen,
});
const showrooms = at('/showrooms', ShowroomsScreen);
const profile = at('/profile', ProfileScreen);
const orders = at('/orders', OrdersScreen);
const issues = at('/issues', IssuesScreen);
const tasks = at('/tasks', TasksScreen);
const statements = at('/statements', StatementsScreen);
const statementDetail = createRoute({
  getParentRoute: () => authed,
  path: '/statements/$id',
  component: StatementDetailScreen,
});
const team = at('/team', TeamScreen);
const performance = at('/performance', PerformanceScreen);

export const routeTree = root.addChildren([
  signIn,
  acceptInvite,
  authed.addChildren([
    dashboard,
    offers,
    newOffer,
    products,
    imports,
    importDetail,
    showrooms,
    profile,
    orders,
    issues,
    tasks,
    statements,
    statementDetail,
    team,
    performance,
  ]),
]);

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter<typeof routeTree>>;
  }
}
