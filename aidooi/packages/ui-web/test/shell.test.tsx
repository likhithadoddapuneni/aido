import type { Locale } from '@aidooi/i18n';
import { screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider, AppShell, LocaleProvider, useLocale } from '../src/index.ts';
import { LOCALES, renderIn, testApi } from './helpers.tsx';
import { render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

const SECTIONS = [
  {
    id: 's',
    label: 'Catalogue',
    items: [
      { id: 'offers', label: 'Offers', href: '#offers', current: true },
      { id: 'imports', label: 'Imports', href: '#imports' },
    ],
  },
];

describe.each(LOCALES)('AppShell (%s)', (locale) => {
  it('has a skip link to a focusable main landmark as the first tab stop', async () => {
    const { user } = renderIn(
      <AppShell
        brand="AiDOOi"
        sections={SECTIONS}
        user={{ name: 'Layla' }}
        onSignOut={() => undefined}
      >
        content
      </AppShell>,
      locale,
    );
    await user.tab();
    const skip = screen.getByRole('link', {
      name: locale === 'ar' ? 'انتقل إلى المحتوى' : 'Skip to content',
    });
    expect(skip).toHaveFocus();
    await user.keyboard('{Enter}');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('marks the current page, collapses the navigation, and keeps aria-expanded in step', async () => {
    const { user } = renderIn(
      <AppShell
        brand="AiDOOi"
        sections={SECTIONS}
        user={{ name: 'Layla' }}
        onSignOut={() => undefined}
      >
        x
      </AppShell>,
      locale,
    );
    expect(screen.getByRole('link', { name: 'Offers' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Imports' })).not.toHaveAttribute('aria-current');
    const toggle = screen.getByRole('button', {
      name: locale === 'ar' ? 'طيّ قائمة التنقل' : 'Collapse navigation',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('navigation', { hidden: true })).not.toBeVisible();
  });

  it('account menu opens, signs out, and closes with Escape', async () => {
    const onSignOut = vi.fn();
    const { user } = renderIn(
      <AppShell
        brand="AiDOOi"
        sections={SECTIONS}
        user={{ name: 'Layla', detail: 'Marina Living' }}
        onSignOut={onSignOut}
      >
        x
      </AppShell>,
      locale,
    );
    const menu = screen.getByRole('button', { name: /Layla/ });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await user.click(menu);
    await user.click(
      screen.getByRole('button', { name: locale === 'ar' ? 'تسجيل الخروج' : 'Sign out' }),
    );
    expect(onSignOut).toHaveBeenCalled();
  });

  it('accepts the app’s router link so navigation stays client-side', () => {
    renderIn(
      <AppShell
        brand="x"
        sections={SECTIONS}
        user={{ name: 'L' }}
        onSignOut={() => undefined}
        renderLink={(i, p) => (
          <a data-router="1" href={i.href} {...p}>
            {i.label}
          </a>
        )}
      >
        x
      </AppShell>,
      locale,
    );
    expect(document.querySelectorAll('[data-router="1"]')).toHaveLength(2);
  });
});

describe('locale switching', () => {
  it('the shell language select flips document direction and the built-in labels', async () => {
    function App() {
      const [l, setL] = useState<Locale>('en');
      return (
        <LocaleProvider locale={l} onLocaleChange={setL}>
          <ApiProvider api={testApi()}>
            <AppShell
              brand="x"
              sections={SECTIONS}
              user={{ name: 'L' }}
              onSignOut={() => undefined}
            >
              <Probe />
            </AppShell>
          </ApiProvider>
        </LocaleProvider>
      );
    }
    function Probe() {
      return <span data-testid="dir">{useLocale().dir}</span>;
    }
    const user = userEvent.setup();
    render(<App />);
    expect(document.documentElement.dir).toBe('ltr');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(screen.getByTestId('dir')).toHaveTextContent('rtl');
    expect(screen.getByRole('link', { name: 'انتقل إلى المحتوى' })).toBeInTheDocument();
  });
});
