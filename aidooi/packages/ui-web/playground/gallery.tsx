import { createApi, memoryStore } from '@aidooi/api-client';
import type { Locale } from '@aidooi/i18n';
import { useState } from 'react';
import { ApiProvider, LocaleProvider, ToastProvider } from '../src/index.ts';
import { EXAMPLES } from './examples.tsx';

const api = createApi({ baseUrl: 'http://localhost:3000', store: memoryStore() });

/** Every component, in the language and direction you choose. The visual reference and the build proof. */
export function Gallery() {
  const [locale, setLocale] = useState<Locale>('en');
  return (
    <LocaleProvider locale={locale} onLocaleChange={setLocale}>
      <ApiProvider api={api}>
        <ToastProvider>
          <main style={{ maxInlineSize: 960, margin: '0 auto', padding: 24 }}>
            <h1>AIDOOi web components</h1>
            <p>
              <label>
                Language{' '}
                <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                  <option value="en">English (LTR)</option>
                  <option value="ar">العربية (RTL)</option>
                </select>
              </label>
            </p>
            {EXAMPLES.map((e) => (
              <section key={e.id} id={e.id} style={{ marginBlock: 32 }}>
                <h2>{e.title}</h2>
                {e.element}
              </section>
            ))}
          </main>
        </ToastProvider>
      </ApiProvider>
    </LocaleProvider>
  );
}
