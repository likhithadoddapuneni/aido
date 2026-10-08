import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './generated/db.ts';

const INT8_OID = 20;

// Money is bigint fils. Every realistic amount fits a double exactly; anything that would not is
// a bug upstream, so fail loudly instead of silently losing precision.
function parseInt8(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new RangeError(`bigint ${value} exceeds Number.MAX_SAFE_INTEGER`);
  return n;
}

export interface PoolOptions {
  readonly max?: number;
  /**
   * Called when an *idle* pooled connection fails (a failover, a restart, an administrator killing a
   * session). The pool discards it and opens a new one on demand, so this is informational. Without a
   * listener Node treats the event as an uncaught exception and the process dies.
   */
  readonly onError?: (error: Error) => void;
  /** Run every session as this role (tests use it to exercise the app role's privileges). */
  readonly role?: string;
}

export function createPool(connectionString: string, options: PoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    ...(options.max !== undefined && { max: options.max }),
    types: {
      getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
        oid === INT8_OID ? parseInt8 : pg.types.getTypeParser(oid, format as 'text')) as never,
    },
  });
  pool.on('error', (error) => {
    if (options.onError) options.onError(error);
    else
      process.stderr.write(
        `${JSON.stringify({ level: 'warn', msg: 'idle database client error', err: error.message })}\n`,
      );
  });
  const { role } = options;
  if (role !== undefined) {
    if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Invalid role name: ${role}`);
    pool.on('connect', (client) => {
      client.query(`SET ROLE ${role}`).catch((error: unknown) => pool.emit('error', error));
    });
  }
  return pool;
}

export function createDb(pool: pg.Pool): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
