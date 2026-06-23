import path from 'node:path';
import { homedir } from 'node:os';
import type { SqliteLike } from '../db/migrations.js';
import type { PgStore } from '../db/pg/pool.js';
import { createPgStore } from '../db/pg/pool.js';
import { runPgMigrations } from '../db/pg/migrate.js';
import { SYNCED_TABLES, toPgValue, type SyncTable } from '../sync/schema.js';

export interface EtlReport {
  counts: Record<string, number>;
}

/**
 * One-time, re-runnable ETL: copy the 6 synced tables from a SQLite handle into
 * Postgres, resolving FKs by sync_id and upserting by sync_id (so re-runs don't
 * duplicate). Tombstoned rows are copied too (deleted_at preserved). The source
 * SQLite is only read. Returns per-table row counts.
 */
export async function etlFromSqlite(sqlite: SqliteLike, store: PgStore): Promise<EtlReport> {
  const counts: Record<string, number> = {};
  // Parent-before-child order so FK resolution subqueries find their target.
  const order = ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off'];
  const byName = new Map(SYNCED_TABLES.map((t) => [t.name, t]));

  for (const name of order) {
    const table = byName.get(name)!;
    counts[name] = await etlTable(sqlite, store, table);
  }
  return { counts };
}

/** Map a synthetic *_sync_id column back to the physical SQLite source. */
function fkSource(table: SyncTable): { col: string; parentTable: string } | null {
  switch (table.name) {
    case 'epics': return { col: 'project_sync_id', parentTable: 'projects' };
    case 'tasks': return { col: 'epic_sync_id', parentTable: 'epics' };
    case 'contracts': return { col: 'project_sync_id', parentTable: 'projects' };
    case 'worklogs': return { col: 'task_sync_id', parentTable: 'tasks' };
    default: return null;
  }
}

async function etlTable(sqlite: SqliteLike, store: PgStore, table: SyncTable): Promise<number> {
  const fk = fkSource(table);
  // Physical SQLite columns to read = descriptor columns minus the synthetic
  // *_sync_id (resolved via a JOIN) plus the real FK we need to join on.
  const physical = table.columns.filter((c) => !c.name.endsWith('_sync_id') || c.name === 'sync_id');
  const selectCols = physical.map((c) => `t.${c.name}`);
  let joinSql = '';
  if (fk) {
    const fkLocalCol = fk.col === 'project_sync_id' ? 'project_id' : fk.col === 'epic_sync_id' ? 'epic_id' : 'task_id';
    selectCols.push(`parent.sync_id AS ${fk.col}`);
    joinSql = ` JOIN ${fk.parentTable} parent ON parent.id = t.${fkLocalCol}`;
  }
  const rows = sqlite.prepare(`SELECT ${selectCols.join(', ')} FROM ${table.name} t${joinSql}`).all() as Array<Record<string, unknown>>;

  for (const row of rows) {
    const cols = table.columns.map((c) => c.name);
    const values = table.columns.map((c) => toPgValue(c.kind, row[c.name]));
    await upsertRow(store, table, cols, values, fk);
  }
  return rows.length;
}

/** Build + run an INSERT ... ON CONFLICT (sync_id) DO UPDATE for one row. */
async function upsertRow(
  store: PgStore,
  table: SyncTable,
  cols: string[],
  values: unknown[],
  fk: { col: string; parentTable: string } | null,
): Promise<void> {
  // Replace the synthetic *_sync_id column with a resolved-id subquery.
  const insertCols: string[] = [];
  const insertExprs: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const [i, col] of cols.entries()) {
    if (fk && col === fk.col) {
      insertCols.push(fk.col === 'project_sync_id' ? 'project_id' : fk.col === 'epic_sync_id' ? 'epic_id' : 'task_id');
      insertExprs.push(`(SELECT id FROM ${fk.parentTable} WHERE sync_id = $${p})`);
      params.push(values[i]); p++;
    } else {
      insertCols.push(col);
      insertExprs.push(`$${p}`);
      params.push(values[i]); p++;
    }
  }
  const updateAssignments = insertCols
    .filter((c) => c !== 'sync_id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');
  const sql = `
    INSERT INTO ${table.pgTable} (${insertCols.join(', ')})
    VALUES (${insertExprs.join(', ')})
    ON CONFLICT (sync_id) DO UPDATE SET ${updateAssignments}
  `;
  await store.query(sql, params);
}

/** CLI entrypoint: read prod SQLite (read-only) and ETL into local Postgres. */
async function main(): Promise<void> {
  const Database = (await import('better-sqlite3')).default;
  const prodPath = process.env.WATCHTOWER_PROD_DB
    ?? path.join(homedir(), 'Library', 'Application Support', 'Watchtower', 'data.db');
  const sqlite = new Database(prodPath, { readonly: true, fileMustExist: true }) as unknown as SqliteLike;

  const store = createPgStore();
  if (!store) {
    console.error('No WATCHTOWER_PG_URL / dev URL — aborting ETL.');
    process.exit(1);
  }
  await runPgMigrations(store);
  const report = await etlFromSqlite(sqlite, store);
  console.log('[etl] row counts:', report.counts);
  await store.end();
}

// Run only when invoked directly (tsx orchestrator/scripts/etl-timetracker.ts).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('[etl] failed:', err); process.exit(1); });
}
