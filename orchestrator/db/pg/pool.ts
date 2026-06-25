import pg from 'pg';

/** Dev-only Postgres in the shared fitness-postgres container (isolated `watchtower` DB). */
const DEV_PG_URL =
  'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

export interface PgStore {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  healthCheck(): Promise<boolean>;
  end(): Promise<void>;
}

/**
 * The connection string to use: explicit env wins; in non-production (i.e.
 * when WATCHTOWER_DEV_URL is set, matching the rest of the app's dev-mode
 * signal) we fall back to the local dev container. In production an unset env
 * means "no hub" (sync stays dormant) rather than silently pointing at a dev DB.
 */
export function defaultPgUrl(): string | undefined {
  if (process.env.WATCHTOWER_PG_URL) return process.env.WATCHTOWER_PG_URL;
  if (process.env.WATCHTOWER_DEV_URL) return DEV_PG_URL;
  return undefined;
}

/**
 * Build an optional Postgres store. Returns null when there is no connection
 * string at all — the desktop then runs SQLite-only and sync is dormant.
 * Construction never throws or connects eagerly: a bad/unreachable URL only
 * surfaces when the first query runs, so a Postgres outage can't crash boot.
 */
export function createPgStore(connectionString?: string): PgStore | null {
  const url = connectionString ?? defaultPgUrl();
  if (!url) return null;

  // The local dev container speaks plaintext; any remote hub (Supabase) requires
  // TLS and rejects non-SSL handshakes. Decide by host so the user only ever
  // pastes a connection string — no extra sslmode flag to remember. We don't
  // pin Supabase's CA yet, so verification is relaxed; tightening it (download
  // the project CA, set `ca`/`rejectUnauthorized: true`) is the hardening step.
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

  const pool = new pg.Pool({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    // Keep the footprint tiny — the desktop is a single client.
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // A pool-level error handler is required, else an idle-client socket error
  // becomes an unhandled 'error' event and crashes the process.
  pool.on('error', (err) => {
    console.error('[pg] idle client error (ignored, sync will retry):', err.message);
  });

  return {
    async query<T = any>(text: string, params?: unknown[]) {
      const res = await pool.query(text, params as any[]);
      return { rows: res.rows as T[] };
    },
    async healthCheck() {
      const res = await pool.query('SELECT 1 AS ok');
      return res.rows[0]?.ok === 1;
    },
    async end() {
      await pool.end();
    },
  };
}
