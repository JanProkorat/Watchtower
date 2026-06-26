// Postgres mirror of the 6 TimeTracker tables — refactored types + sync columns.
// Kept as TS string constants (not .sql files) so the migration runner just
// exec's them and we don't have to teach copy-orch-assets.mjs about pg DDL.
//
// Refactors vs the SQLite shape (design #69 §3-4):
//   SERIAL local PK (not the sync key); BOOLEAN for 0/1 flags; DATE for
//   date-only columns; TIMESTAMPTZ for created/updated/deleted; NUMERIC for
//   money/hours; JSONB for jira_globs. CHECK constraints + the partial unique
//   worklog index carry over verbatim.
//
// ON DELETE CASCADE is intentionally omitted from all FK references
// (epics.project_id, tasks.epic_id, worklogs.task_id, contracts.project_id).
// The sync model uses soft-delete (deleted_at tombstones) and never issues hard
// DELETEs — parent deletes propagate as explicit soft-delete cascades in the
// repository layer (design §3.6), so DB-level CASCADE would never fire and
// would only mask accidental hard-delete bugs.

const PROJECTS = `
CREATE TABLE IF NOT EXISTS projects (
  id                SERIAL PRIMARY KEY,
  sync_id           TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  base_url          TEXT,
  color             TEXT NOT NULL DEFAULT '#1976d2',
  archived          BOOLEAN NOT NULL DEFAULT false,
  is_billable       BOOLEAN NOT NULL DEFAULT false,
  kind              TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('work','time_off')),
  rate_type         TEXT NOT NULL DEFAULT 'hourly' CHECK (rate_type IN ('hourly','daily')),
  rate_amount       NUMERIC,
  currency          TEXT NOT NULL DEFAULT 'USD',
  hours_per_day     NUMERIC NOT NULL DEFAULT 8,
  is_default        BOOLEAN NOT NULL DEFAULT false,
  folder_path       TEXT,
  jira_globs        JSONB,
  description       TEXT,
  jira_board_url    TEXT,
  task_url_template TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_is_default ON projects(is_default) WHERE is_default = true;
`;

const EPICS = `
CREATE TABLE IF NOT EXISTS epics (
  id               SERIAL PRIMARY KEY,
  sync_id          TEXT NOT NULL UNIQUE,
  project_id       INTEGER NOT NULL REFERENCES projects(id),
  name             TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','done')),
  display_order    INTEGER,
  jira_epic_key    TEXT,
  shortcut         TEXT,
  github_issue_url TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_epics_project ON epics(project_id);
`;

const TASKS = `
CREATE TABLE IF NOT EXISTS tasks (
  id                 SERIAL PRIMARY KEY,
  sync_id            TEXT NOT NULL UNIQUE,
  epic_id            INTEGER NOT NULL REFERENCES epics(id),
  number             TEXT NOT NULL,
  title              TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','to_accept','done')),
  estimated_minutes  INTEGER,
  description        TEXT,
  jira_status        TEXT,
  jira_estimate_secs INTEGER,
  jira_component     TEXT,
  jira_synced_at     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tasks_epic ON tasks(epic_id);
CREATE INDEX IF NOT EXISTS idx_tasks_number ON tasks(number);
`;

const WORKLOGS = `
CREATE TABLE IF NOT EXISTS worklogs (
  id               SERIAL PRIMARY KEY,
  sync_id          TEXT NOT NULL UNIQUE,
  task_id          INTEGER NOT NULL REFERENCES tasks(id),
  description      TEXT,
  work_date        DATE NOT NULL,
  minutes          INTEGER NOT NULL CHECK (minutes > 0),
  reported_minutes INTEGER CHECK (reported_minutes IS NULL OR reported_minutes > 0),
  source           TEXT,
  external_id      TEXT,
  jira_uploaded    BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_worklogs_task ON worklogs(task_id);
CREATE INDEX IF NOT EXISTS idx_worklogs_date ON worklogs(work_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worklogs_external ON worklogs(source, external_id) WHERE source IS NOT NULL;
`;

const CONTRACTS = `
CREATE TABLE IF NOT EXISTS contracts (
  id             SERIAL PRIMARY KEY,
  sync_id        TEXT NOT NULL UNIQUE,
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  effective_from DATE NOT NULL,
  rate_type      TEXT NOT NULL CHECK (rate_type IN ('hourly','daily')),
  rate_amount    NUMERIC NOT NULL CHECK (rate_amount >= 0),
  currency       TEXT NOT NULL,
  hours_per_day  NUMERIC NOT NULL DEFAULT 8 CHECK (hours_per_day > 0),
  end_date       DATE,
  md_limit       NUMERIC CHECK (md_limit IS NULL OR md_limit > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  UNIQUE(project_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_contracts_pid_date ON contracts(project_id, effective_from);
`;

// days_off uses date as the natural PK (faithful to the SQLite source where date
// is the natural key). Nothing references days_off by FK and the local SERIAL id
// never crosses the sync wire, so no surrogate id column is needed.
const DAYS_OFF = `
CREATE TABLE IF NOT EXISTS days_off (
  sync_id    TEXT NOT NULL UNIQUE,
  date       DATE PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'vacation' CHECK (kind IN ('vacation','sick','holiday','other')),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
`;

const SYNC_CONFLICTS = `
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id            SERIAL PRIMARY KEY,
  table_name    TEXT NOT NULL,
  sync_id       TEXT NOT NULL,
  resolution    TEXT NOT NULL CHECK (resolution IN ('local_won','remote_won')),
  loser_side    TEXT NOT NULL CHECK (loser_side IN ('local','remote')),
  loser_payload JSONB NOT NULL,
  local_updated_at  TIMESTAMPTZ,
  remote_updated_at TIMESTAMPTZ,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_table ON sync_conflicts(table_name, sync_id);
`;

const WORKLOGS_BILLING = `
ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS effective_minutes INTEGER;
ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS resolved_rate     NUMERIC;
ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS rate_currency     TEXT;
ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS earned_amount     NUMERIC;
`;

export const PG_MIGRATIONS: Array<{ version: number; up: string[] }> = [
  {
    version: 1,
    up: [PROJECTS, EPICS, TASKS, WORKLOGS, CONTRACTS, DAYS_OFF, SYNC_CONFLICTS],
  },
  {
    version: 2,
    up: [
      `DROP INDEX IF EXISTS idx_worklogs_external;`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_worklogs_external ON worklogs(source, external_id) WHERE source IS NOT NULL AND deleted_at IS NULL;`,
    ],
  },
  {
    version: 3,
    up: [WORKLOGS_BILLING],
  },
  {
    version: 4,
    up: [
      // Enable RLS + authenticated-SELECT policy on each client-readable table.
      // sync_conflicts is internal — left without RLS.
      // Idempotent: ALTER TABLE … ENABLE ROW LEVEL SECURITY is safe to re-run;
      // DROP POLICY IF EXISTS avoids the pre-PG15 lack of CREATE POLICY IF NOT EXISTS.
      `ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_authenticated ON projects;
CREATE POLICY read_authenticated ON projects FOR SELECT TO authenticated USING (true);`,
      `ALTER TABLE epics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_authenticated ON epics;
CREATE POLICY read_authenticated ON epics FOR SELECT TO authenticated USING (true);`,
      `ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_authenticated ON tasks;
CREATE POLICY read_authenticated ON tasks FOR SELECT TO authenticated USING (true);`,
      `ALTER TABLE worklogs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_authenticated ON worklogs;
CREATE POLICY read_authenticated ON worklogs FOR SELECT TO authenticated USING (true);`,
      `ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_authenticated ON contracts;
CREATE POLICY read_authenticated ON contracts FOR SELECT TO authenticated USING (true);`,
      `ALTER TABLE days_off ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_authenticated ON days_off;
CREATE POLICY read_authenticated ON days_off FOR SELECT TO authenticated USING (true);`,
    ],
  },
];
