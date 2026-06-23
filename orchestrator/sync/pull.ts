import type { SqliteLike } from '../db/migrations.js';
import type { PgStore } from '../db/pg/pool.js';
import { SYNCED_TABLES, toSqliteValue, type SyncTable } from './schema.js';
import { getCursor, setCursor } from './cursor.js';

// Parent-before-child so a child's FK target exists locally when it lands.
const PULL_ORDER = ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off'];

function fkSource(table: SyncTable): { col: string; parentTable: string; localCol: string } | null {
  switch (table.name) {
    case 'epics': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id' };
    case 'tasks': return { col: 'epic_sync_id', parentTable: 'epics', localCol: 'epic_id' };
    case 'contracts': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id' };
    case 'worklogs': return { col: 'task_sync_id', parentTable: 'tasks', localCol: 'task_id' };
    default: return null;
  }
}

export async function pullTable(
  db: SqliteLike,
  store: PgStore,
  table: SyncTable,
): Promise<{ pulled: number; conflicts: number }> {
  const cursor = getCursor(db, 'pull', table.name);
  const fk = fkSource(table);

  // Select remote rows changed since the cursor, joining the parent sync_id.
  const pgCols = table.columns.filter((c) => !c.name.endsWith('_sync_id') || c.name === 'sync_id').map((c) => `t.${c.name}`);
  let joinSql = '';
  if (fk) {
    pgCols.push(`parent.sync_id AS ${fk.col}`);
    joinSql = ` JOIN ${fk.parentTable} parent ON parent.id = t.${fk.localCol}`;
  }
  const { rows } = await store.query<Record<string, unknown>>(
    `SELECT ${pgCols.join(', ')} FROM ${table.pgTable} t${joinSql} WHERE t.updated_at > $1 ORDER BY t.updated_at ASC`,
    [cursor],
  );

  let pulled = 0;
  let conflicts = 0;
  let maxSeen = cursor;

  for (const remote of rows) {
    const syncId = String(remote['sync_id']);
    const remoteUpdated = toSqliteValue('ts', remote['updated_at']) as string;

    // Resolve FK to a local id; if the parent isn't here yet, skip — a later
    // cycle (after the parent lands) will pick it up.
    let localFkId: number | null = null;
    if (fk) {
      const parentSyncId = remote[fk.col];
      if (parentSyncId == null) continue;
      const prow = db.prepare(`SELECT id FROM ${fk.parentTable} WHERE sync_id = ?`).get(parentSyncId) as { id: number } | undefined;
      if (!prow) continue;
      localFkId = prow.id;
    }

    const existing = db.prepare(`SELECT ${table.keyCol} AS k, updated_at FROM ${table.name} WHERE sync_id = ?`).get(syncId) as
      | { k: string | number; updated_at: string }
      | undefined;

    if (existing) {
      const localUpdated = existing.updated_at;
      if (localUpdated >= remoteUpdated) {
        // Local is newer-or-equal → keep local. If local changed since the last
        // pull (i.e. > cursor, not just ==), this is a genuine conflict the local
        // side won. The > (not >=) guard prevents false-positive conflicts on rows
        // that were freshly pulled in a prior cycle (where local updated_at ==
        // pull cursor, meaning no local mutation happened).
        if (localUpdated > cursor) {
          conflicts++;
          await logConflict(store, table, syncId, 'local_won', 'remote', remote, localUpdated, remoteUpdated);
        }
        if (remoteUpdated > maxSeen) maxSeen = remoteUpdated;
        continue;
      }
      // Remote newer → it wins. If local also changed since last pull, log it.
      if (localUpdated > cursor) {
        conflicts++;
        const localSnap = db.prepare(`SELECT * FROM ${table.name} WHERE sync_id = ?`).get(syncId);
        await logConflict(store, table, syncId, 'remote_won', 'local', localSnap, localUpdated, remoteUpdated);
      }
    }

    // days_off has a UNIQUE(sync_id) AND PK(date). If a pulled date collides
    // with a different local sync_id, that's an unexpected divergence — skip
    // the row (out of scope to resolve in v1) rather than crashing.
    if (table.name === 'days_off') {
      try {
        upsertLocal(db, table, remote, fk, localFkId);
      } catch (err) {
        console.warn(`[pull] days_off upsert conflict for sync_id=${syncId}:`, err);
        if (remoteUpdated > maxSeen) maxSeen = remoteUpdated;
        continue;
      }
    } else {
      upsertLocal(db, table, remote, fk, localFkId);
    }
    pulled++;
    if (remoteUpdated > maxSeen) maxSeen = remoteUpdated;
  }

  if (maxSeen > cursor) setCursor(db, 'pull', table.name, maxSeen);
  return { pulled, conflicts };
}

export async function pullAll(
  db: SqliteLike,
  store: PgStore,
): Promise<Record<string, { pulled: number; conflicts: number }>> {
  const out: Record<string, { pulled: number; conflicts: number }> = {};
  const byName = new Map(SYNCED_TABLES.map((t) => [t.name, t]));
  for (const name of PULL_ORDER) {
    const tableDesc = byName.get(name);
    if (tableDesc) {
      out[name] = await pullTable(db, store, tableDesc);
    }
  }
  // Guard: fail loud if any SYNCED_TABLES entry is missing from PULL_ORDER —
  // catches future schema drift where a new table is added to SYNCED_TABLES but
  // not to PULL_ORDER.
  for (const t of SYNCED_TABLES) {
    if (!(t.name in out)) throw new Error(`pullAll: ${t.name} missing from PULL_ORDER — add it`);
  }
  return out;
}

/** INSERT-or-UPDATE one remote row into SQLite by sync_id. */
function upsertLocal(
  db: SqliteLike,
  table: SyncTable,
  remote: Record<string, unknown>,
  fk: { col: string; localCol: string } | null,
  localFkId: number | null,
): void {
  const cols: string[] = [];
  const values: unknown[] = [];
  for (const c of table.columns) {
    if (fk && c.name === fk.col) {
      cols.push(fk.localCol);
      values.push(localFkId);
    } else {
      cols.push(c.name);
      values.push(toSqliteValue(c.kind, remote[c.name]));
    }
  }
  const placeholders = cols.map(() => '?').join(', ');
  const setClause = cols.filter((c) => c !== 'sync_id').map((c) => `${c} = excluded.${c}`).join(', ');
  db.prepare(
    `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (sync_id) DO UPDATE SET ${setClause}`,
  ).run(...values);
}

async function logConflict(
  store: PgStore,
  table: SyncTable,
  syncId: string,
  resolution: 'local_won' | 'remote_won',
  loserSide: 'local' | 'remote',
  loserPayload: unknown,
  localUpdated: string,
  remoteUpdated: string,
): Promise<void> {
  await store.query(
    `INSERT INTO sync_conflicts (table_name, sync_id, resolution, loser_side, loser_payload, local_updated_at, remote_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [table.name, syncId, resolution, loserSide, JSON.stringify(loserPayload ?? {}), localUpdated, remoteUpdated],
  );
}
