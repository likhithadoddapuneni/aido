import { LOCALES, type Locale } from '@aidooi/i18n';
import { useId, useState, type ReactNode } from 'react';
import { cx } from '../cx.ts';
import { useLocale, useT } from '../locale.tsx';
import { Button } from './Button.tsx';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  current?: boolean;
}
export interface NavSection {
  id: string;
  label?: string;
  items: readonly NavItem[];
}

const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', ar: 'العربية' };

export interface AppShellProps {
  brand: ReactNode;
  sections: readonly NavSection[];
  user: { name: string; detail?: string };
  onSignOut: () => void;
  children: ReactNode;
  /** Plug the app's router link in here so navigation stays client-side. Defaults to a plain anchor. */
  renderLink?: (item: NavItem, props: { className: string; 'aria-current'?: 'page' }) => ReactNode;
}

/** Skip link, collapsible sidebar, language switch, account menu, and a focusable main landmark. */
export function AppShell({
  brand,
  sections,
  user,
  onSignOut,
  children,
  renderLink,
}: AppShellProps) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const navId = useId();
  const menuId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const link = (item: NavItem) => {
    const props = {
      className: cx('ui-nav__link', item.current && 'is-current'),
      ...(item.current ? { 'aria-current': 'page' as const } : {}),
    };
    return renderLink ? (
      renderLink(item, props)
    ) : (
      <a href={item.href} {...props}>
        {item.label}
      </a>
    );
  };

  return (
    <div className="ui-shell">
      <a className="ui-skip" href="#main-content">
        {t.skipToContent}
      </a>
      <header className="ui-shell__bar">
        <Button
          variant="ghost"
          aria-expanded={!collapsed}
          aria-controls={navId}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? t.expandNav : t.collapseNav}
        </Button>
        <div className="ui-shell__brand">{brand}</div>
        <div className="ui-shell__tools">
          <select
            className="ui-input ui-select ui-shell__lang"
            aria-label={t.language}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l} lang={l}>
                {LANGUAGE_NAMES[l]}
              </option>
            ))}
          </select>
          <div className="ui-menu" onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}>
            <Button
              variant="ghost"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span className="ui-visually-hidden">{t.userMenu}: </span>
              {user.name}
            </Button>
            <div id={menuId} className="ui-menu__panel" hidden={!menuOpen}>
              {user.detail && <p className="ui-menu__detail">{user.detail}</p>}
              <Button variant="ghost" onClick={onSignOut}>
                {t.signOut}
              </Button>
            </div>
          </div>
        </div>
      </header>
      <div className="ui-shell__body">
        <nav id={navId} className="ui-nav" aria-label={t.menu} hidden={collapsed}>
          {sections.map((s) => (
            <div key={s.id} className="ui-nav__section">
              {s.label && <p className="ui-nav__heading">{s.label}</p>}
              <ul>
                {s.items.map((i) => (
                  <li key={i.id}>{link(i)}</li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <main id="main-content" tabIndex={-1} className="ui-shell__main">
          {children}
        </main>
      </div>
    </div>
  );
}
