import { errorsAr } from './errors.ar.ts';
import { errorsEn, type ErrorCode } from './errors.en.ts';

export type Locale = 'en' | 'ar';
export const LOCALES: readonly Locale[] = ['en', 'ar'];
export const isRtl = (l: Locale): boolean => l === 'ar';
export type { ErrorCode };

const CATALOGUES: Readonly<Record<Locale, Readonly<Record<ErrorCode, string>>>> = {
  en: errorsEn,
  ar: errorsAr,
};

const isKnown = (code: string): code is ErrorCode => code in errorsEn;

/**
 * The message a person should read for an API error code. An unknown code (a newer server than this
 * build) falls back to the generic message rather than ever showing a raw code.
 */
export function errorMessage(code: string, locale: Locale): string {
  return CATALOGUES[locale][isKnown(code) ? code : 'internal_error'];
}

/** Format money (integer fils) for display. The wire format is always fils; display is locale-aware. */
export function formatMoney(fils: number, locale: Locale): string {
  const aed = fils / 100;
  const whole = Number.isInteger(aed);
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(aed);
}
