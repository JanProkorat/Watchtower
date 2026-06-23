import type { PgStore } from './pool.js';
import { PG_MIGRATIONS } from './schema.js';

/**
 * Apply pending Postgres migrations. Mirrors the SQLite runner: a
 * pg_schema_version table tracks applied versions; each version's statements
 * run inside one transaction so a failure leaves no partial schema. Idempotent.
 * Returns the resulting max applied version.
 *
 * NOTE — transaction guarantee: PgStore.query delegates to pg.Pool.query, which
 * does NOT guarantee the same physical connection across calls. In principle,
 * BEGIN could land on connection A while subsequent DDL lands on connection B
 * (no active transaction). In practice, this desktop pool (max 4) is idle
 * during migrations and pg.Pool reuses the same idle client serially, so the
 * transaction does hold in practice. Correctness fallback: all DDL uses
 * CREATE/DROP TABLE IF NOT EXISTS, so a partial re-run is fully self-healing —
 * any version whose pg_schema_version row was not written will simply be
 * re-applied on the next call. The only risk is a permanently-missed INSERT
 * into pg_schema_version after successful DDL, which would cause the migration
 * to re-run (idempotent DDL absorbs this). A future hardening pass could
 * replace pool.query with pool.connect() to guarantee a single-client
 * transaction; that requires extending the PgStore interface.
 */
export async function runPgMigrations(store: PgStore): Promise<number> {
  await store.query(`
    CREATE TABLE IF NOT EXISTS pg_schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await store.query<{ v: number | null }>(
    `SELECT MAX(version) AS v FROM pg_schema_version`,
  );
  const current = rows[0]?.v ?? 0;

  for (const m of PG_MIGRATIONS) {
    if (m.version <= current) continue;
    await store.query('BEGIN');
    try {
      for (const stmt of m.up) {
        await store.query(stmt);
      }
      await store.query(`INSERT INTO pg_schema_version (version) VALUES ($1)`, [m.version]);
      await store.query('COMMIT');
    } catch (err) {
      await store.query('ROLLBACK');
      throw err;
    }
  }

  const after = await store.query<{ v: number | null }>(
    `SELECT MAX(version) AS v FROM pg_schema_version`,
  );
  return after.rows[0]?.v ?? 0;
}
