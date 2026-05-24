import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import type { SqliteLike } from './migrations.js';

/**
 * One-shot migration that copies every row from the legacy TimeTracker
 * SQLite database into Watchtower's database, then renames the source so a
 * second invocation is a no-op.
 *
 * Triggered from bootstrap on every start (the marker check + source-exists
 * check together make it a no-op when there's nothing to do). Also callable
 * via IPC once the Settings UI lands in a later phase.
 *
 * Behaviour contract:
 *  - Idempotent: a marker row in `settings` (`timetracker_migration_status`)
 *    is set to "completed" on success. Re-running with the marker present
 *    returns `{ status: 'already-migrated' }` without touching either DB.
 *  - Transactional: the entire copy runs inside a single transaction. If
 *    anything throws, the destination is rolled back and the source file is
 *    left untouched.
 *  - Foreign-key safe: rows are inserted in dependency order (projects →
 *    project_rates → epics → tasks → worklogs → days_off). Primary keys are
 *    preserved so existing FKs in TimeTracker still resolve.
 *  - Non-destructive: the source file is renamed to
 *    `<original>.migrated-<ts>.bak`, never deleted, so a manual roll-back is
 *    possible.
 */

export type MigrationStatus =
  | { status: 'no-source' }
  | { status: 'already-migrated'; at: string }
  | {
      status: 'completed';
      sourcePath: string;
      backupPath: string;
      counts: TableCounts;
    };

export interface TableCounts {
  projects: number;
  project_rates: number;
  epics: number;
  tasks: number;
  worklogs: number;
  days_off: number;
}

const TABLES: Array<keyof TableCounts> = [
  'projects',
  'project_rates',
  'epics',
  'tasks',
  'worklogs',
  'days_off',
];

const COLUMNS: Record<keyof TableCounts, readonly string[]> = {
  projects: [
    'id',
    'name',
    'base_url',
    'color',
    'archived',
    'is_billable',
    'kind',
    'rate_type',
    'rate_amount',
    'currency',
    'hours_per_day',
    'is_default',
    'created_at',
  ],
  project_rates: [
    'id',
    'project_id',
    'effective_from',
    'rate_type',
    'rate_amount',
    'currency',
    'hours_per_day',
    'end_date',
    'md_limit',
    'created_at',
  ],
  epics: ['id', 'project_id', 'name', 'description', 'created_at'],
  tasks: [
    'id',
    'epic_id',
    'number',
    'title',
    'status',
    'estimated_minutes',
    'created_at',
  ],
  worklogs: [
    'id',
    'task_id',
    'description',
    'work_date',
    'minutes',
    'reported_minutes',
    'source',
    'external_id',
    'jira_uploaded',
    'created_at',
  ],
  days_off: ['date', 'kind', 'note', 'created_at'],
};

export interface MigrateOptions {
  /** Path to the legacy TimeTracker SQLite file. Default: `~/Library/Application Support/timetracker/data.db`. */
  sourcePath?: string;
  /** Inject the source-DB opener (tests use node:sqlite, prod uses better-sqlite3). */
  openSource?: (path: string) => SqliteLike & { close(): void };
  /** Provide the current timestamp (tests pin this for deterministic backup filenames). */
  now?: () => Date;
}

export function defaultTimetrackerSourcePath(): string {
  return path.join(homedir(), 'Library', 'Application Support', 'timetracker', 'data.db');
}

function defaultOpenSource(srcPath: string): SqliteLike & { close(): void } {
  // Use better-sqlite3 via createRequire so the orchestrator's TS build stays
  // ESM-only without dragging in a CJS resolution path at module load time.
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const db = new Database(srcPath, { readonly: true });
  return db as unknown as SqliteLike & { close(): void };
}

function ts(now: () => Date): string {
  const d = now();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export function migrateTimetracker(
  targetDb: SqliteLike,
  opts: MigrateOptions = {},
): MigrationStatus {
  const sourcePath = opts.sourcePath ?? defaultTimetrackerSourcePath();
  const openSource = opts.openSource ?? defaultOpenSource;
  const now = opts.now ?? (() => new Date());

  // Marker first — if migration already completed, leave the source DB alone.
  // (User may have placed a fresh export back at the canonical path; a second
  // run shouldn't overwrite their post-migration data.)
  const marker = targetDb
    .prepare(`SELECT value FROM settings WHERE key = 'timetracker_migration_status'`)
    .get() as { value: string } | undefined;
  if (marker?.value) {
    try {
      const parsed = JSON.parse(marker.value) as { status: string; at: string };
      if (parsed.status === 'completed') {
        return { status: 'already-migrated', at: parsed.at };
      }
    } catch {
      // fall through and re-run if the marker is unparseable
    }
  }

  if (!existsSync(sourcePath)) {
    return { status: 'no-source' };
  }

  const source = openSource(sourcePath);

  const counts: TableCounts = {
    projects: 0,
    project_rates: 0,
    epics: 0,
    tasks: 0,
    worklogs: 0,
    days_off: 0,
  };

  // Whole-migration transaction. better-sqlite3 has db.transaction() but the
  // SqliteLike surface doesn't expose it — manual BEGIN/COMMIT keeps the
  // contract minimal and lets node:sqlite tests use the same path.
  targetDb.exec('BEGIN IMMEDIATE');
  try {
    for (const table of TABLES) {
      const cols = COLUMNS[table];
      const colList = cols.join(', ');
      const placeholders = cols.map(() => '?').join(', ');

      const rows = source
        .prepare(`SELECT ${colList} FROM ${table}`)
        .all() as Array<Record<string, unknown>>;

      const insert = targetDb.prepare(
        `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`,
      );
      for (const row of rows) {
        insert.run(...cols.map((c) => row[c] ?? null));
      }
      counts[table] = rows.length;
    }

    const at = now().toISOString();
    targetDb
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('timetracker_migration_status', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(JSON.stringify({ status: 'completed', at, counts }));

    targetDb.exec('COMMIT');
  } catch (err) {
    targetDb.exec('ROLLBACK');
    source.close();
    throw err;
  }

  source.close();

  // Rename source so a second startup sees no-source and skips silently.
  const backupPath = `${sourcePath}.migrated-${ts(now)}.bak`;
  renameSync(sourcePath, backupPath);

  return { status: 'completed', sourcePath, backupPath, counts };
}
