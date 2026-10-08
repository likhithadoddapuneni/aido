import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Config } from '../../config.ts';
import { HttpError } from '../../http/problem.ts';
import type { IdTokenVerifier, OAuthProvider, VerifiedIdentity } from '../../ports.ts';

const PROVIDERS = {
  apple: { jwks: 'https://appleid.apple.com/auth/keys', issuer: ['https://appleid.apple.com'] },
  google: {
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
  },
} as const;

/** Verifies Apple and Google ID tokens against the providers' published keys, issuer and our client id. */
export class ProviderIdTokenVerifier implements IdTokenVerifier {
  private readonly clientIds: Record<OAuthProvider, string | undefined>;
  private readonly keys = new Map<OAuthProvider, ReturnType<typeof createRemoteJWKSet>>();

  constructor(config: Pick<Config, 'APPLE_CLIENT_ID' | 'GOOGLE_CLIENT_ID'>) {
    this.clientIds = { apple: config.APPLE_CLIENT_ID, google: config.GOOGLE_CLIENT_ID };
  }

  async verify(provider: OAuthProvider, idToken: string): Promise<VerifiedIdentity> {
    const audience = this.clientIds[provider];
    if (!audience)
      throw new HttpError(
        503,
        'oauth_not_configured',
        `Sign in with ${provider} is not available.`,
      );
    const def = PROVIDERS[provider];
    let jwks = this.keys.get(provider);
    if (!jwks) this.keys.set(provider, (jwks = createRemoteJWKSet(new URL(def.jwks))));
    const { payload } = await jwtVerify(idToken, jwks, { issuer: [...def.issuer], audience });
    if (typeof payload.sub !== 'string') throw new Error('token has no subject');
    const verified = payload['email_verified'];
    return {
      subject: payload.sub,
      email: typeof payload['email'] === 'string' ? payload['email'].toLowerCase() : null,
      // Apple sends the flag as a string.
      emailVerified: verified === true || verified === 'true',
    };
  }
}
