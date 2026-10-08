import type { Clock, Fils, Instant } from '@aidooi/domain';

/**
 * The only seam between AIDOOi and a card processor. The checkout saga is written against this
 * interface; swapping the mock for a real provider is one adapter plus a sandbox re-run of the
 * gateway contract tests (test/gateway.contract.ts), with no change to the saga.
 *
 * Every mutating call takes an idempotency key. A retry with the same key must return the
 * original outcome and never act twice — the saga depends on that to survive flaky mobile
 * networks and worker restarts.
 */
export interface PaymentGateway {
  authorize(req: AuthorizeRequest): Promise<AuthorizeResult>;
  /** Capture all or part of an authorisation. Capturing more than authorised is an error. */
  capture(req: CaptureRequest): Promise<CaptureResult>;
  /** Release an authorisation that has not been captured. */
  void(req: VoidRequest): Promise<VoidResult>;
  refund(req: RefundRequest): Promise<RefundResult>;
  /** Verify the signature and parse a provider webhook. Throws if the signature is invalid. */
  parseWebhook(rawBody: string, signature: string): GatewayEvent;
}

export interface AuthorizeRequest {
  readonly idempotencyKey: string;
  readonly amount: Fils;
  /** Opaque token from the provider's client SDK. Card data never reaches AIDOOi. */
  readonly paymentToken: string;
  readonly reference: string;
}

export type AuthorizeResult =
  | { readonly status: 'authorized'; readonly providerRef: string; readonly expiresAt: Instant }
  /** 3-D Secure: the buyer must complete a challenge, after which a webhook confirms the outcome. */
  | { readonly status: 'requires_action'; readonly providerRef: string; readonly actionUrl: string }
  | { readonly status: 'declined'; readonly code: DeclineCode };

export type DeclineCode =
  | 'card_declined'
  | 'insufficient_funds'
  | 'expired_card'
  | 'authentication_failed'
  | 'fraud_suspected';

export interface CaptureRequest {
  readonly idempotencyKey: string;
  readonly providerRef: string;
  readonly amount: Fils;
}
export type CaptureResult =
  | { readonly status: 'captured'; readonly providerRef: string; readonly amount: Fils }
  | {
      readonly status: 'failed';
      readonly code:
        | 'authorization_expired'
        | 'authorization_voided'
        | 'amount_exceeds_authorization'
        | 'already_captured'
        | 'processor_error';
    };

export interface VoidRequest {
  readonly idempotencyKey: string;
  readonly providerRef: string;
}
export type VoidResult =
  | { readonly status: 'voided' }
  | { readonly status: 'failed'; readonly code: 'already_captured' | 'unknown_authorization' };

export interface RefundRequest {
  readonly idempotencyKey: string;
  readonly providerRef: string;
  readonly amount: Fils;
}
export type RefundResult =
  | { readonly status: 'refunded'; readonly refundRef: string; readonly amount: Fils }
  | {
      readonly status: 'failed';
      readonly code: 'amount_exceeds_captured' | 'not_captured' | 'processor_error';
    };

export type GatewayEvent =
  | { readonly id: string; readonly type: 'authorization.succeeded'; readonly providerRef: string }
  | {
      readonly id: string;
      readonly type: 'authorization.failed';
      readonly providerRef: string;
      readonly code: DeclineCode;
    }
  | {
      readonly id: string;
      readonly type: 'capture.succeeded';
      readonly providerRef: string;
      readonly amount: Fils;
    }
  | {
      readonly id: string;
      readonly type: 'refund.succeeded';
      readonly providerRef: string;
      readonly amount: Fils;
    };

/** A transient failure (timeout, 5xx). Always safe to retry with the same idempotency key. */
export class GatewayUnavailable extends Error {
  constructor(message = 'Payment provider unavailable') {
    super(message);
    this.name = 'GatewayUnavailable';
  }
}

export interface GatewayDeps {
  readonly clock: Clock;
}
