import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new RangeError('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit seed, as recommended by RFC 4226 §4. */
export const generateSeed = (): string => base32Encode(randomBytes(20));

/** RFC 4226 HOTP. `counter` is an integer < 2^53. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS, algorithm = 'sha1'): string {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac(algorithm, secret).update(msg).digest();
  const offset = (h[h.length - 1] as number) & 0xf;
  const bin =
    (((h[offset] as number) & 0x7f) << 24) |
    (((h[offset + 1] as number) & 0xff) << 16) |
    (((h[offset + 2] as number) & 0xff) << 8) |
    ((h[offset + 3] as number) & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (epochMs: number): number => Math.floor(epochMs / 1000 / STEP_SECONDS);

/**
 * RFC 6238 verification with a ±1 step window for clock skew. Returns the matched step so the
 * caller can persist it and refuse a second use of the same code; `null` when nothing matches.
 */
export function verifyTotp(
  seedBase32: string,
  code: string,
  nowMs: number,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(seedBase32);
  const current = stepAt(nowMs);
  let matched: number | null = null;
  // Evaluate every step in the window regardless of an early hit, so timing reveals nothing.
  for (const step of [current - 1, current, current + 1]) {
    const ok = hotp(secret, step) === code;
    if (ok && matched === null && (lastUsedStep === null || step > lastUsedStep)) matched = step;
  }
  return matched;
}

export const otpauthUri = (seed: string, account: string, issuer = 'AIDOOi'): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${seed}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
