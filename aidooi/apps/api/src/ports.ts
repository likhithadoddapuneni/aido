import type { FastifyRequest } from 'fastify';
import type { Fils } from '@aidooi/domain';
import type { Tx } from './context.ts';
import type { ApiActor } from './http/actor.ts';

/** Time-ordered UUIDs (v7) for every entity the application creates (ADR-020). */
export interface IdGenerator {
  uuid(): string;
}

/** Resolves who is calling. Production verifies a JWT; tests read a header. */
export interface Authenticator {
  authenticate(req: FastifyRequest): Promise<ApiActor | null>;
}

export interface Notification {
  /** Template key, e.g. `viewing.seller_confirmation_requested`. Content lives with the channel adapter. */
  readonly template: string;
  readonly to:
    | { readonly kind: 'customer'; readonly id: string }
    | { readonly kind: 'partner'; readonly id: string }
    | { readonly kind: 'ops' };
  readonly data: Readonly<Record<string, string | number | boolean | null>>;
  /** Idempotency: the same key is never sent twice. */
  readonly dedupeKey: string;
}

/**
 * Outbound messages (push, WhatsApp, SMS, email). The application only declares *what* to tell
 * *whom*; channel selection, templating and delivery are an adapter's concern and happen after the
 * business transaction commits.
 */
export interface Notifier {
  send(n: Notification): Promise<void>;
}

/** Delivers one-time codes. Production: SMS with WhatsApp fallback. */
export interface OtpSender {
  send(channel: 'sms' | 'whatsapp' | 'email', destination: string, code: string): Promise<void>;
}

export type OAuthProvider = 'apple' | 'google';

export interface VerifiedIdentity {
  /** The provider's stable user id (`sub`). */
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

/** Verifies a provider-issued ID token (signature, issuer, audience, expiry). Throws if it is not valid. */
export interface IdTokenVerifier {
  verify(provider: OAuthProvider, idToken: string): Promise<VerifiedIdentity>;
}

/**
 * Applying a completed viewing's deposit to an order. Owned by the viewing module; checkout only
 * depends on this shape, so the two modules stay decoupled and each is testable alone.
 */
export interface DepositCreditPort {
  /** Read-only: what would be credited now. Used to know the amount to authorise. */
  quote(
    trx: Tx,
    args: { viewingRequestId: string; customerId: string; orderGross: Fils },
  ): Promise<{ credit: Fils; excess: Fils }>;
  /** In the order's transaction: consume the credit (once per viewing) and schedule any excess refund. */
  apply(
    trx: Tx,
    args: { viewingRequestId: string; customerId: string; orderGross: Fils },
  ): Promise<{ credit: Fils; excessRefundDue: Fils }>;
  /** Attribution: the viewing led to a purchase. */
  markPurchased(trx: Tx, viewingRequestId: string): Promise<void>;
}

/**
 * Object storage for product photographs. Sellers upload directly to storage with a short-lived signed
 * URL, so image bytes never pass through the API; the API only confirms the object arrived.
 */
export interface MediaStorage {
  /** A URL the client may `PUT` the object to until `expiresAt`. The content type and size are bound into the signature. */
  signUpload(args: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresAt: Date;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  /** What is actually stored under `key`, or `null` if nothing is. */
  head(key: string): Promise<{ sizeBytes: number; contentType: string } | null>;
}
