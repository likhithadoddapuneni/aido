import type { FastifyRequest } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { withActor, type DB } from '@aidooi/db';
import type { Clock } from '@aidooi/domain';
import type { Config } from './config.ts';
import { toDbActor, type ApiActor } from './http/actor.ts';
import type { PaymentGateway } from './payments/gateway.ts';
import type {
  Authenticator,
  DepositCreditPort,
  IdGenerator,
  IdTokenVerifier,
  MediaStorage,
  Notifier,
  OtpSender,
} from './ports.ts';

/**
 * Everything a module needs from its environment. Modules receive this and nothing else:
 * no module reaches for globals, the wall clock or another module's tables.
 */
export interface AppContext {
  readonly config: Config;
  readonly clock: Clock;
  readonly db: Kysely<DB>;
  readonly ids: IdGenerator;
  readonly gateway: PaymentGateway;
  readonly notifier: Notifier;
  readonly otp: OtpSender;
  readonly authenticator: Authenticator;
  /** Applies a completed viewing's deposit to an order (implemented by the viewing module). */
  readonly depositCredit: DepositCreditPort;
  /** Product photograph storage (signed direct uploads). */
  readonly media: MediaStorage;
  /** Social sign-in. Defaults to the real provider verifier built from config when omitted. */
  readonly idTokens?: IdTokenVerifier;
}

export type Tx = Transaction<DB>;

/** Run `fn` in a transaction under the request's row-level-security identity. */
export function runAs<T>(
  ctx: AppContext,
  req: FastifyRequest,
  fn: (trx: Tx) => Promise<T>,
): Promise<T> {
  const actor = req.actor;
  if (!actor)
    throw new Error('runAs requires an authenticated request; use runAsSystem for anonymous flows');
  return withActor(ctx.db, toDbActor(actor), fn, { correlationId: req.id });
}

/**
 * Run as the platform itself. Only for flows that are not a user's action — checkout's stock
 * reservation, scheduled jobs, webhook handling — never to skip an authorization check.
 */
export function runAsSystem<T>(
  ctx: AppContext,
  fn: (trx: Tx) => Promise<T>,
  correlationId?: string,
): Promise<T> {
  return withActor(ctx.db, { kind: 'system' }, fn, correlationId ? { correlationId } : {});
}

export type { ApiActor };
