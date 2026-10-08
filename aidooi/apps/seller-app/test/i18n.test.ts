import { ar } from '../src/i18n/ar.ts';
import { en } from '../src/i18n/strings.ts';
import { messageFor } from '../src/ui/errors.ts';
import { ApiProblem, NetworkError } from '@aidooi/api-client';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catalogues', () => {
  it('Arabic covers exactly the English keys', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });
  it('every string is non-empty and keeps the same placeholders', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(ar[k].trim()).not.toBe('');
      expect(placeholders(ar[k])).toEqual(placeholders(en[k]));
    }
  });
  it('Arabic is actually translated (not copied English) for prose strings', () => {
    const copied = (Object.keys(en) as (keyof typeof en)[]).filter(
      (k) => en[k].length > 12 && ar[k] === en[k],
    );
    expect(copied).toEqual([]);
  });
});

describe('messageFor', () => {
  it('uses the shared catalogue for API codes in both languages', () => {
    const e = new ApiProblem({ status: 409, code: 'offer_version_conflict' });
    expect(messageFor(e, 'en')).not.toBe(messageFor(e, 'ar'));
    expect(messageFor(e, 'en')).not.toMatch(/offer_version_conflict/);
  });
  it('has local messages for pass_expired / pass_not_yet_valid', () => {
    for (const code of ['pass_expired', 'pass_not_yet_valid']) {
      const e = new ApiProblem({ status: 400, code });
      expect(messageFor(e, 'en')).not.toBe(code);
      expect(messageFor(e, 'ar')).not.toBe(messageFor(e, 'en'));
    }
  });
  it('explains a network failure', () => {
    expect(messageFor(new NetworkError(new TypeError('offline')), 'en').length).toBeGreaterThan(5);
  });
});
