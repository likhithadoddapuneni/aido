import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ar } from '../src/i18n/ar.ts';
import { en } from '../src/i18n/en.ts';
import * as fx from './fixtures.ts';
import { LOCALES, expectNoViolations, renderPortal, type Routes } from './harness.tsx';

const ok = (body: unknown) => ({ body });

const COMMON: Routes = {
  'GET /v1/seller/locations': ok(fx.locations),
  'GET /v1/seller/offers': ok(fx.offersPage()),
  'GET /v1/seller/products': ok(fx.products),
  'GET /v1/seller/profile': ok(fx.profile),
  'GET /v1/seller/imports': ok(fx.imports),
  [`GET /v1/seller/imports/${fx.importJob.id}`]: ok(fx.importDetail),
  'GET /v1/seller/order-lines': ok(fx.linesPage()),
  'GET /v1/seller/issues': ok(fx.issuesPage),
  'GET /v1/seller/purchase-tasks': ok(fx.purchaseTasks),
  'GET /v1/seller/viewing-tasks': ok(fx.viewingTasks),
  'GET /v1/seller/statements': ok(fx.statementsPage),
  [`GET /v1/seller/statements/${fx.statementsPage.items[0]?.id}`]: ok(fx.statementDetail),
  'GET /v1/seller/team': ok(fx.team),
  'GET /v1/seller/performance': ok(fx.performance),
};

/** Each screen: the route to open, a heading key from the catalogue, and a piece of data that proves it loaded. */
const SCREENS: {
  name: string;
  path: string;
  heading: keyof typeof en;
  data: string | RegExp | { en: string; ar: string };
}[] = [
  { name: 'dashboard', path: '/', heading: 'navDashboard', data: /Sara Seller/ },
  { name: 'offers', path: '/offers', heading: 'navOffers', data: 'Oslo 3-seater sofa' },
  {
    name: 'new offer',
    path: '/offers/new',
    heading: 'newOffer',
    data: { en: en.existingProduct, ar: ar.existingProduct },
  },
  { name: 'products', path: '/products', heading: 'navProducts', data: 'Fjord side table' },
  { name: 'imports', path: '/imports', heading: 'navImports', data: 'catalogue.csv' },
  {
    name: 'import detail',
    path: `/imports/${fx.importJob.id}`,
    heading: 'navImports',
    data: /must be positive/,
  },
  { name: 'showrooms', path: '/showrooms', heading: 'navShowrooms', data: 'Dubai showroom' },
  { name: 'profile', path: '/profile', heading: 'navProfile', data: /Nordic Living/ },
  { name: 'orders', path: '/orders', heading: 'navOrders', data: 'Oslo 3-seater sofa' },
  { name: 'issues', path: '/issues', heading: 'navIssues', data: 'Scratch on the left arm' },
  { name: 'tasks', path: '/tasks', heading: 'navTasks', data: /Oslo 3-seater sofa/ },
  { name: 'statements', path: '/statements', heading: 'navStatements', data: '2026-09' },
  {
    name: 'statement detail',
    path: `/statements/${fx.statementsPage.items[0]?.id}`,
    heading: 'navStatements',
    data: 'TI-1',
  },
  { name: 'team', path: '/team', heading: 'navTeam', data: 'Omar Staff' },
  { name: 'performance', path: '/performance', heading: 'navPerformance', data: /90\W*%/ },
];

describe.each(LOCALES)('every screen renders and is accessible (%s)', (locale) => {
  it.each(SCREENS)('$name', async ({ path, data }) => {
    const { container, unrouted } = renderPortal({ path, locale, routes: COMMON });
    const wanted = typeof data === 'object' && 'en' in data ? data[locale] : data;
    await waitFor(
      () =>
        expect(
          screen.getAllByText(wanted, { exact: typeof wanted === 'string' }).length,
        ).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    expect(unrouted).toEqual([]);
    await expectNoViolations(container);
  });
});

describe('Arabic catalogue', () => {
  it('has no untranslated copy: every value differs from English except proper nouns and units', async () => {
    const { ar } = await import('../src/i18n/ar.ts');
    const flat = (o: object, p = ''): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'string'
          ? [[`${p}${k}`, v] as [string, string]]
          : flat(v as object, `${p}${k}.`),
      );
    const en2 = new Map(flat(en));
    const same = flat(ar).filter(([k, v]) => en2.get(k) === v);
    // `advanceFor` is only placeholders ('{action}: {name}'); there is nothing to translate.
    expect(same.map(([k]) => k).filter((k) => k !== 'advanceFor')).toEqual([]);
  });

  it('uses the same placeholders as English', async () => {
    const { ar } = await import('../src/i18n/ar.ts');
    const holes = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      const e = en[k];
      const a = ar[k];
      if (typeof e === 'string' && typeof a === 'string') expect(holes(a), k).toEqual(holes(e));
    }
  });
});
