import { AppShell, useAuth, useApi, type NavSection } from '@aidooi/ui-web';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useCopy, type CatalogueKey } from '../lib/i18n.ts';
import { can, type Capability } from '../lib/roles.ts';
import { useMe } from './Me.tsx';

interface NavDef {
  id: string;
  label: CatalogueKey;
  href: string;
  cap: Capability;
}
const SECTIONS: readonly { id: string; label?: CatalogueKey; items: readonly NavDef[] }[] = [
  {
    id: 'main',
    items: [{ id: 'overview', label: 'nav.overview', href: '/', cap: 'overview' }],
  },
  {
    id: 'catalogue',
    label: 'nav.sectionCatalogue',
    items: [
      { id: 'partners', label: 'nav.partners', href: '/partners', cap: 'partners.read' },
      { id: 'products', label: 'nav.products', href: '/products', cap: 'products.read' },
      { id: 'maps', label: 'nav.maps', href: '/compat-maps', cap: 'maps.read' },
    ],
  },
  {
    id: 'desk',
    label: 'nav.sectionDesk',
    items: [
      { id: 'orders', label: 'nav.orders', href: '/orders', cap: 'desk.read' },
      { id: 'viewings', label: 'nav.viewings', href: '/viewings', cap: 'desk.read' },
      { id: 'issues', label: 'nav.issues', href: '/issues', cap: 'issues' },
    ],
  },
  {
    id: 'finance',
    label: 'nav.sectionFinance',
    items: [
      { id: 'settlement', label: 'nav.settlement', href: '/settlement', cap: 'settlement.read' },
    ],
  },
  {
    id: 'platform',
    label: 'nav.sectionPlatform',
    items: [
      { id: 'staff', label: 'nav.staff', href: '/staff', cap: 'staff' },
      { id: 'audit', label: 'nav.audit', href: '/audit', cap: 'audit' },
      { id: 'flags', label: 'nav.flags', href: '/flags', cap: 'flags' },
    ],
  },
];

/** The signed-in frame: navigation shows only what this role may use. */
export function Shell() {
  const copy = useCopy();
  const me = useMe();
  const auth = useAuth();
  const api = useApi();
  const queries = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const isCurrent = (href: string) =>
    href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
  const sections: NavSection[] = SECTIONS.map((s) => ({
    id: s.id,
    ...(s.label ? { label: copy.t(s.label) } : {}),
    items: s.items
      .filter((i) => can(me.role, i.cap))
      .map((i) => ({ id: i.id, label: copy.t(i.label), href: i.href, current: isCurrent(i.href) })),
  })).filter((s) => s.items.length > 0);

  const signOut = async () => {
    const session = await api.session();
    if (session?.kind === 'user') {
      // Best effort: end the server session too, but never trap someone in the console if it fails.
      await api.http
        .POST('/v1/auth/logout', { body: { refreshToken: session.refreshToken } })
        .catch(() => undefined);
    }
    await auth.signOut();
    queries.clear();
  };

  return (
    <AppShell
      brand={<strong>{copy.t('appName')}</strong>}
      sections={sections}
      user={{ name: me.fullName, detail: `${me.email} · ${copy.label('role', me.role)}` }}
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
