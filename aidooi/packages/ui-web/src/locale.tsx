import { isRtl, type Locale } from '@aidooi/i18n';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { MESSAGES, format, type MessageKey, type Messages } from './messages.ts';

interface LocaleValue {
  readonly locale: Locale;
  readonly dir: 'ltr' | 'rtl';
  readonly setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleValue | null>(null);

/** Owns the document's language and direction, so every logical CSS property flips with it. */
export function LocaleProvider(props: {
  locale: Locale;
  onLocaleChange?: (l: Locale) => void;
  children: ReactNode;
}) {
  const { locale, onLocaleChange } = props;
  const dir = isRtl(locale) ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);
  const value = useMemo<LocaleValue>(
    () => ({ locale, dir, setLocale: (l) => onLocaleChange?.(l) }),
    [locale, dir, onLocaleChange],
  );
  return <LocaleContext value={value}>{props.children}</LocaleContext>;
}

export function useLocale(): LocaleValue {
  const v = useContext(LocaleContext);
  if (!v) throw new Error('useLocale must be used inside <LocaleProvider>');
  return v;
}

/** The component catalogue for the current locale, plus `fmt` for `{placeholders}`. */
export function useT(): Messages & {
  fmt: (key: MessageKey, values: Record<string, string | number>) => string;
} {
  const { locale } = useLocale();
  return useMemo(() => {
    const m = MESSAGES[locale];
    return { ...m, fmt: (key, values) => format(m[key], values) };
  }, [locale]);
}
