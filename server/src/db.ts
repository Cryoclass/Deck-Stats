import 'dotenv/config';
import pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ygo:ygo@localhost:5433/ygo';

// pg renvoie les bigint (int8) en string par défaut pour ne pas perdre de
// précision. Les passcodes tiennent sur un Number JS sans risque → on les parse
// en nombre pour que `cards.id` soit homogène côté API (et matche les YDK).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: DATABASE_URL });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never);
}

/** Transaction helper. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
