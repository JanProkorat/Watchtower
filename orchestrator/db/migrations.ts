import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

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

/** True if `name` is an existing table. Used to make table-level DDL replay-safe. */
function tableExists(db: SqliteLike, name: string): boolean {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name) != null
  );
}

/**
 * ALTER TABLE ADD COLUMN that is a no-op if the column already exists. SQLite
 * has no `ADD COLUMN IF NOT EXISTS`, so a bare ADD COLUMN throws on replay; this
 * keeps a partially-applied migration recoverable on the next run.
 */
function addColumnIfMissing(db: SqliteLike, table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
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
  {
    version: 12,
    up: (db) => {
      const cols = db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === 'task_id')) return; // fresh install already has it
      // Phase A: tag an instance to a TimeTracker task. ON DELETE SET NULL so
      // deleting a task doesn't orphan or block instance rows.
      db.exec(
        `ALTER TABLE instances ADD COLUMN task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL`,
      );
    },
  },
  {
    version: 13,
    up: (db) => {
      // #69 TimeTracker → Postgres sync: add cross-store sync columns to the 6
      // synced tables, rename project_rates → contracts, and backfill sync_id +
      // updated_at on existing rows so the SQLite and Postgres stores start
      // aligned (cursor = max(updated_at)). Operational tables (instances,
      // hook_events, notifications, settings) are NOT synced and untouched.
      // updated_at gets a NOT NULL default in ISO-Z form so the SQL default and
      // JS-set values share the same byte format (LWW comparison key). It MUST
      // be a constant literal, not an expression: SQLite rejects a non-constant
      // (e.g. strftime(...)) default in ALTER TABLE ADD COLUMN — the prod engine
      // (better-sqlite3) throws on it, while node:sqlite (tests) silently allows
      // it. Existing rows are backfilled to a real timestamp in step 3; new rows
      // always get updated_at from the repo layer, so this sentinel only fills
      // the instant between ADD COLUMN and the backfill UPDATE.
      const ISO_DEFAULT = `'1970-01-01T00:00:00.000Z'`;

      // 1) Rename the table. Guarded so a replay (after a partial apply that
      //    already renamed it) is a no-op rather than a "no such table" throw.
      //    SQLite ALTER TABLE RENAME preserves indexes/FKs (child FKs referencing
      //    project_rates are by table and SQLite rewrites them on rename). The
      //    unique index name is historical; recreate it under the new name.
      if (tableExists(db, 'project_rates') && !tableExists(db, 'contracts')) {
        db.exec(`ALTER TABLE project_rates RENAME TO contracts`);
      }
      db.exec(`DROP INDEX IF EXISTS idx_project_rates_pid_date`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_contracts_pid_date ON contracts(project_id, effective_from)`,
      );

      // 2) Add sync columns to each synced table (replay-safe: skip columns that
      //    already exist).
      const tables = ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off'];
      for (const t of tables) {
        addColumnIfMissing(db, t, 'sync_id', 'TEXT');
        addColumnIfMissing(db, t, 'updated_at', `TEXT NOT NULL DEFAULT ${ISO_DEFAULT}`);
        addColumnIfMissing(db, t, 'deleted_at', 'TEXT');
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_sync_id ON ${t}(sync_id)`);
      }

      // 3) Backfill: every existing row that doesn't yet have a sync_id gets a
      //    fresh UUID sync_id and an updated_at seeded from created_at
      //    (normalised to ISO-Z). The `sync_id IS NULL` filter keeps a replay
      //    from re-stamping rows a prior partial run already backfilled.
      //    days_off is keyed by `date`, the others by integer id.
      const normaliseTs = (raw: string | null): string => {
        // SQLite created_at is 'YYYY-MM-DD HH:MM:SS' (UTC). Convert to ISO-Z.
        if (!raw) return new Date().toISOString();
        const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      };

      for (const t of tables) {
        const keyCol = t === 'days_off' ? 'date' : 'id';
        const rows = db
          .prepare(`SELECT ${keyCol} AS k, created_at FROM ${t} WHERE sync_id IS NULL`)
          .all() as Array<{ k: string | number; created_at: string | null }>;
        const upd = db.prepare(
          `UPDATE ${t} SET sync_id = ?, updated_at = ? WHERE ${keyCol} = ?`,
        );
        for (const r of rows) {
          upd.run(randomUUID(), normaliseTs(r.created_at), r.k);
        }
      }
    },
  },
  {
    version: 14,
    up: (db) => {
      // #69: exclude tombstones from the worklog (source, external_id) unique index
      // so a soft-deleted auto-import doesn't block re-creating/re-importing the
      // same external worklog, and so a new-sync_id row can't collide on a
      // non-sync_id index and wedge the LWW upsert.
      db.exec(`DROP INDEX IF EXISTS idx_worklogs_external`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_worklogs_external ON worklogs(source, external_id) WHERE source IS NOT NULL AND deleted_at IS NULL`);
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
