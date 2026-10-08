import type { IdTokenVerifier, OAuthProvider, VerifiedIdentity } from '../../src/ports.ts';

/** Provider ID tokens in tests are just JSON the test mints: `fake.mint('google', {...})`. */
export class FakeIdTokens implements IdTokenVerifier {
  mint(provider: OAuthProvider, identity: VerifiedIdentity): string {
    return `fake.${provider}.${Buffer.from(JSON.stringify(identity)).toString('base64url')}`;
  }

  async verify(provider: OAuthProvider, idToken: string): Promise<VerifiedIdentity> {
    const [marker, p, body] = idToken.split('.');
    if (marker !== 'fake' || p !== provider || !body) throw new Error('not a valid test token');
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as VerifiedIdentity;
  }
}
