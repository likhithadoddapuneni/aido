import type { Locale } from '@aidooi/i18n';

const KEY = 'aidooi.seller.locale';

/** The language choice is not sensitive, so it may persist; sessions never do. */
export function readLocale(): Locale {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'ar') return v;
  } catch {
    /* storage may be blocked */
  }
  return 'en';
}
export function writeLocale(l: Locale): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
}
