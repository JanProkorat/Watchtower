import type { SqliteLike } from '../db/migrations.js';
import type { PgStore } from '../db/pg/pool.js';
import { SYNCED_TABLES } from './schema.js';
import { SettingsRepo } from '../db/repositories/settings.js';

/** Retain a soft-deleted (tombstoned) row this long before hard-deleting it. */
export const GRACE_MS = 30 * 24 * 60 * 60 * 1000;
/** Run the purge sweep at most this often. */
export const PURGE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const LAST_RUN_KEY = 'sync.purge.lastRunAt';

// Child → parent so an FK-enforcing DELETE never orphans/violates. days_off has no FK.
const PURGE_ORDER = ['worklogs', 'tasks', 'contracts', 'epics', 'days_off', 'projects'] as const;

export interface PurgeResult {
  /** Per-table count of hard-deleted tombstone rows (SQLite side). */
  purged: Record<string, number>;
  ranAt: string;
}

/** True when no purge has run within PURGE_MIN_INTERVAL_MS (or ever). */
export function purgeDue(db: SqliteLike, now: number): boolean {
  const last = new SettingsRepo(db).getString(LAST_RUN_KEY, '');
  const lastMs = Date.parse(last);
  if (!Number.isFinite(lastMs)) return true;
  return now - lastMs > PURGE_MIN_INTERVAL_MS;
}

/**
 * Hard-delete tombstones (deleted_at set) older than GRACE_MS from BOTH stores,
 * child→parent. Postgres first, then SQLite; a partial failure self-heals next
 * run (a leftover tombstone's updated_at is far below the push cursor, so it
 * never re-pushes). Records the run time so purgeDue() throttles later calls.
 * SAFETY: the caller MUST only invoke this after a sync cycle converged both stores.
 */
export async function purgeTombstones(db: SqliteLike, store: PgStore, now: number): Promise<PurgeResult> {
  const threshold = new Date(now - GRACE_MS).toISOString();
  const byName = new Map(SYNCED_TABLES.map((t) => [t.name, t]));
  const purged: Record<string, number> = {};
  for (const name of PURGE_ORDER) {
    const table = byName.get(name);
    if (!table) continue;
    const { rows } = await store.query<{ sync_id: string }>(
      `DELETE FROM ${table.pgTable} WHERE deleted_at IS NOT NULL AND deleted_at < $1 RETURNING sync_id`,
      [threshold],
    );
    const info = db
      .prepare(`DELETE FROM ${table.name} WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
      .run(threshold) as { changes: number };
    purged[name] = info.changes;
    if (rows.length !== info.changes) {
      console.warn(`[purge] ${name}: store counts differ pg=${rows.length} sqlite=${info.changes}`);
    }
  }
  new SettingsRepo(db).set(LAST_RUN_KEY, new Date(now).toISOString());
  const total = Object.values(purged).reduce((a, b) => a + b, 0);
  if (total > 0) console.log(`[purge] hard-deleted ${total} tombstones:`, purged);
  return { purged, ranAt: new Date(now).toISOString() };
}
