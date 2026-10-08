import { ApiProblem } from '@aidooi/api-client';
import {
  AppShell,
  Button,
  ErrorState,
  Spinner,
  useApi,
  useAuth,
  type NavItem,
  type NavSection,
} from '@aidooi/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useS } from '../i18n/index.tsx';
import { useMe } from '../lib/me.tsx';
import { can, type Action } from '../lib/permissions.ts';

const NOT_A_SELLER = new ApiProblem({ status: 403, code: 'forbidden' });

/** Checks the session against the store (the source of truth), then the role, then draws the shell. */
export function Layout() {
  const s = useS();
  const auth = useAuth();
  const api = useApi();
  const queries = useQueryClient();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const me = useMe();

  // The store, not React state, is the truth: it is what the API client reads and writes.
  useEffect(() => {
    let live = true;
    void api.session().then((v) => live && setState(v ? 'in' : 'out'));
    return () => {
      live = false;
    };
  }, [api, auth.session]);

  const signOut = async () => {
    const sess = await api.session();
    if (sess?.kind === 'user') {
      // Best effort: revoke the login server-side; the local session ends regardless.
      await api.http
        .POST('/v1/auth/logout', { body: { refreshToken: sess.refreshToken } })
        .catch(() => undefined);
    }
    queries.clear();
    await auth.signOut();
  };

  if (state === 'loading') return <Spinner />;
  if (state === 'out') return <Navigate to="/sign-in" />;
  if (me.isPending) return <Spinner />;
  if (me.isError) {
    const notSeller = (me.error as { notSeller?: boolean }).notSeller === true;
    return (
      <main className="portal-center">
        <ErrorState
          error={notSeller ? NOT_A_SELLER : me.error}
          onRetry={notSeller ? undefined : () => void me.refetch()}
        />
        <Button onClick={() => void signOut()}>{s.signOut}</Button>
      </main>
    );
  }

  const role = me.data.role;
  const entry = (id: string, href: string, label: string, needs?: Action): NavItem[] =>
    needs && !can(role, needs)
      ? []
      : [{ id, href, label, current: href === '/' ? path === '/' : path.startsWith(href) }];

  const sections: NavSection[] = [
    {
      id: 'work',
      items: [
        ...entry('dashboard', '/', s.navDashboard),
        ...entry('orders', '/orders', s.navOrders, 'advanceOrders'),
        ...entry('issues', '/issues', s.navIssues, 'advanceOrders'),
        ...entry('tasks', '/tasks', s.navTasks, 'respondTasks'),
      ],
    },
    {
      id: 'catalogue',
      label: s.navCatalogue,
      items: [
        ...entry('offers', '/offers', s.navOffers),
        ...entry('products', '/products', s.navProducts, 'submitProduct'),
        ...entry('imports', '/imports', s.navImports, 'import'),
      ],
    },
    {
      id: 'business',
      label: s.navBusiness,
      items: [
        ...entry('statements', '/statements', s.navStatements, 'viewStatements'),
        ...entry('performance', '/performance', s.navPerformance, 'viewPerformance'),
        ...entry('showrooms', '/showrooms', s.navShowrooms, 'manageLocations'),
        ...entry('profile', '/profile', s.navProfile, 'editProfile'),
        ...entry('team', '/team', s.navTeam, 'manageTeam'),
      ],
    },
  ].filter((x) => x.items.length > 0);

  return (
    <AppShell
      brand={<strong>{s.appName}</strong>}
      sections={sections}
      user={{ name: me.data.fullName, detail: `${me.data.email} · ${s.roles[role]}` }}
      onSignOut={() => void signOut()}
      renderLink={(item, props) => (
        <Link to={item.href} {...props}>
          {item.label}
        </Link>
      )}
    >
      <Outlet />
    </AppShell>
  );
}
