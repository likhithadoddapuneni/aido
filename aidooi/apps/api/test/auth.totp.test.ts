import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateSeed,
  hotp,
  stepAt,
  verifyTotp,
} from '../src/modules/auth/totp.ts';

// RFC 4226 Appendix D: secret "12345678901234567890", 6 digits.
describe('HOTP (RFC 4226 Appendix D)', () => {
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ])('counter %i → %s', (counter, expected) => {
    expect(hotp(secret, counter)).toBe(expected);
  });
});

// RFC 6238 Appendix B (SHA-1, 8 digits).
describe('TOTP (RFC 6238 Appendix B)', () => {
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i → %s', (seconds, expected) => {
    expect(hotp(secret, stepAt(seconds * 1000), 8)).toBe(expected);
  });
});

describe('verifyTotp', () => {
  const seed = base32Encode(Buffer.from('12345678901234567890'));
  const now = 1_700_000_000_000;
  const at = (offset: number) => hotp(base32Decode(seed), stepAt(now) + offset);

  it('accepts the current step and one step either side (clock skew)', () => {
    expect(verifyTotp(seed, at(0), now, null)).toBe(stepAt(now));
    expect(verifyTotp(seed, at(-1), now, null)).toBe(stepAt(now) - 1);
    expect(verifyTotp(seed, at(1), now, null)).toBe(stepAt(now) + 1);
  });

  it('rejects anything outside the window and anything malformed', () => {
    expect(verifyTotp(seed, at(-2), now, null)).toBeNull();
    expect(verifyTotp(seed, at(2), now, null)).toBeNull();
    expect(verifyTotp(seed, '12345', now, null)).toBeNull();
    expect(verifyTotp(seed, 'abcdef', now, null)).toBeNull();
  });

  it('a step can be used once: the same or an earlier step is refused afterwards', () => {
    const step = stepAt(now);
    expect(verifyTotp(seed, at(0), now, step)).toBeNull();
    expect(verifyTotp(seed, at(-1), now, step)).toBeNull();
    expect(verifyTotp(seed, at(1), now, step)).toBe(step + 1);
  });
});

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 64 }), (bytes) => {
        expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
      }),
    );
  });

  it('matches RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(() => base32Decode('not*base32')).toThrow();
  });

  it('generated seeds are 160-bit and unique', () => {
    const a = generateSeed();
    expect(base32Decode(a)).toHaveLength(20);
    expect(generateSeed()).not.toBe(a);
  });
});
