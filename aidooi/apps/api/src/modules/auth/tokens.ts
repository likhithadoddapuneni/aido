import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from '../../config.ts';
import { SecretKeys, randomToken } from './crypto.ts';

export const ACCESS_TTL_SECONDS = 15 * 60;
const ALG = 'EdDSA';

export type AccessClaims =
  | { readonly kind: 'buyer'; readonly sub: string }
  | { readonly kind: 'seller'; readonly sub: string }
  | { readonly kind: 'ops'; readonly sub: string };

/**
 * Everything derived from configuration that the auth module needs: the signing key and the
 * secret-derived keys. Built once per process (see `authRuntime`).
 */
export class AuthRuntime {
  readonly secrets: SecretKeys;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly cfg: Pick<Config, 'JWT_KEY_ID' | 'JWT_ISSUER' | 'JWT_AUDIENCE'>;

  constructor(config: Config) {
    this.cfg = config;
    // Outside production a missing key is generated for the process; production config requires them.
    if (config.JWT_PRIVATE_KEY_PEM) {
      this.privateKey = createPrivateKey(config.JWT_PRIVATE_KEY_PEM.replaceAll('\\n', '\n'));
    } else {
      this.privateKey = generateKeyPairSync('ed25519').privateKey;
    }
    this.publicKey = createPublicKey(this.privateKey);
    this.secrets = new SecretKeys(config.AUTH_SECRET ?? randomToken());
  }

  async signAccess(
    claims: AccessClaims,
    nowMs: number,
  ): Promise<{ token: string; expiresInSeconds: number }> {
    const iat = Math.floor(nowMs / 1000);
    const token = await new SignJWT({ kind: claims.kind, typ: 'access' })
      .setProtectedHeader({ alg: ALG, kid: this.cfg.JWT_KEY_ID })
      .setSubject(claims.sub)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setAudience(this.cfg.JWT_AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ACCESS_TTL_SECONDS)
      .sign(this.privateKey);
    return { token, expiresInSeconds: ACCESS_TTL_SECONDS };
  }

  /** Throws on any defect: signature, algorithm, issuer, audience, expiry, token type. */
  async verifyAccess(token: string, nowMs: number): Promise<AccessClaims> {
    const { payload, protectedHeader } = await jwtVerify(token, this.publicKey, {
      algorithms: [ALG],
      issuer: this.cfg.JWT_ISSUER,
      audience: this.cfg.JWT_AUDIENCE,
      currentDate: new Date(nowMs),
    });
    if (protectedHeader.kid !== this.cfg.JWT_KEY_ID) throw new Error('unknown key id');
    return claimsOf(payload);
  }
}

function claimsOf(p: JWTPayload): AccessClaims {
  const kind = p['kind'];
  if (p['typ'] !== 'access' || typeof p.sub !== 'string') throw new Error('not an access token');
  if (kind !== 'buyer' && kind !== 'seller' && kind !== 'ops')
    throw new Error('unknown subject kind');
  return { kind, sub: p.sub };
}

const cache = new WeakMap<Config, AuthRuntime>();

/** One runtime per config object, so the authenticator and the routes share a signing key. */
export function authRuntime(config: Config): AuthRuntime {
  let r = cache.get(config);
  if (!r) cache.set(config, (r = new AuthRuntime(config)));
  return r;
}
