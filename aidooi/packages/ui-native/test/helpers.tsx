import type { ReactElement } from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Locale } from '@aidooi/i18n';
import { LocaleProvider, ThemeProvider, ToastProvider } from '../src/index.ts';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** Render inside everything the real app provides, in the given language (English by default). */
export function renderApp(ui: ReactElement, opts: { locale?: Locale } = {}) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LocaleProvider locale={opts.locale ?? 'en'}>
          <ToastProvider>{ui}</ToastProvider>
        </LocaleProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

/** Flatten a style prop (arrays, falsy entries, functions already resolved) to one object. */
export function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}
