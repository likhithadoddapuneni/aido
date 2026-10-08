import { createApi, memoryStore, type Api } from '@aidooi/api-client';
import type { Locale } from '@aidooi/i18n';
import { render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { axe } from 'vitest-axe';
import { expect } from 'vitest';
import { ApiProvider, LocaleProvider, ToastProvider } from '../src/index.ts';

export const LOCALES: Locale[] = ['en', 'ar'];

export const testApi = (fetchImpl?: typeof fetch): Api =>
  createApi({
    baseUrl: 'https://api.test',
    store: memoryStore(),
    fetch: fetchImpl ?? (async () => new Response('{}')),
    uuid: () => crypto.randomUUID(),
  });

export function Providers({
  locale = 'en',
  children,
  api,
}: {
  locale?: Locale;
  children: ReactNode;
  api?: Api;
}) {
  return (
    <LocaleProvider locale={locale}>
      <ApiProvider api={api ?? testApi()}>
        <ToastProvider>{children}</ToastProvider>
      </ApiProvider>
    </LocaleProvider>
  );
}

export function renderIn(ui: ReactElement, locale: Locale = 'en', api?: Api) {
  const user = userEvent.setup();
  const view = render(ui, {
    wrapper: ({ children }) => (
      <Providers locale={locale} {...(api ? { api } : {})}>
        {children}
      </Providers>
    ),
  });
  return { user, ...view };
}

/** Fails with each violation's rule and a pointer to the element, not an opaque object diff. */
export async function expectNoViolations(el: Element): Promise<void> {
  const { violations } = await axe(el, { rules: { region: { enabled: false } } });
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ')})`)).toEqual([]);
}
