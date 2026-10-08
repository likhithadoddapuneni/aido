import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const sha256Hex = (v: string): string => createHash('sha256').update(v).digest('hex');

/** 256 bits of entropy, URL-safe. Used for guest, refresh and invite tokens. */
export const randomToken = (): string => randomBytes(32).toString('base64url');

/** Comparison whose duration does not depend on where the inputs first differ. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Independent keys for independent purposes, all derived from the one root secret. */
export class SecretKeys {
  private readonly root: Buffer;
  constructor(secret: string) {
    this.root = Buffer.from(secret, 'utf8');
  }

  private derive(info: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.root, 'aidooi-auth-v1', info, 32));
  }

  /** Keyed hash for low-entropy secrets (phone numbers, OTP codes): a leaked table cannot be brute-forced offline. */
  mac(purpose: 'phone' | 'otp', value: string): string {
    return createHmac('sha256', this.derive(`mac:${purpose}`))
      .update(value)
      .digest('hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.derive('totp-seed'), iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.derive('totp-seed'), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}
