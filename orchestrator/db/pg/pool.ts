import pg from 'pg';
import path from 'node:path';

// node-postgres parses Postgres DATE (OID 1082) into a JS Date at local
// midnight, then any .toISOString() call converts to UTC — shifting the date
// back by 1 day in timezones ahead of UTC (e.g. Europe/Prague = UTC+1/+2).
// Override the type parser to return the raw 'YYYY-MM-DD' string so no Date
// object is ever constructed for date columns, eliminating the TZ shift on pull.
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

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

export interface HubGuardResult {
  /** Whether the Postgres hub may be used for this (data-store, hub) pairing. */
  allow: boolean;
  /** Human-readable explanation when blocked; empty string when allowed. */
  reason: string;
}

/**
 * Refuse to open the Supabase hub when the local data store and the hub belong
 * to different environments — the footgun being a `WATCHTOWER_ENV=production
 * npm run dev` session, which reads the scrambled *dev* SQLite (support dir
 * `…-dev`) yet resolves WATCHTOWER_PG_URL to the *prod* Supabase project, and
 * would migrate + push dev data straight into production.
 *
 * Signals (all already set by the run scripts, so no new config to remember):
 * - `WATCHTOWER_DEV_URL` is present iff this is a dev (unpackaged) session — a
 *   packaged build never sets it, so packaged runs are trusted and never blocked.
 * - The support-dir basename carries the *data* environment (`…-dev` → dev).
 * - `WATCHTOWER_ENV` carries the *hub* environment the `.env` picker resolved.
 *
 * A mismatch blocks the hub (sync + migrations stay dormant, SQLite-only) unless
 * `WATCHTOWER_ALLOW_ENV_MISMATCH=1` is set as an explicit escape hatch.
 */
export function evaluateHubGuard(input: {
  supportDir: string;
  env?: NodeJS.ProcessEnv;
}): HubGuardResult {
  const env = input.env ?? process.env;

  // Only a dev (unpackaged) session can cross environments; packaged builds get
  // their config from the user's shell/launchd env and are trusted as-is.
  if (!env.WATCHTOWER_DEV_URL) return { allow: true, reason: '' };
  if (env.WATCHTOWER_ALLOW_ENV_MISMATCH === '1') return { allow: true, reason: '' };

  const dataEnv = path.basename(input.supportDir).endsWith('-dev') ? 'development' : 'production';
  const hubEnv = env.WATCHTOWER_ENV === 'production' ? 'production' : 'development';

  if (dataEnv !== hubEnv) {
    return {
      allow: false,
      reason:
        `local data is '${dataEnv}' (${input.supportDir}) but the Supabase hub is ` +
        `'${hubEnv}' — refusing to migrate/sync across environments. ` +
        `Set WATCHTOWER_ALLOW_ENV_MISMATCH=1 to override.`,
    };
  }
  return { allow: true, reason: '' };
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
