import { useLocale, type MessageKey } from '@aidooi/ui-web';
import { useMemo } from 'react';
import { ar } from './ar.ts';
import { en, type Catalogue, type StringKey } from './en.ts';

export type { StringKey };
const CATALOGUES: Record<'en' | 'ar', Catalogue> = { en, ar };

type Values = Record<string, string | number>;
export const format = (template: string, values: Values): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));

export type Strings = Readonly<Catalogue> & {
  fmt: (key: StringKey, values: Values) => string;
};

/** The portal's own copy for the current locale. Component labels come from `useT()` in ui-web. */
export function useS(): Strings {
  const { locale } = useLocale();
  return useMemo(() => {
    const c = CATALOGUES[locale];
    return { ...c, fmt: (key, values) => format(c[key], values) };
  }, [locale]);
}

export type { MessageKey };
