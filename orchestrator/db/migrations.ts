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
  {
    version: 4,
    up: (db) => {
      // Watchtower-specific extensions to the verbatim TT projects schema —
      // these columns don't exist in TimeTracker but the Watchtower module
      // surfaces them in the project drawer:
      //   - folder_path: local working directory (powers the Instances bridge
      //     in Phase 21 and the "Open in VS Code" action)
      //   - jira_globs: JSON array of shell-style globs (e.g. ["FIE1933-*"])
      //     for Jira-key resolution on worklog sync
      //   - description: long-form note shown in the drawer
      db.exec(`ALTER TABLE projects ADD COLUMN folder_path TEXT`);
      db.exec(`ALTER TABLE projects ADD COLUMN jira_globs TEXT`);
      db.exec(`ALTER TABLE projects ADD COLUMN description TEXT`);
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
