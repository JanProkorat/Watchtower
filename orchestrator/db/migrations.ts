import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minimal subset of any SQLite driver we use (better-sqlite3 in prod, node:sqlite in tests). */
export interface SqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

const MIGRATIONS: Array<{ version: number; up: (db: SqliteLike) => void }> = [
  {
    version: 1,
    up: (db) => {
      const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      db.exec(sql);
    },
  },
  {
    version: 2,
    up: (db) => {
      // Adds a user-controllable tab order. Existing rows get spawned_at as
      // their default order so they remain in the historical order until the
      // user drags them around.
      db.exec(`ALTER TABLE instances ADD COLUMN display_order INTEGER`);
      db.exec(`UPDATE instances SET display_order = spawned_at WHERE display_order IS NULL`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_instances_display_order ON instances(display_order)`);
    },
  },
  {
    version: 3,
    up: (db) => {
      // TimeTracker absorption: add the 6 TT tables (projects, epics, tasks,
      // worklogs, project_rates, days_off) verbatim. See memory
      // `timetracker-absorption.md`. The actual row copy happens in
      // migrateTimetracker.ts, triggered from bootstrap when the legacy TT
      // data.db is detected.
      const sql = readFileSync(path.join(__dirname, 'timetracker_schema.sql'), 'utf8');
      db.exec(sql);
    },
  },
];

export function runMigrations(db: SqliteLike): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const row = db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number | null };
  const current = row.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    m.up(db);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      m.version,
      Date.now(),
    );
  }
}
