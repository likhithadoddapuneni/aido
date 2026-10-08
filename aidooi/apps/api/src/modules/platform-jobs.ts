import { sql } from 'kysely';
import { runAsSystem } from '../context.ts';
import type { JobHandlers } from '../jobs/types.ts';
import { relayOutbox } from './outbox.ts';

/** Housekeeping that belongs to no single module. */
export const platformJobs: JobHandlers = {
  /** Deliver transactional-outbox events (order confirmations and the like). */
  'platform.relay_outbox': async (ctx) => {
    await relayOutbox(ctx);
  },
  /** Keep monthly audit partitions created ahead of time (the DEFAULT partition is a safety net, not a plan). */
  'platform.ensure_audit_partitions': async (ctx) => {
    await runAsSystem(ctx, (trx) => sql`SELECT audit.ensure_partitions(3)`.execute(trx));
  },
  /** Expired idempotency keys and published outbox rows are only clutter. */
  'platform.purge_expired': async (ctx) => {
    await runAsSystem(ctx, async (trx) => {
      await sql`DELETE FROM platform.idempotency_key WHERE expires_at < now()`.execute(trx);
      await sql`DELETE FROM platform.outbox_event WHERE published_at < now() - interval '14 days'`.execute(
        trx,
      );
      await sql`DELETE FROM identity.otp_challenge WHERE expires_at < now() - interval '1 day'`.execute(
        trx,
      );
    });
  },
};
