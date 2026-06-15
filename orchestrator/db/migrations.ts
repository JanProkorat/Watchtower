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
  {
    version: 5,
    up: (db) => {
      // Phase 15 additions to the TT-verbatim shape — surface fields the
      // prototype's epic + task drawers need:
      //   epics.display_order      — manual tree ordering (steps of 1000 like
      //                              instances; new rows append at the end)
      //   epics.status             — planned / active / done (drives the
      //                              prototype's status pill + filtering)
      //   epics.jira_epic_key      — optional Jira Epic Link (TEH-100 etc.)
      //   epics.github_issue_url   — optional GitHub issue URL
      //   tasks.description        — long-form task note shown in the drawer
      db.exec(`ALTER TABLE epics ADD COLUMN display_order INTEGER`);
      db.exec(`ALTER TABLE epics ADD COLUMN status TEXT NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned','active','done'))`);
      db.exec(`ALTER TABLE epics ADD COLUMN jira_epic_key TEXT`);
      db.exec(`ALTER TABLE epics ADD COLUMN github_issue_url TEXT`);
      db.exec(`ALTER TABLE tasks ADD COLUMN description TEXT`);

      // Backfill display_order so existing rows keep their historical order
      // until the user manually reorders. Per-project ordering using
      // (project_id, id) so the sequence starts fresh in each project.
      db.exec(`UPDATE epics SET display_order = (id * 1000) WHERE display_order IS NULL`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_epics_display_order
                 ON epics(project_id, display_order)`);
    },
  },
  {
    version: 6,
    up: (db) => {
      // Phase 31 Jira Kanban board — cached per-task Jira metadata,
      // populated only while a task is on the user's current board
      // (i.e. in the latest sync's result set). `jira_status IS NULL`
      // is the "not on board" sentinel.
      db.exec(`ALTER TABLE tasks ADD COLUMN jira_status TEXT`);
      db.exec(`ALTER TABLE tasks ADD COLUMN jira_estimate_secs INTEGER`);
      db.exec(`ALTER TABLE tasks ADD COLUMN jira_component TEXT`);
      db.exec(`ALTER TABLE tasks ADD COLUMN jira_synced_at TEXT`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_jira_status
                 ON tasks(jira_status) WHERE jira_status IS NOT NULL`);
    },
  },
  {
    version: 7,
    up: (db) => {
      // Per-project Jira board URL. Stored verbatim (the rapidView /
      // quickFilter ids are parsed at sync time) so the user can paste
      // a full board URL from the browser without thinking about it.
      // NULL = no board configured = project doesn't appear in the
      // Board tab's project selector.
      db.exec(`ALTER TABLE projects ADD COLUMN jira_board_url TEXT`);
    },
  },
  {
    version: 8,
    up: (db) => {
      // Per-epic shortcut for substring routing during board sync. When a
      // task's linked Jira epic name CONTAINS this string, the task is
      // assigned to the local epic. Lets one local "Technology" epic
      // collect everything from Jira epics named "TEH - …", "TEH-456",
      // etc. NULL means the epic doesn't participate in shortcut routing.
      db.exec(`ALTER TABLE epics ADD COLUMN shortcut TEXT`);
    },
  },
  {
    version: 9,
    up: (db) => {
      // Widen tasks.status to include 'to_accept' so the local enum matches
      // the board's four columns (todo/doing/to_accept/done). Until now the
      // 'To Accept' / 'In Test' Jira columns were folded into 'in_progress'
      // locally, which made the task editor lie about the state. SQLite
      // can't ALTER a CHECK constraint, so we rebuild the table and copy
      // every row across, flipping rows that are currently on the board's
      // to_accept column to the new local value.
      db.exec(`PRAGMA foreign_keys = OFF`);
      db.exec(`
        CREATE TABLE tasks_new (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          epic_id            INTEGER NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
          number             TEXT    NOT NULL,
          title              TEXT    NOT NULL,
          status             TEXT    NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open','in_progress','to_accept','done')),
          estimated_minutes  INTEGER,
          created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
          description        TEXT,
          jira_status        TEXT,
          jira_estimate_secs INTEGER,
          jira_component     TEXT,
          jira_synced_at     TEXT
        );
        INSERT INTO tasks_new (
          id, epic_id, number, title, status, estimated_minutes, created_at,
          description, jira_status, jira_estimate_secs, jira_component, jira_synced_at
        )
        SELECT
          id, epic_id, number, title,
          CASE
            WHEN jira_status IN ('In Test', 'To Accept') THEN 'to_accept'
            ELSE status
          END,
          estimated_minutes, created_at,
          description, jira_status, jira_estimate_secs, jira_component, jira_synced_at
        FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
        CREATE INDEX IF NOT EXISTS idx_tasks_epic ON tasks(epic_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_number ON tasks(number);
        CREATE INDEX IF NOT EXISTS idx_tasks_jira_status
          ON tasks(jira_status) WHERE jira_status IS NOT NULL;
      `);
      db.exec(`PRAGMA foreign_keys = ON`);
    },
  },
  {
    version: 10,
    up: (db) => {
      // Per-project URL template for opening a task in its issue tracker.
      // Stored as a literal string with a `{n}` placeholder that is replaced
      // with the task number at link build time, e.g.:
      //   https://jira.skoda.vwgroup.com/browse/{n}
      // NULL = no template configured = no open-in-new link on task rows.
      db.exec(`ALTER TABLE projects ADD COLUMN task_url_template TEXT`);
    },
  },
  {
    version: 11,
    up: (db) => {
      const cols = db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === 'kind')) return; // fresh install already has it
      // Plain-terminal support: instances are now either a managed `claude`
      // session ('claude') or a plain interactive shell ('shell'). Existing
      // rows backfill to 'claude' via the default. See
      // docs/superpowers/specs/2026-06-15-plain-terminal-instances-design.md.
      db.exec(
        `ALTER TABLE instances ADD COLUMN kind TEXT NOT NULL DEFAULT 'claude'`,
      );
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
