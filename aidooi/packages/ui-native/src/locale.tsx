import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { isRtl, type Locale } from '@aidooi/i18n';
import { builtInStrings, type BuiltInKey } from './strings.ts';

export interface LocaleValue {
  readonly locale: Locale;
  readonly rtl: boolean;
}

const LocaleContext = createContext<LocaleValue>({ locale: 'en', rtl: false });

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, rtl: isRtl(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): LocaleValue => useContext(LocaleContext);

const fill = (template: string, params: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));

/**
 * Translate from an app's own catalogue: `const t = useT({ en: {...}, ar: {...} })`. Falls back to
 * English, then to the key, so a missing translation shows something readable rather than nothing.
 */
export function useT<C extends Readonly<Record<string, string>>>(
  catalogues: Readonly<Record<Locale, C>> & Readonly<Partial<Record<Locale, C>>>,
) {
  const { locale } = useLocale();
  return useCallback(
    (key: keyof C & string, params: Readonly<Record<string, string | number>> = {}): string =>
      fill(catalogues[locale]?.[key] ?? catalogues.en?.[key] ?? key, params),
    [catalogues, locale],
  );
}

/** What components say for themselves (labels, retry, loading) in the current language. */
export function useStrings() {
  const { locale } = useLocale();
  return useCallback(
    (key: BuiltInKey, params: Readonly<Record<string, string | number>> = {}): string =>
      fill(builtInStrings[locale][key], params),
    [locale],
  );
}

export interface DirectionManager {
  readonly isRTL: boolean;
  allowRTL(allow: boolean): void;
  forceRTL(force: boolean): void;
}

/**
 * Make the native layer match the chosen language. React Native fixes layout direction when the app
 * starts: a change takes effect only after a reload, so this reports whether the caller must reload
 * (e.g. with `expo-updates`' `reloadAsync`) before the new direction is visible. Web needs no reload.
 */
export function applyLocale(
  locale: Locale,
  manager: DirectionManager = I18nManager,
): { needsReload: boolean } {
  const rtl = isRtl(locale);
  manager.allowRTL(rtl);
  manager.forceRTL(rtl);
  // On the web the browser lays out from the document's own direction, and it changes instantly.
  if (typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
    return { needsReload: false };
  }
  return { needsReload: manager.isRTL !== rtl };
}
