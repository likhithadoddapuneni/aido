import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { withActor, type DB } from '@aidooi/db';
import type { Clock } from '@aidooi/domain';
import type { Config } from '../../config.ts';
import type { ApiActor } from '../../http/actor.ts';
import { HttpError } from '../../http/problem.ts';
import type { Authenticator } from '../../ports.ts';
import { sha256Hex } from './crypto.ts';
import { resolveActor } from './subjects.ts';
import { authRuntime } from './tokens.ts';

/** Placeholder authenticator: every request is anonymous. Used where no identity is needed (OpenAPI generation). */
export const anonymousAuthenticator: Authenticator = { authenticate: async () => null };

const invalid = () =>
  new HttpError(401, 'invalid_token', 'The access token is invalid or has expired.');

/**
 * Maps `Authorization: Bearer <jwt>` (customer, seller or ops) and `Authorization: Guest <token>`
 * to an `ApiActor`. A credential that is present but defective is a 401, never silently anonymous,
 * so a client with an expired token learns to refresh instead of acting as a guest.
 */
export class JwtAuthenticator implements Authenticator {
  private readonly db: Kysely<DB>;
  private readonly config: Config;
  private readonly clock: Clock;

  constructor(deps: { db: Kysely<DB>; config: Config; clock: Clock }) {
    this.db = deps.db;
    this.config = deps.config;
    this.clock = deps.clock;
  }

  async authenticate(req: FastifyRequest): Promise<ApiActor | null> {
    const header = req.headers.authorization;
    if (!header) return null;
    const space = header.indexOf(' ');
    const scheme = space < 0 ? header : header.slice(0, space);
    const credential = space < 0 ? '' : header.slice(space + 1).trim();
    if (!credential) throw invalid();

    if (scheme === 'Bearer') return this.bearer(credential);
    if (scheme === 'Guest') return this.guest(credential);
    throw invalid();
  }

  private async bearer(token: string): Promise<ApiActor> {
    let claims;
    try {
      claims = await authRuntime(this.config).verifyAccess(token, this.clock.now());
    } catch {
      throw invalid();
    }
    const actor = await withActor(this.db, { kind: 'system' }, (trx) =>
      resolveActor(trx, { kind: claims.kind, id: claims.sub }),
    );
    if (!actor) throw invalid();
    return actor;
  }

  private async guest(token: string): Promise<ApiActor> {
    const row = await withActor(this.db, { kind: 'system' }, (trx) =>
      trx
        .selectFrom('identity.guest_session')
        .select(['id', 'expires_at', 'customer_id'])
        .where('token_hash', '=', sha256Hex(token))
        .executeTakeFirst(),
    );
    // An upgraded session has become a customer; the client must use the tokens it was given.
    if (!row || row.customer_id || new Date(row.expires_at).getTime() <= this.clock.now())
      throw invalid();
    return { kind: 'buyer', customerId: null, guestSessionId: row.id };
  }
}
