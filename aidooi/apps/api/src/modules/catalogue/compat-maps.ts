import { createHash } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '@aidooi/db';
import { COMPAT_MAPS, COMPAT_MAP_VERSION } from '@aidooi/domain';
import { RuleViolation } from '@aidooi/domain';

type Q = Kysely<DB> | Transaction<DB>;
const KINDS = ['style', 'colour', 'material'] as const;

export interface ActiveMaps {
  readonly version: string;
  readonly ids: { readonly style: string; readonly colour: string; readonly material: string };
}

/** Stable JSON for hashing: object keys sorted recursively. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export const contentHash = (v: unknown): string =>
  createHash('sha256').update(canonicalJson(v)).digest('hex');

/**
 * The sign-off gate (docs/adrs.md, gap 5). The maps in the deployed code must exist in the database,
 * approved by a named ops user and activated — and their content must be identical to the code's.
 * Otherwise the engine does not run: an unreviewed style or colour map can never reach a customer.
 */
export async function requireApprovedMaps(db: Q): Promise<ActiveMaps> {
  const rows = await db
    .selectFrom('catalogue.compat_map_version')
    .select(['id', 'kind', 'content', 'activated_at', 'retired_at'])
    .where('version', '=', COMPAT_MAP_VERSION)
    .execute();

  const ids: Record<string, string> = {};
  for (const kind of KINDS) {
    const row = rows.find((r) => r.kind === kind);
    if (!row || !row.activated_at || row.retired_at) {
      throw new RuleViolation(
        'compat_map_not_approved',
        `The ${kind} compatibility map ${COMPAT_MAP_VERSION} has not been approved and activated.`,
      );
    }
    if (contentHash(row.content) !== contentHash(COMPAT_MAPS[kind])) {
      throw new RuleViolation(
        'compat_map_mismatch',
        `The approved ${kind} map ${COMPAT_MAP_VERSION} differs from the one deployed. Approve the new content under a new version.`,
      );
    }
    ids[kind] = row.id;
  }
  return { version: COMPAT_MAP_VERSION, ids: ids as ActiveMaps['ids'] };
}
