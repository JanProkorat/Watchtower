import type { SqliteLike } from '../db/migrations.js';
import type { PgStore } from '../db/pg/pool.js';
import { SYNCED_TABLES, DERIVERS, toPgValue, type SyncTable } from './schema.js';
import { getCursor, setCursor } from './cursor.js';

const PUSH_ORDER = ['projects', 'notes', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off'];

function fkSource(table: SyncTable): { col: string; parentTable: string; localCol: string; nullable: boolean } | null {
  switch (table.name) {
    case 'epics': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id', nullable: false };
    case 'tasks': return { col: 'epic_sync_id', parentTable: 'epics', localCol: 'epic_id', nullable: false };
    case 'contracts': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id', nullable: false };
    case 'worklogs': return { col: 'task_sync_id', parentTable: 'tasks', localCol: 'task_id', nullable: false };
    case 'notes': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id', nullable: true };
    default: return null;
  }
}
export const fkSourceForTest = fkSource;

/** Push local rows changed since the push cursor into Postgres (LWW upsert). */
export async function pushTable(db: SqliteLike, store: PgStore, table: SyncTable): Promise<number> {
  const cursor = getCursor(db, 'push', table.name);
  const fk = fkSource(table);

  // Build the deriver once per push cycle (if this table has one).
  const deriverFactory = DERIVERS[table.name];
  const deriver = deriverFactory ? deriverFactory(db) : null;

  // Read physical, non-derived columns + resolved parent sync_id (for child FK).
  // Derived columns are Postgres-only: their values come from the deriver, not SQLite.
  const physical = table.columns.filter(
    (c) => !c.derived && (!c.name.endsWith('_sync_id') || c.name === 'sync_id'),
  );
  const selectCols = physical.map((c) => `t.${c.name}`);
  let joinSql = '';
  if (fk) {
    selectCols.push(`parent.sync_id AS ${fk.col}`);
    const joinKind = fk.nullable ? 'LEFT JOIN' : 'JOIN';
    joinSql = ` ${joinKind} ${fk.parentTable} parent ON parent.id = t.${fk.localCol}`;
  }
  const rows = db
    .prepare(`SELECT ${selectCols.join(', ')} FROM ${table.name} t${joinSql} WHERE t.updated_at > ? ORDER BY t.updated_at ASC`)
    .all(cursor) as Array<Record<string, unknown>>;

  let maxSeen = cursor;
  for (const rawRow of rows) {
    // Merge derived (Postgres-only) values computed from the SQLite state.
    const row = deriver ? { ...rawRow, ...deriver(rawRow) } : rawRow;
    // Resilience: a single bad row (e.g. a worklog whose task_sync_id resolves
    // to no Postgres task → not-null violation on the FK) must not abort the
    // whole table and stall the cursor. Skip it and keep going; the LWW guard
    // and deriver merge above are untouched.
    try {
      await upsertRow(store, table, row, fk);
    } catch (err) {
      console.warn(`[push] ${table.name} upsert failed for sync_id=${String(rawRow['sync_id'])}, skipping:`, err);
    }
    const u = String(rawRow['updated_at']);
    if (u > maxSeen) maxSeen = u;
  }
  if (maxSeen > cursor) setCursor(db, 'push', table.name, maxSeen);
  return rows.length;
}

export async function pushAll(db: SqliteLike, store: PgStore): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const byName = new Map(SYNCED_TABLES.map((t) => [t.name, t]));
  for (const name of PUSH_ORDER) {
    const tableDesc = byName.get(name);
    if (tableDesc) {
      out[name] = await pushTable(db, store, tableDesc);
    }
  }
  for (const t of SYNCED_TABLES) {
    if (!(t.name in out)) throw new Error(`pushAll: ${t.name} missing from PUSH_ORDER — add it`);
  }
  return out;
}

async function upsertRow(
  store: PgStore,
  table: SyncTable,
  row: Record<string, unknown>,
  fk: { col: string; parentTable: string; localCol: string; nullable: boolean } | null,
): Promise<void> {
  const insertCols: string[] = [];
  const insertExprs: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const c of table.columns) {
    const isSyntheticFk = c.name.endsWith('_sync_id') && c.name !== 'sync_id';
    const value = isSyntheticFk
      ? row[c.name] // already the parent's sync_id from the JOIN
      : toPgValue(c.kind, row[c.name]);
    if (fk && c.name === fk.col) {
      insertCols.push(fk.localCol);
      insertExprs.push(`(SELECT id FROM ${fk.parentTable} WHERE sync_id = $${p})`);
    } else {
      insertCols.push(c.name);
      insertExprs.push(`$${p}`);
    }
    params.push(value);
    p++;
  }
  const setClause = insertCols
    .filter((c) => c !== 'sync_id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');
  // LWW guard: only overwrite when the incoming row is strictly newer.
  const sql = `
    INSERT INTO ${table.pgTable} (${insertCols.join(', ')})
    VALUES (${insertExprs.join(', ')})
    ON CONFLICT (sync_id) DO UPDATE SET ${setClause}
    WHERE ${table.pgTable}.updated_at < EXCLUDED.updated_at
  `;
  await store.query(sql, params);
}
