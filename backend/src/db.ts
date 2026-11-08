import pg from "pg";

/** Verbinding als de app-rol; alles in het schema beheer. Alleen geparametriseerde SQL. */
export function maakPool(url: string): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 10, options: "-c search_path=beheer" });
}

export type Db = pg.Pool | pg.PoolClient;

/** Een transactie; bij een fout wordt alles teruggedraaid. */
export async function inTransactie<T>(pool: pg.Pool, werk: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await werk(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
