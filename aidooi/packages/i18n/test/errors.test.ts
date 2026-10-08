import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectErrorCodes } from '../scripts/error-codes.ts';
import { errorsAr } from '../src/errors.ar.ts';
import { errorsEn } from '../src/errors.en.ts';
import { errorMessage, formatMoney, isRtl } from '../src/index.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const apiCodes = collectErrorCodes(
  path.join(root, 'apps/api/src'),
  path.join(root, 'packages/domain/src'),
);

describe('GATE: no error the API can return reaches a person as a raw code', () => {
  it('every code found in the API and domain source has an English and an Arabic message', () => {
    const missingEn = apiCodes.filter((c) => !(c in errorsEn));
    const missingAr = apiCodes.filter((c) => !(c in errorsAr));
    expect(missingEn, 'add these to errors.en.ts (and errors.ar.ts)').toEqual([]);
    expect(missingAr).toEqual([]);
  });

  it('there are no stale messages for codes the API no longer raises', () => {
    const stale = Object.keys(errorsEn).filter((c) => !apiCodes.includes(c));
    expect(stale, 'remove these from the catalogues').toEqual([]);
  });

  it('the scanner is not vacuous', () => {
    expect(apiCodes.length).toBeGreaterThan(100);
    expect(apiCodes).toContain('price_approval_required');
    expect(apiCodes).toContain('payment_in_progress');
  });
});

describe('catalogue quality', () => {
  const entries = Object.entries(errorsEn) as [keyof typeof errorsEn, string][];

  it('Arabic is real Arabic, not a copy of the English', () => {
    for (const [code] of entries) {
      const ar = errorsAr[code];
      expect(ar, code).toMatch(/[؀-ۿ]/);
      expect(ar, code).not.toBe(errorsEn[code]);
    }
  });

  it('messages are short, end with a full stop, and never expose internals', () => {
    for (const [code, text] of entries) {
      expect(text.length, code).toBeLessThan(160);
      expect(text, code).toMatch(/[.!]$/);
      expect(text, code).not.toMatch(/\b(null|undefined|stack|sql|exception|http|\d{3} )\b/i);
      expect(errorsAr[code].length, code).toBeLessThan(180);
      expect(errorsAr[code], code).toMatch(/[.!]$/);
    }
  });

  it('every message that mentions a charge reassures in both languages (money safety wording)', () => {
    for (const code of [
      'checkout_changed',
      'payment_capture_failed',
      'payment_provider_unavailable',
      'order_could_not_be_placed',
    ] as const) {
      expect(errorsEn[code], code).toMatch(/charged|refunded/i);
      expect(errorsAr[code], code).toMatch(/خصم|أعدنا/);
    }
  });
});

describe('lookup and formatting', () => {
  it('an unknown code (a newer server) falls back to a generic message, never the raw code', () => {
    expect(errorMessage('brand_new_error', 'en')).toBe(errorsEn.internal_error);
    expect(errorMessage('brand_new_error', 'ar')).toBe(errorsAr.internal_error);
    expect(errorMessage('payment_declined', 'en')).toBe(errorsEn.payment_declined);
  });

  it('formats AED from fils; Arabic uses the dirham sign in the UAE convention (Western digits)', () => {
    expect(formatMoney(123_400, 'en')).toMatch(/AED\s?1,234/);
    expect(formatMoney(123_456, 'en')).toMatch(/1,234\.56/);
    expect(formatMoney(5, 'en')).toMatch(/0\.05/);
    expect(formatMoney(123_400, 'ar')).toMatch(/1,234.*د\.إ/);
  });

  it('only Arabic is right-to-left', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });
});
