import { useLocale } from '@aidooi/ui-web';
import { useMemo } from 'react';
import { ar } from './catalogue.ar.ts';
import { en, type CatalogueKey } from './catalogue.en.ts';

export type { CatalogueKey };
type Strings = Readonly<Record<CatalogueKey, string>>;

const CATALOGUES: Record<'en' | 'ar', Strings> = { en, ar };
const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

/** The parts of a zod issue the console localises. */
export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly format?: string | undefined;
  readonly origin?: string | undefined;
  readonly minimum?: number | bigint | undefined;
  readonly pattern?: string | undefined;
}

export interface Copy {
  /** The sentence for a key. */
  readonly t: (key: CatalogueKey, values?: Record<string, string | number>) => string;
  /** A status word for an enum value, falling back to the raw value (never to a blank). */
  readonly label: (group: string, value: string | null | undefined) => string;
  /** A form validation message in the user's language. */
  readonly issue: (issue: ValidationIssue) => string;
}

export function makeCopy(locale: 'en' | 'ar'): Copy {
  const c = CATALOGUES[locale];
  const t: Copy['t'] = (key, values) => (values ? fill(c[key], values) : c[key]);
  return {
    t,
    label: (group, value) =>
      value === null || value === undefined
        ? c.none
        : ((c as Record<string, string>)[`${group}.${value}`] ?? value),
    issue: (i) => {
      if (i.code === 'invalid_format') {
        if (i.format === 'email') return c.valEmail;
        // Only the phone pattern gets the phone sentence; any other pattern is just "not valid".
        if ((i.pattern ?? i.message).includes('[1-9][0-9]{7,14}')) return c.valPhone;
        return c.valInvalid;
      }
      if (i.code === 'too_small') {
        if (i.origin === 'number') return c.valRange;
        return Number(i.minimum ?? 0) <= 1 ? c.valRequired : c.valTooShort;
      }
      if (i.code === 'too_big') return i.origin === 'number' ? c.valRange : c.valTooLong;
      if (i.code === 'invalid_type') return c.valRequired;
      return c.valInvalid;
    },
  };
}

export function useCopy(): Copy {
  const { locale } = useLocale();
  return useMemo(() => makeCopy(locale), [locale]);
}
