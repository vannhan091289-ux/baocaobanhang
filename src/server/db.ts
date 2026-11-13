import "server-only";
import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { getRuntimeConfig } from "./config";

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

let runtimePool: pg.Pool | null = null;
let runtimePoolUrl: string | null = null;

export function getRuntimePool(): pg.Pool {
  const cfg = getRuntimeConfig();
  if (!runtimePool || runtimePoolUrl !== cfg.databaseUrl) {
    if (runtimePool) {
      void runtimePool.end().catch(() => undefined);
    }
    runtimePool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      max: 10,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    runtimePoolUrl = cfg.databaseUrl;
  }
  return runtimePool;
}

export async function closeRuntimePool(): Promise<void> {
  if (runtimePool) {
    const pool = runtimePool;
    runtimePool = null;
    runtimePoolUrl = null;
    await pool.end();
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  pool: pg.Pool = getRuntimePool(),
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback error, preserve original failure
    }
    throw err;
  } finally {
    client.release();
  }
}
