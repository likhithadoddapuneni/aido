import { createHash } from 'node:crypto';
import type { Viewing } from '@aidooi/contracts';
import { assertTransition, fils, payment as paymentMachine } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext, type Tx } from '../../context.ts';
import { HttpError, conflict } from '../../http/problem.ts';
import { GatewayUnavailable, type GatewayEvent } from '../../payments/gateway.ts';
import { postTransfer } from './ledger.ts';
import { createRefund, processRefund } from './refunds.ts';
import { issuePass, passSecret } from './qr.ts';
import { loadData, lockRequest, toView } from './repo.ts';
import {
  Outbox,
  addAttribution,
  at,
  scheduleJob,
  setDepositState,
  setRequestState,
} from './transitions.ts';

export type DepositOutcome =
  | { readonly status: 'confirmed'; readonly viewing: Viewing }
  | { readonly status: 'requires_action'; readonly actionUrl: string };

const MAX_LEAD_DAYS = 90;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface Prepared {
  readonly paymentId: string;
  readonly scheduledAt: Date;
}

/**
 * Pay a viewing deposit. One client `Idempotency-Key` is one payment attempt, and the payment row is
 * keyed by it, so any retry — after a timeout, a crash, or a double tap — resumes the *same* payment
 * at the step it reached instead of starting another. The provider calls carry keys derived from the
 * payment id, so the provider also acts at most once.
 *
 * Steps (each persisted before the next begins): Pending → authorize → Authorized → capture →
 * Successful, with the deposit Paid, the ledger posted and the viewing Confirmed in one transaction.
 */
export async function payDeposit(
  ctx: AppContext,
  buyer: { customerId: string },
  viewingId: string,
  input: { paymentToken: string; scheduledAt: string },
  clientKey: string,
  correlationId: string,
): Promise<DepositOutcome> {
  const scheduledAt = new Date(input.scheduledAt);
  const now = ctx.clock.now();
  if (scheduledAt.getTime() <= now || scheduledAt.getTime() > now + MAX_LEAD_DAYS * 86_400_000) {
    throw new HttpError(
      422,
      'invalid_schedule',
      `Choose a time in the future, within ${MAX_LEAD_DAYS} days.`,
    );
  }
  const tokenSha = sha(input.paymentToken);
  const key = `viewing-deposit:${viewingId}:${clientKey}`;

  const prepared = await runAsSystem(
    ctx,
    async (trx): Promise<Prepared> => {
      const head = await trx
        .selectFrom('viewing.viewing_request')
        .select('customer_id')
        .where('id', '=', viewingId)
        .executeTakeFirst();
      if (!head || head.customer_id !== buyer.customerId)
        throw new HttpError(404, 'not_found', 'Viewing was not found');
      const request = await lockRequest(trx, viewingId);
      const deposit = await trx
        .selectFrom('viewing.viewing_deposit')
        .selectAll()
        .where('viewing_request_id', '=', viewingId)
        .executeTakeFirst();

      const existing = await trx
        .selectFrom('commerce.payment')
        .select(['id'])
        .where('idempotency_key', '=', key)
        .executeTakeFirst();
      if (existing) {
        const first = await firstAttempt(trx, existing.id);
        if (first?.tokenSha !== tokenSha || first.scheduledAt !== input.scheduledAt) {
          throw new HttpError(
            422,
            'idempotency_key_reuse',
            'This Idempotency-Key was already used with a different payment.',
          );
        }
        return { paymentId: existing.id, scheduledAt: new Date(first.scheduledAt) };
      }

      if (request.state !== 'Awaiting Deposit' || !deposit || deposit.state !== 'Pending') {
        throw conflict(
          'viewing_not_awaiting_deposit',
          'This viewing is not waiting for a deposit.',
        );
      }
      const open = await trx
        .selectFrom('commerce.payment')
        .select('id')
        .where('viewing_deposit_id', '=', deposit.id)
        .where('state', 'in', ['Pending', 'Authorized'])
        .executeTakeFirst();
      if (open)
        throw conflict(
          'deposit_payment_in_progress',
          'A deposit payment for this viewing is already in progress.',
        );

      const pay = await trx
        .insertInto('commerce.payment')
        .values({
          purpose: 'ViewingDeposit',
          customer_id: buyer.customerId,
          viewing_deposit_id: deposit.id,
          amount_fils: deposit.amount_fils,
          idempotency_key: key,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('commerce.payment_attempt')
        .values({
          payment_id: pay.id,
          kind: 'authorize',
          outcome: 'Pending',
          request: JSON.stringify({ tokenSha, scheduledAt: input.scheduledAt }),
        })
        .execute();
      await recordAudit(trx, {
        entityType: 'payment',
        entityId: pay.id,
        from: null,
        to: 'Pending',
        actor: 'system',
        data: { purpose: 'ViewingDeposit', viewingId },
      });
      return { paymentId: pay.id, scheduledAt };
    },
    correlationId,
  );

  return drive(ctx, prepared.paymentId, input.paymentToken, prepared.scheduledAt, correlationId);
}

async function firstAttempt(
  trx: Tx,
  paymentId: string,
): Promise<{ tokenSha: string; scheduledAt: string } | null> {
  const row = await trx
    .selectFrom('commerce.payment_attempt')
    .select('request')
    .where('payment_id', '=', paymentId)
    .where('kind', '=', 'authorize')
    .orderBy('created_at')
    .limit(1)
    .executeTakeFirst();
  const r = row?.request as { tokenSha?: string; scheduledAt?: string } | null | undefined;
  return r?.tokenSha && r.scheduledAt ? { tokenSha: r.tokenSha, scheduledAt: r.scheduledAt } : null;
}

const unavailable = () =>
  new HttpError(
    503,
    'payment_provider_unavailable',
    'The payment provider did not answer. Retry with the same Idempotency-Key.',
  );

/** Advance one deposit payment as far as it can go from wherever it currently is. */
async function drive(
  ctx: AppContext,
  paymentId: string,
  paymentToken: string | null,
  scheduledAt: Date,
  correlationId: string,
): Promise<DepositOutcome> {
  const load = () =>
    runAsSystem(ctx, (trx) =>
      trx
        .selectFrom('commerce.payment as p')
        .innerJoin('viewing.viewing_deposit as d', 'd.id', 'p.viewing_deposit_id')
        .select([
          'p.id',
          'p.state',
          'p.amount_fils',
          'p.provider_ref',
          'p.failure_code',
          'd.viewing_request_id',
        ])
        .where('p.id', '=', paymentId)
        .executeTakeFirstOrThrow(),
    );
  let pay = await load();

  if (pay.state === 'Failed' || pay.state === 'Voided') {
    throw new HttpError(
      402,
      'payment_declined',
      `The payment was not completed (${pay.failure_code ?? 'declined'}).`,
    );
  }

  if (pay.state === 'Pending') {
    if (!paymentToken)
      throw conflict(
        'payment_awaiting_authentication',
        'The payment is waiting for the buyer to complete authentication.',
      );
    let auth;
    try {
      auth = await ctx.gateway.authorize({
        idempotencyKey: `${paymentId}:authorize`,
        amount: fils(Number(pay.amount_fils)),
        paymentToken,
        reference: pay.viewing_request_id,
      });
    } catch (e) {
      if (e instanceof GatewayUnavailable) throw unavailable();
      throw e;
    }
    if (auth.status === 'declined') {
      await runAsSystem(
        ctx,
        async (trx) => {
          await trx
            .updateTable('commerce.payment')
            .set({ state: 'Failed', failure_code: auth.code })
            .where('id', '=', paymentId)
            .where('state', '=', 'Pending')
            .execute();
          await trx
            .insertInto('commerce.payment_attempt')
            .values({
              payment_id: paymentId,
              kind: 'authorize',
              outcome: 'Failed',
              response: JSON.stringify(auth),
            })
            .execute();
          await recordAudit(trx, {
            entityType: 'payment',
            entityId: paymentId,
            from: 'Pending',
            to: 'Failed',
            actor: 'system',
            reason: auth.code,
          });
        },
        correlationId,
      );
      throw new HttpError(402, 'payment_declined', `The payment was declined (${auth.code}).`);
    }
    if (auth.status === 'requires_action') {
      await runAsSystem(
        ctx,
        async (trx) => {
          await trx
            .updateTable('commerce.payment')
            .set({ provider_ref: auth.providerRef })
            .where('id', '=', paymentId)
            .execute();
          await trx
            .insertInto('commerce.payment_attempt')
            .values({
              payment_id: paymentId,
              kind: 'authorize',
              outcome: 'Pending',
              response: JSON.stringify(auth),
            })
            .execute();
        },
        correlationId,
      );
      return { status: 'requires_action', actionUrl: auth.actionUrl };
    }
    await runAsSystem(
      ctx,
      async (trx) => {
        assertTransition(paymentMachine, 'Pending', 'Authorized');
        await trx
          .updateTable('commerce.payment')
          .set({ state: 'Authorized', provider_ref: auth.providerRef, authorized_at: at(ctx) })
          .where('id', '=', paymentId)
          .execute();
        await trx
          .insertInto('commerce.payment_attempt')
          .values({
            payment_id: paymentId,
            kind: 'authorize',
            outcome: 'Succeeded',
            response: JSON.stringify(auth),
          })
          .execute();
        await recordAudit(trx, {
          entityType: 'payment',
          entityId: paymentId,
          from: 'Pending',
          to: 'Authorized',
          actor: 'system',
        });
      },
      correlationId,
    );
    pay = await load();
  }

  if (pay.state === 'Authorized') {
    let cap;
    try {
      cap = await ctx.gateway.capture({
        idempotencyKey: `${paymentId}:capture`,
        providerRef: pay.provider_ref as string,
        amount: fils(Number(pay.amount_fils)),
      });
    } catch (e) {
      if (e instanceof GatewayUnavailable) throw unavailable();
      throw e;
    }
    if (cap.status === 'failed') {
      // Release the hold so the buyer is not left with money reserved for nothing.
      const voided = await ctx.gateway
        .void({ idempotencyKey: `${paymentId}:void`, providerRef: pay.provider_ref as string })
        .catch(() => ({ status: 'failed' as const }));
      await runAsSystem(
        ctx,
        async (trx) => {
          const to = voided.status === 'voided' ? 'Voided' : 'Failed';
          assertTransition(paymentMachine, 'Authorized', to);
          await trx
            .updateTable('commerce.payment')
            .set({
              state: to,
              failure_code: cap.code,
              ...(to === 'Voided' ? { voided_at: at(ctx) } : {}),
            })
            .where('id', '=', paymentId)
            .execute();
          await trx
            .insertInto('commerce.payment_attempt')
            .values({
              payment_id: paymentId,
              kind: 'capture',
              outcome: 'Failed',
              response: JSON.stringify(cap),
            })
            .execute();
          await recordAudit(trx, {
            entityType: 'payment',
            entityId: paymentId,
            from: 'Authorized',
            to,
            actor: 'system',
            reason: cap.code,
          });
        },
        correlationId,
      );
      throw new HttpError(
        402,
        'payment_capture_failed',
        `The payment could not be completed (${cap.code}).`,
      );
    }
  }

  return finalize(ctx, paymentId, scheduledAt, correlationId);
}

/** Capture succeeded at the provider: record it, mark the deposit Paid and confirm the viewing — atomically. */
async function finalize(
  ctx: AppContext,
  paymentId: string,
  scheduledAt: Date,
  correlationId: string,
): Promise<DepositOutcome> {
  const out = new Outbox();
  let refundId: string | null = null;
  const viewing = await runAsSystem(
    ctx,
    async (trx) => {
      const pay = await trx
        .selectFrom('commerce.payment')
        .selectAll()
        .where('id', '=', paymentId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const deposit = await trx
        .selectFrom('viewing.viewing_deposit')
        .selectAll()
        .where('id', '=', pay.viewing_deposit_id as string)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const request = await lockRequest(trx, deposit.viewing_request_id);

      if (pay.state === 'Authorized') {
        assertTransition(paymentMachine, 'Authorized', 'Successful');
        await trx
          .updateTable('commerce.payment')
          .set({ state: 'Successful', captured_at: at(ctx) })
          .where('id', '=', paymentId)
          .execute();
        await trx
          .insertInto('commerce.payment_attempt')
          .values({ payment_id: paymentId, kind: 'capture', outcome: 'Succeeded' })
          .execute();
        await recordAudit(trx, {
          entityType: 'payment',
          entityId: paymentId,
          from: 'Authorized',
          to: 'Successful',
          actor: 'system',
        });
        await setDepositState(trx, deposit, 'Paid', 'system');
        await postTransfer(trx, ctx, {
          debit: 'psp_clearing',
          credit: 'deposits_held',
          amount: fils(Number(deposit.amount_fils)),
          refType: 'viewing_deposit',
          refId: deposit.id,
          memo: 'viewing deposit captured',
        });
      }

      if (request.state === 'Awaiting Deposit') {
        const p = issuePass(passSecret(ctx.config), request.id, scheduledAt.getTime());
        await setRequestState(trx, request, 'Confirmed', 'system', {
          scheduled_at: scheduledAt,
          qr_token_hash: p.hash,
        });
        await addAttribution(trx, request.id, 'Confirmed');
        await scheduleJob(
          trx,
          'viewing.resolve_unattended',
          { viewingRequestId: request.id },
          new Date(p.validUntil),
          `viewing.unattended:${request.id}`,
        );
        out.add({
          template: 'viewing.confirmed',
          to: { kind: 'customer', id: request.customer_id },
          data: { viewingId: request.id },
          dedupeKey: `viewing.confirmed:${request.id}`,
        });
        const data = await loadData(trx, request.id);
        for (const s of data.stops.filter((s) => s.confirmation_state === 'Confirmed')) {
          out.add({
            template: 'viewing.confirmed_for_seller',
            to: { kind: 'partner', id: s.partner_id },
            data: { viewingId: request.id, stopId: s.id, scheduledAt: scheduledAt.toISOString() },
            dedupeKey: `viewing.confirmed-seller:${s.id}`,
          });
        }
      } else if (request.state === 'Cancelled' && deposit.state !== 'Refunded') {
        // The buyer cancelled while the payment was in flight: the money arrived, so it goes straight back.
        refundId = await createRefund(trx, ctx, {
          depositId: deposit.id,
          amount: fils(Number(deposit.amount_fils)),
          reason: 'viewing_cancelled',
        });
      }
      return toView(ctx, await loadData(trx, request.id));
    },
    correlationId,
  );
  await out.flush(ctx);
  if (refundId) await processRefund(ctx, refundId).catch(() => undefined);
  return { status: 'confirmed', viewing };
}

/**
 * Apply a provider webhook to a viewing-deposit payment. Returns `false` when the event does not
 * concern a deposit, so the caller can offer it to the order payments instead.
 *
 * Events are de-duplicated by provider event id. Only authorisation outcomes matter here: capture and
 * refund results are already recorded by the synchronous calls that made them.
 */
export async function applyDepositPaymentEvent(
  ctx: AppContext,
  event: GatewayEvent,
): Promise<boolean> {
  const pay = await runAsSystem(ctx, (trx) =>
    trx
      .selectFrom('commerce.payment')
      .select(['id', 'state'])
      .where('provider', '=', 'mock')
      .where('provider_ref', '=', event.providerRef)
      .where('purpose', '=', 'ViewingDeposit')
      .executeTakeFirst(),
  );
  if (!pay) return false;
  if (event.type !== 'authorization.succeeded' && event.type !== 'authorization.failed')
    return true;

  const scheduledAt = await runAsSystem(ctx, async (trx) => {
    const fresh = await trx
      .insertInto('commerce.payment_attempt')
      .values({
        payment_id: pay.id,
        kind: 'authorize',
        outcome: event.type === 'authorization.succeeded' ? 'Succeeded' : 'Failed',
        provider_event_id: event.id,
        response: JSON.stringify(event),
      })
      .onConflict((oc) =>
        oc.column('provider_event_id').where('provider_event_id', 'is not', null).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    if (!fresh) return null; // already processed
    const current = await trx
      .selectFrom('commerce.payment')
      .select('state')
      .where('id', '=', pay.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (current.state !== 'Pending') return null;
    if (event.type === 'authorization.failed') {
      await trx
        .updateTable('commerce.payment')
        .set({ state: 'Failed', failure_code: event.code })
        .where('id', '=', pay.id)
        .execute();
      await recordAudit(trx, {
        entityType: 'payment',
        entityId: pay.id,
        from: 'Pending',
        to: 'Failed',
        actor: 'system',
        reason: event.code,
      });
      return null;
    }
    await trx
      .updateTable('commerce.payment')
      .set({ state: 'Authorized', authorized_at: at(ctx) })
      .where('id', '=', pay.id)
      .execute();
    await recordAudit(trx, {
      entityType: 'payment',
      entityId: pay.id,
      from: 'Pending',
      to: 'Authorized',
      actor: 'system',
    });
    const first = await firstAttempt(trx, pay.id);
    return first ? new Date(first.scheduledAt) : null;
  });
  if (scheduledAt)
    await drive(ctx, pay.id, null, scheduledAt, `webhook:${event.id}`).catch((e) => {
      // Capture is retried by the next webhook delivery or the buyer's own retry; never fail the webhook for it.
      if (!(e instanceof HttpError)) throw e;
    });
  return true;
}
