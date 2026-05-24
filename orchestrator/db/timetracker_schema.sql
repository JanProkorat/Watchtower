-- TimeTracker schema — verbatim port from the now-deprecated TimeTracker app.
--
-- "Verbatim" is deliberate: column names, defaults, and check constraints all
-- match TimeTracker's latest schema (schema.sql + the column-add migrations in
-- server/migrations.ts that landed before deprecation). Refactors live in a
-- separate follow-up issue per the absorption decision, so the migration that
-- copies data into these tables can be a dumb 1:1 INSERT.
--
-- See memory: timetracker-absorption.md

CREATE TABLE IF NOT EXISTS projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  base_url        TEXT,
  color           TEXT    NOT NULL DEFAULT '#1976d2',
  archived        INTEGER NOT NULL DEFAULT 0,
  is_billable     INTEGER NOT NULL DEFAULT 0,
  kind            TEXT    NOT NULL DEFAULT 'work'
                    CHECK (kind IN ('work','time_off')),
  rate_type       TEXT    NOT NULL DEFAULT 'hourly'
                    CHECK (rate_type IN ('hourly','daily')),
  rate_amount     REAL,
  currency        TEXT    NOT NULL DEFAULT 'USD',
  hours_per_day   REAL    NOT NULL DEFAULT 8,
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Partial unique index — at most one project can be is_default = 1 at a time.
-- The PATCH handler in Phase 14 will clear the previous default in the same
-- transaction when setting a new one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_is_default
  ON projects(is_default) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS epics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  description TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_epics_project ON epics(project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  epic_id           INTEGER NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  number            TEXT    NOT NULL,
  title             TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','in_progress','done')),
  estimated_minutes INTEGER,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_epic   ON tasks(epic_id);
CREATE INDEX IF NOT EXISTS idx_tasks_number ON tasks(number);

CREATE TABLE IF NOT EXISTS worklogs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  description      TEXT,
  work_date        TEXT    NOT NULL,
  minutes          INTEGER NOT NULL CHECK (minutes > 0),
  reported_minutes INTEGER CHECK (reported_minutes IS NULL OR reported_minutes > 0),
  source           TEXT,
  external_id      TEXT,
  jira_uploaded    INTEGER NOT NULL DEFAULT 0 CHECK (jira_uploaded IN (0, 1)),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_worklogs_task ON worklogs(task_id);
CREATE INDEX IF NOT EXISTS idx_worklogs_date ON worklogs(work_date);

-- Partial unique index on (source, external_id) — the dedupe key for
-- automatically-synced worklogs (Jira, Outlook, watchtower-auto). NULL source
-- skips the constraint so manual entries don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_worklogs_external
  ON worklogs(source, external_id) WHERE source IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_rates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  effective_from TEXT    NOT NULL,
  rate_type      TEXT    NOT NULL CHECK (rate_type IN ('hourly','daily')),
  rate_amount    REAL    NOT NULL CHECK (rate_amount >= 0),
  currency       TEXT    NOT NULL,
  hours_per_day  REAL    NOT NULL DEFAULT 8 CHECK (hours_per_day > 0),
  end_date       TEXT,
  md_limit       REAL    CHECK (md_limit IS NULL OR md_limit > 0),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_project_rates_pid_date
  ON project_rates(project_id, effective_from);

CREATE TABLE IF NOT EXISTS days_off (
  date       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'vacation'
                CHECK (kind IN ('vacation','sick','holiday','other')),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
