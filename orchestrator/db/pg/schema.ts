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

// notes: unified note/todo. project_id is NULLABLE — a Global note has no
// project. First synced table with a nullable parent FK (design note in
// orchestrator/sync/push.ts + pull.ts fkSource: LEFT JOIN + null-safe resolve).
const NOTES = `
CREATE TABLE IF NOT EXISTS notes (
  id             SERIAL PRIMARY KEY,
  sync_id        TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  done           INTEGER,
  done_at        TIMESTAMPTZ,
  due_date       DATE,
  priority       TEXT NOT NULL DEFAULT 'none',
  pinned         BOOLEAN NOT NULL DEFAULT false,
  project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
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
      // Portability: `authenticated` is a Supabase built-in role. On a plain
      // Postgres (local dev / the test harness) it does not exist, so the
      // CREATE POLICY is guarded by a role-existence check — RLS is still
      // enabled (the table-owning sync role bypasses it), the policy is simply
      // skipped where the client role is absent. On Supabase the role exists
      // and the authenticated-SELECT policy is created as intended.
      ...['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off'].map(
        (t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_authenticated ON ${t};
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY read_authenticated ON ${t} FOR SELECT TO authenticated USING (true);
  END IF;
END $$;`,
      ),
    ],
  },
  {
    version: 5,
    up: [
      `ALTER TABLE contracts DROP COLUMN IF EXISTS currency;`,
      `ALTER TABLE projects DROP COLUMN IF EXISTS currency;`,
      `ALTER TABLE worklogs DROP COLUMN IF EXISTS rate_currency;`,
    ],
  },
  {
    version: 6,
    up: [
      // Write-back slice 1: allow authenticated INSERT/UPDATE on days_off (soft-delete
      // is an UPDATE). Mirrors the v4 read policy: idempotent + role-guarded so plain
      // Postgres (dev/test, no `authenticated` role) still applies cleanly.
      `ALTER TABLE days_off ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_authenticated ON days_off;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON days_off FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;`,
    ],
  },
  {
    version: 7,
    up: [
      // Write-back slice 2: allow authenticated INSERT/UPDATE on worklogs (soft-delete
      // is an UPDATE). Mirrors v6/v4: idempotent + role-guarded so plain Postgres
      // (dev/test, no `authenticated` role) still applies cleanly.
      `ALTER TABLE worklogs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_authenticated ON worklogs;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON worklogs FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;`,
    ],
  },
  {
    version: 8,
    up: [
      // Write-back slice 3a: allow authenticated INSERT/UPDATE on tasks (soft-delete
      // is an UPDATE). Mirrors v6/v7: idempotent + role-guarded so plain Postgres
      // (dev/test, no `authenticated` role) still applies cleanly.
      `ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_authenticated ON tasks;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;`,
    ],
  },
  {
    version: 9,
    up: [
      // Write-back slice 3b: allow authenticated INSERT/UPDATE on contracts (soft-delete
      // is an UPDATE; auto-closing the prior contract is an UPDATE). Mirrors v6/v7/v8:
      // idempotent + role-guarded so plain Postgres (dev/test, no `authenticated` role)
      // still applies cleanly.
      `ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_authenticated ON contracts;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON contracts FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;`,
    ],
  },
  {
    version: 10,
    up: [
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_group_id TEXT;`,
      `CREATE INDEX IF NOT EXISTS idx_contracts_group ON contracts(contract_group_id);`,
    ],
  },
  {
    version: 11,
    up: [
      // Pinned projects: drop the one-default partial-unique index and rename
      // the column to match SQLite. Guarded rename (Postgres has no
      // RENAME COLUMN IF EXISTS) so a fresh DB that already reached is_pinned
      // is a no-op; the version guard prevents re-runs on existing DBs.
      `DROP INDEX IF EXISTS idx_projects_is_default;`,
      `DO $$ BEGIN
         IF EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'projects' AND column_name = 'is_default')
            AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'projects' AND column_name = 'is_pinned') THEN
           ALTER TABLE projects RENAME COLUMN is_default TO is_pinned;
         END IF;
       END $$;`,
    ],
  },
  {
    version: 12,
    up: [
      `CREATE TABLE IF NOT EXISTS attention_messages (
         id            BIGSERIAL PRIMARY KEY,
         sync_id       TEXT UNIQUE NOT NULL,
         instance_id   TEXT NOT NULL,
         project_label TEXT,
         role          TEXT NOT NULL,
         kind          TEXT,
         body          TEXT,
         options       JSONB,
         reply_to      TEXT,
         injected_at   TIMESTAMPTZ,
         closed_at     TIMESTAMPTZ,
         created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS idx_attn_instance ON attention_messages(instance_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_attn_pending_user ON attention_messages(role, injected_at)
         WHERE role = 'user' AND injected_at IS NULL`,
      // RLS + authenticated policies/grants. Role-guarded (mirrors v4/v6-v9) so
      // a plain Postgres (local dev / test harness) without the Supabase-built-in
      // `authenticated` role still applies cleanly: RLS is enabled unconditionally,
      // the policies and grants are skipped where the client role is absent.
      // Idempotent: ENABLE RLS is re-run-safe; DROP POLICY IF EXISTS precedes each
      // CREATE POLICY. The sequence GRANT lives inside the guard (also role-scoped).
      `ALTER TABLE attention_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attn_read ON attention_messages;
DROP POLICY IF EXISTS attn_write ON attention_messages;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY attn_read ON attention_messages FOR SELECT TO authenticated USING (true);
    CREATE POLICY attn_write ON attention_messages FOR INSERT TO authenticated WITH CHECK (role = 'user');
    GRANT SELECT, INSERT ON attention_messages TO authenticated;
    GRANT USAGE, SELECT ON SEQUENCE attention_messages_id_seq TO authenticated;
  END IF;
END $$;`,
      `CREATE TABLE IF NOT EXISTS push_devices (
         id            BIGSERIAL PRIMARY KEY,
         apns_token    TEXT UNIQUE NOT NULL,
         platform      TEXT NOT NULL DEFAULT 'ios',
         registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pushdev_write ON push_devices;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY pushdev_write ON push_devices FOR INSERT TO authenticated WITH CHECK (true);
    GRANT INSERT ON push_devices TO authenticated;
    GRANT USAGE, SELECT ON SEQUENCE push_devices_id_seq TO authenticated;
  END IF;
END $$;`,
    ],
  },
  {
    version: 13,
    up: [
      `ALTER TABLE push_devices
         ADD COLUMN IF NOT EXISTS bundle_id TEXT NOT NULL
         DEFAULT 'cz.greencode.watchtower.ipad'`,
    ],
  },
  {
    version: 14,
    up: [
      NOTES,
      // RLS: authenticated clients may read; writes are Mac-only (service role).
      // Mirrors the read_authenticated pattern from v4 (projects/epics/…):
      // idempotent + role-guarded so plain Postgres (local dev / test harness,
      // no Supabase-built-in `authenticated` role) still applies cleanly — RLS
      // is enabled unconditionally, the policy is skipped where the role is absent.
      `ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_authenticated ON notes;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY read_authenticated ON notes FOR SELECT TO authenticated USING (true);
  END IF;
END $$;`,
    ],
  },
];
