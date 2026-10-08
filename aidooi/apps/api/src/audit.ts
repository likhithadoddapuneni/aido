import { sql, type Transaction } from 'kysely';
import type { DB } from '@aidooi/db';
import { auditActor, type ApiActor } from './http/actor.ts';

export interface AuditInput {
  readonly entityType: string;
  readonly entityId: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly actor: ApiActor | 'system';
  readonly reason?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * Write an audit row in the caller's transaction, so a state change and its audit trail commit
 * together or not at all (ADR-021).
 */
export async function recordAudit(trx: Transaction<DB>, e: AuditInput): Promise<void> {
  const a = auditActor(e.actor);
  await sql`
    SELECT audit.record(${e.entityType}, ${e.entityId}, ${e.from}, ${e.to}, ${a.type}, ${a.id},
                        ${e.reason ?? null}, ${JSON.stringify(e.data ?? {})}::jsonb)`.execute(trx);
}
