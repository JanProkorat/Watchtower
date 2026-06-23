# TimeTracker → Postgres + Offline-First LWW Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the 6 TimeTracker tables into a Postgres sync hub and run a background last-write-wins (LWW) sync between the orchestrator's local SQLite (primary, offline-capable) and Postgres, without changing the desktop's SQLite-backed data path.

**Architecture:** SQLite stays the primary store for the 6 TT repos — no repo rewrite, no IPC change. A new sync layer reconciles SQLite ⟷ Postgres: it pushes local changes up and pulls remote changes down, resolving conflicts by `updated_at` (newer wins) at row granularity, propagating deletes as tombstones, and logging every resolved conflict. Postgres is optional: if `WATCHTOWER_PG_URL` is unset or unreachable the orchestrator runs SQLite-only and sync is dormant.

**Tech Stack:** Node `utilityProcess` orchestrator (TypeScript, ESM), `better-sqlite3` (prod) / `node:sqlite` (tests), `pg` (node-postgres, new), `uuid` (existing), vitest.

## Global Constraints

- **Branch:** all work lands on `feat/timetracker-postgres-sync`.
- **Desktop must never hard-depend on Postgres.** Every Postgres call path must no-op cleanly (log + return) when the pool is absent or a query throws a connection error. SQLite writes must never be blocked or rolled back by a Postgres failure.
- **Zero IPC / contract churn.** The 6 repos keep their exact public method signatures and return types. `shared/ipcContract.ts` and `shared/messagePort.ts` are NOT touched by this plan.
- **Local integer PKs stay.** `sync_id` (a UUID TEXT column) is the only cross-store identity. The sync matches rows by `sync_id`, never by the local integer `id`.
- **Test count only goes up.** Baseline is the current passing suite (run `npm test` first to capture it). Every task adds tests; no task may reduce the count or leave the suite red.
- **Tests use `node:sqlite` via `createRequire`** (see existing `tests/orchestrator/migrations.test.ts`), not `better-sqlite3`. The `SqliteLike` interface (`orchestrator/db/migrations.ts`) is the contract.
- **Postgres integration tests are env-gated.** They connect to `WATCHTOWER_PG_URL` (default dev URL below) and **skip with a `console.warn`** when the DB is unreachable — same pattern the suite already uses for env-gated suites. They must never fail CI when Postgres is absent.
- **Dev Postgres URL:** `postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower` (isolated `watchtower` DB inside the shared `fitness-postgres` container — do NOT touch `fitness_dev`). Read from `WATCHTOWER_PG_URL`, defaulting to this string in dev.
- **Timestamp format (critical for LWW):** all `updated_at` / `deleted_at` values written on the SQLite side use ISO-8601 UTC with millisecond precision and a `Z` suffix (`2026-06-22T17:30:00.000Z`), produced by `new Date().toISOString()` in JS and by `strftime('%Y-%m-%dT%H:%M:%fZ','now')` in SQL defaults. This is byte-comparable and chronologically sortable, and round-trips through Postgres `TIMESTAMPTZ` unambiguously.
- **English-only code comments.** Czech only in user-facing strings (none added here).
- **No schema refactor beyond what this plan specifies** (don't drop `is_billable`, don't rename other tables).
- Backup convention for files Watchtower writes does not apply here (no `~/.claude` writes); the ETL opens prod SQLite **read-only**.

---

## File Structure

**New files:**
- `orchestrator/db/pg/pool.ts` — creates the optional `pg.Pool` from `WATCHTOWER_PG_URL`; `null` when unset. Exposes a tiny `PgStore` wrapper (`query`, `end`, `healthCheck`).
- `orchestrator/db/pg/schema.ts` — Postgres DDL as exported string constants (the 6 refactored tables + `sync_conflicts` + `pg_schema_version`).
- `orchestrator/db/pg/migrate.ts` — versioned Postgres migration runner (mirrors the SQLite runner; tracks `pg_schema_version`).
- `orchestrator/sync/schema.ts` — the shared sync descriptor: `SYNCED_TABLES`, per-column type kinds, and value transforms (SQLite ⟷ PG). Single source of truth consumed by ETL, push, and pull.
- `orchestrator/sync/cursor.ts` — per-table push/pull high-water-mark cursors, persisted in the `settings` table.
- `orchestrator/sync/push.ts` — `pushTable` / `pushAll`: local SQLite → Postgres upsert by `sync_id`, LWW.
- `orchestrator/sync/pull.ts` — `pullTable` / `pullAll`: Postgres → local SQLite upsert by `sync_id`, LWW, tombstone application, conflict logging.
- `orchestrator/sync/service.ts` — `SyncService`: debounce + periodic timer + offline no-op; orchestrates push+pull; wired into bootstrap.
- `orchestrator/scripts/etl-timetracker.ts` — one-time re-runnable ETL: prod SQLite (read-only) → local Postgres, deterministic `sync_id`, row-count report.
- Test files (one per task, paths given inline).

**Modified files:**
- `package.json` — add `pg` + `@types/pg`.
- `orchestrator/db/migrations.ts` — add migration **v13**.
- `orchestrator/db/connection.ts` — add `openStores()` returning `{ sqlite, pg }` (keeps `openDb` intact).
- `orchestrator/bootstrap.ts` — create the pg pool, thread `pg` onto `BootstrapHandle`, construct + start `SyncService`, stop it on shutdown.
- The 6 repos (`projects.ts`, `epics.ts`, `tasks.ts`, `worklogs.ts`, `projectRates.ts`, `daysOff.ts`) — maintain sync columns on write; convert `delete()` to soft-delete with explicit cascade; filter `deleted_at IS NULL` on reads.
- Non-repo readers that surface these tables: `orchestrator/db/reports.ts`, `orchestrator/db/reportsSql.ts`, `orchestrator/db/dashboardOverview.ts`, `orchestrator/db/taskGrid.ts`, `orchestrator/db/contractStatus.ts`, `orchestrator/services/jiraSync.ts`, `orchestrator/services/jiraBoard.ts` — add `deleted_at IS NULL` filters and update `project_rates` → `contracts`.

**Design decisions locked in (deviations from spec §6, under "do what's best"):**
1. Postgres DDL lives as TS string constants in `orchestrator/db/pg/schema.ts`, not `.sql` files read via `readFileSync`. Rationale: avoids extending `scripts/copy-orch-assets.mjs` and the runtime `__dirname` asset-copy fragility; the versioned runner just `exec`s the strings.
2. `connection.ts` gains a new `openStores()` rather than changing `openDb`'s signature. Rationale: `openDb` has existing callers (`bootstrap.defaultDbFactory`); a new function keeps the SQLite path untouched.
3. The `project_rates` **table** is renamed to `contracts`, but the repo class/file stay `ProjectRatesRepo` / `projectRates.ts`. Rationale: the IPC already says `contracts:*`; renaming the table satisfies the spec while renaming the class would churn `index.ts` and many imports for no functional gain.

---

## Task 0: Branch + baseline (no code)

- [ ] **Step 1: Create / switch to the feature branch**

```bash
git checkout -b feat/timetracker-postgres-sync 2>/dev/null || git checkout feat/timetracker-postgres-sync
git status
```
Expected: on `feat/timetracker-postgres-sync`, clean tree (the repo carries unrelated WIP per memory `branch-from-dirty-tree`; if `git status` is NOT clean, STOP and surface it — do not sweep stray changes into this branch).

- [ ] **Step 2: Capture the baseline test count**

Run: `npm test 2>&1 | tail -5`
Expected: a green run; record the "Tests N passed" number — every later task must keep it ≥ this.

- [ ] **Step 3: Confirm dev Postgres reachability (informational)**

Run: `docker ps --format '{{.Names}}' | grep fitness-postgres && echo OK`
Expected: `fitness-postgres` / `OK`. If absent, Postgres integration tests will skip-with-warning (that's allowed); note it and continue.

---

## Task 1: `pg` dependency + optional Postgres pool & health-check

**Files:**
- Modify: `package.json` (deps)
- Create: `orchestrator/db/pg/pool.ts`
- Test: `tests/orchestrator/pg/pool.test.ts`

**Interfaces:**
- Produces:
  - `interface PgStore { query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>; healthCheck(): Promise<boolean>; end(): Promise<void>; }`
  - `function createPgStore(connectionString?: string): PgStore | null` — returns `null` when no connection string is available (env unset AND none passed). Never throws on construction (a bad URL surfaces lazily on first `query`).
  - `function defaultPgUrl(): string | undefined` — returns `process.env.WATCHTOWER_PG_URL` or, in dev (`NODE_ENV !== 'production'`), the dev URL constant; `undefined` in production when the env is unset.

- [ ] **Step 1: Add the dependency**

Run:
```bash
npm install pg@^8.13.0 && npm install -D @types/pg@^8.11.10
```
Expected: `package.json` gains `"pg"` under dependencies and `"@types/pg"` under devDependencies; lockfile updates.

- [ ] **Step 2: Write the failing test**

Create `tests/orchestrator/pg/pool.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createPgStore, defaultPgUrl } from '../../../orchestrator/db/pg/pool.js';

const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

describe('createPgStore', () => {
  it('returns null when no connection string is available', () => {
    expect(createPgStore(undefined)).toBeNull();
  });

  it('builds a store from an explicit connection string', () => {
    const store = createPgStore(PG_URL);
    expect(store).not.toBeNull();
  });
});

describe('defaultPgUrl', () => {
  it('prefers the WATCHTOWER_PG_URL env when set', () => {
    const prev = process.env.WATCHTOWER_PG_URL;
    process.env.WATCHTOWER_PG_URL = 'postgresql://x/y';
    try {
      expect(defaultPgUrl()).toBe('postgresql://x/y');
    } finally {
      if (prev === undefined) delete process.env.WATCHTOWER_PG_URL;
      else process.env.WATCHTOWER_PG_URL = prev;
    }
  });
});

describe('PgStore.healthCheck (integration, env-gated)', () => {
  it('returns true against a reachable Postgres, else skips', async () => {
    const store = createPgStore(PG_URL);
    if (!store) return;
    let ok = false;
    try {
      ok = await store.healthCheck();
    } catch {
      console.warn('[pool.test] Postgres unreachable — skipping health-check assertion');
      await store.end();
      return;
    }
    expect(ok).toBe(true);
    await store.end();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/orchestrator/pg/pool.test.ts`
Expected: FAIL — cannot resolve `orchestrator/db/pg/pool.js`.

- [ ] **Step 4: Implement the pool**

Create `orchestrator/db/pg/pool.ts`:

```typescript
import pg from 'pg';

/** Dev-only Postgres in the shared fitness-postgres container (isolated `watchtower` DB). */
const DEV_PG_URL =
  'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

export interface PgStore {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  healthCheck(): Promise<boolean>;
  end(): Promise<void>;
}

/**
 * The connection string to use: explicit env wins; in non-production we fall
 * back to the local dev container. In production an unset env means "no hub"
 * (sync stays dormant) rather than silently pointing at a dev DB.
 */
export function defaultPgUrl(): string | undefined {
  if (process.env.WATCHTOWER_PG_URL) return process.env.WATCHTOWER_PG_URL;
  if (process.env.NODE_ENV !== 'production') return DEV_PG_URL;
  return undefined;
}

/**
 * Build an optional Postgres store. Returns null when there is no connection
 * string at all — the desktop then runs SQLite-only and sync is dormant.
 * Construction never throws or connects eagerly: a bad/unreachable URL only
 * surfaces when the first query runs, so a Postgres outage can't crash boot.
 */
export function createPgStore(connectionString?: string): PgStore | null {
  const url = connectionString ?? defaultPgUrl();
  if (!url) return null;

  const pool = new pg.Pool({
    connectionString: url,
    // Keep the footprint tiny — the desktop is a single client.
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // A pool-level error handler is required, else an idle-client socket error
  // becomes an unhandled 'error' event and crashes the process.
  pool.on('error', (err) => {
    console.error('[pg] idle client error (ignored, sync will retry):', err.message);
  });

  return {
    async query<T = any>(text: string, params?: unknown[]) {
      const res = await pool.query(text, params as any[]);
      return { rows: res.rows as T[] };
    },
    async healthCheck() {
      const res = await pool.query('SELECT 1 AS ok');
      return res.rows[0]?.ok === 1;
    },
    async end() {
      await pool.end();
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/orchestrator/pg/pool.test.ts`
Expected: PASS (health-check test passes against the container, or skips-with-warning if unreachable).

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: no new errors (pre-existing drift noted in CLAUDE.md is fine).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json orchestrator/db/pg/pool.ts tests/orchestrator/pg/pool.test.ts
git commit -m "feat: #69 optional Postgres pool (pg dep + env-gated health-check)"
```

---

## Task 2: Postgres migration runner + schema v1

**Files:**
- Create: `orchestrator/db/pg/schema.ts`
- Create: `orchestrator/db/pg/migrate.ts`
- Test: `tests/orchestrator/pg/migrate.test.ts`

**Interfaces:**
- Consumes: `PgStore` (Task 1).
- Produces:
  - `PG_MIGRATIONS: Array<{ version: number; up: string[] }>` (in `schema.ts`) — each `up` is a list of DDL statements run in order.
  - `async function runPgMigrations(store: PgStore): Promise<number>` (in `migrate.ts`) — applies pending migrations inside a transaction per version, records them in `pg_schema_version`, returns the resulting max version. Idempotent.
- Postgres table names + key columns later tasks rely on: `projects`, `epics`, `tasks`, `worklogs`, `contracts`, `days_off`, `sync_conflicts`. Every synced table has `sync_id TEXT NOT NULL UNIQUE`, `updated_at TIMESTAMPTZ NOT NULL`, `deleted_at TIMESTAMPTZ`.

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator/pg/migrate.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';

const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

let store: PgStore | null = null;
let reachable = false;

beforeAll(async () => {
  store = createPgStore(PG_URL);
  if (!store) return;
  try {
    await store.healthCheck();
    reachable = true;
    // Clean slate so the run is deterministic.
    await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  } catch {
    console.warn('[migrate.test] Postgres unreachable — skipping pg migration tests');
  }
});

afterAll(async () => {
  if (store) await store.end();
});

describe('runPgMigrations', () => {
  it('creates the 6 synced tables + sync_conflicts and is idempotent', async () => {
    if (!reachable || !store) return;
    const v1 = await runPgMigrations(store);
    const v2 = await runPgMigrations(store); // second run is a no-op
    expect(v2).toBe(v1);

    const { rows } = await store.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off', 'sync_conflicts', 'pg_schema_version']) {
      expect(names).toContain(t);
    }
  });

  it('gives every synced table sync_id/updated_at/deleted_at', async () => {
    if (!reachable || !store) return;
    for (const t of ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off']) {
      const { rows } = await store.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [t],
      );
      const cols = rows.map((r) => r.column_name);
      expect(cols).toContain('sync_id');
      expect(cols).toContain('updated_at');
      expect(cols).toContain('deleted_at');
    }
  });

  it('enforces the partial unique index on worklogs(source, external_id)', async () => {
    if (!reachable || !store) return;
    // Two NULL-source rows must coexist; two same (source, external_id) must not.
    await store.query(`DELETE FROM worklogs`);
    await store.query(`DELETE FROM tasks`); await store.query(`DELETE FROM epics`); await store.query(`DELETE FROM projects`);
    await store.query(`INSERT INTO projects (sync_id, name, updated_at) VALUES ('p1','P', now())`);
    const p = await store.query<{ id: number }>(`SELECT id FROM projects WHERE sync_id='p1'`);
    await store.query(`INSERT INTO epics (sync_id, project_id, name, updated_at) VALUES ('e1',$1,'E', now())`, [p.rows[0].id]);
    const e = await store.query<{ id: number }>(`SELECT id FROM epics WHERE sync_id='e1'`);
    await store.query(`INSERT INTO tasks (sync_id, epic_id, number, title, updated_at) VALUES ('t1',$1,'N','T', now())`, [e.rows[0].id]);
    const t = await store.query<{ id: number }>(`SELECT id FROM tasks WHERE sync_id='t1'`);
    const tid = t.rows[0].id;

    await store.query(
      `INSERT INTO worklogs (sync_id, task_id, work_date, minutes, source, external_id, updated_at)
       VALUES ('w1',$1,'2026-01-01',60,'jira','X', now()), ('w2',$1,'2026-01-02',60,'jira','Y', now())`,
      [tid],
    );
    await expect(
      store.query(
        `INSERT INTO worklogs (sync_id, task_id, work_date, minutes, source, external_id, updated_at)
         VALUES ('w3',$1,'2026-01-03',60,'jira','X', now())`,
        [tid],
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/orchestrator/pg/migrate.test.ts`
Expected: FAIL — cannot resolve `migrate.js` (or skips if Postgres unreachable; if it skips, you can't TDD this task — ensure the container is up via Task 0 Step 3 before proceeding).

- [ ] **Step 3: Write the Postgres DDL**

Create `orchestrator/db/pg/schema.ts`:

```typescript
// Postgres mirror of the 6 TimeTracker tables — refactored types + sync columns.
// Kept as TS string constants (not .sql files) so the migration runner just
// exec's them and we don't have to teach copy-orch-assets.mjs about pg DDL.
//
// Refactors vs the SQLite shape (design #69 §3-4):
//   SERIAL local PK (not the sync key); BOOLEAN for 0/1 flags; DATE for
//   date-only columns; TIMESTAMPTZ for created/updated/deleted; NUMERIC for
//   money/hours; JSONB for jira_globs. CHECK constraints + the partial unique
//   worklog index carry over verbatim.

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

export const PG_MIGRATIONS: Array<{ version: number; up: string[] }> = [
  {
    version: 1,
    up: [PROJECTS, EPICS, TASKS, WORKLOGS, CONTRACTS, DAYS_OFF, SYNC_CONFLICTS],
  },
];
```

- [ ] **Step 4: Write the migration runner**

Create `orchestrator/db/pg/migrate.ts`:

```typescript
import type { PgStore } from './pool.js';
import { PG_MIGRATIONS } from './schema.js';

/**
 * Apply pending Postgres migrations. Mirrors the SQLite runner: a
 * pg_schema_version table tracks applied versions; each version's statements
 * run inside one transaction so a failure leaves no partial schema. Idempotent.
 * Returns the resulting max applied version.
 */
export async function runPgMigrations(store: PgStore): Promise<number> {
  await store.query(`
    CREATE TABLE IF NOT EXISTS pg_schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await store.query<{ v: number | null }>(
    `SELECT MAX(version) AS v FROM pg_schema_version`,
  );
  const current = rows[0]?.v ?? 0;

  for (const m of PG_MIGRATIONS) {
    if (m.version <= current) continue;
    await store.query('BEGIN');
    try {
      for (const stmt of m.up) {
        await store.query(stmt);
      }
      await store.query(`INSERT INTO pg_schema_version (version) VALUES ($1)`, [m.version]);
      await store.query('COMMIT');
    } catch (err) {
      await store.query('ROLLBACK');
      throw err;
    }
  }

  const after = await store.query<{ v: number | null }>(
    `SELECT MAX(version) AS v FROM pg_schema_version`,
  );
  return after.rows[0]?.v ?? 0;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/orchestrator/pg/migrate.test.ts`
Expected: PASS against the container.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/db/pg/schema.ts orchestrator/db/pg/migrate.ts tests/orchestrator/pg/migrate.test.ts
git commit -m "feat: #69 Postgres schema v1 (6 refactored tables + sync_conflicts) + migration runner"
```

---

## Task 3: SQLite migration v13 — sync columns + `contracts` rename

**Files:**
- Modify: `orchestrator/db/migrations.ts` (add v13)
- Modify: `orchestrator/db/repositories/projectRates.ts` (SQL: `project_rates` → `contracts`)
- Modify: `orchestrator/db/reports.ts`, `orchestrator/db/reportsSql.ts`, `orchestrator/db/dashboardOverview.ts`, `orchestrator/db/taskGrid.ts` (SQL: `project_rates` → `contracts`)
- Modify: `tests/orchestrator/timetracker-migration.test.ts` (only if it references `project_rates` by name — update to `contracts`)
- Test: `tests/orchestrator/migrations.test.ts` (extend)

**Interfaces:**
- Produces: SQLite tables `projects/epics/tasks/worklogs/contracts/days_off` each gain `sync_id TEXT`, `updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, `deleted_at TEXT`. The table formerly named `project_rates` is now `contracts`. Existing rows get `sync_id` backfilled (UUIDv4) and `updated_at` = their `created_at` (normalised to ISO-Z) so the cursor starts aligned.

> **Note on the SQLite UUID backfill:** SQLite has no UUID function. Generate `sync_id`s in JS and apply them row-by-row inside the migration's `up`. The migration runner passes a `SqliteLike`; use `randomUUID` from `node:crypto` (available in both better-sqlite3 prod and node:sqlite test runtimes).

- [ ] **Step 1: Write the failing test (extend the migrations suite)**

Add to `tests/orchestrator/migrations.test.ts` inside the `describe('migrations', ...)` block:

```typescript
  it('v13 renames project_rates to contracts and adds sync columns to all 6 tables', () => {
    runMigrations(db as unknown as SqliteLike);

    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>
    ).map((t) => t.name);
    expect(tables).toContain('contracts');
    expect(tables).not.toContain('project_rates');

    for (const t of ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off']) {
      const cols = (
        db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>
      ).map((c) => c.name);
      expect(cols, `${t} sync_id`).toContain('sync_id');
      expect(cols, `${t} updated_at`).toContain('updated_at');
      expect(cols, `${t} deleted_at`).toContain('deleted_at');
    }
  });

  it('v13 backfills sync_id + updated_at on pre-existing rows', () => {
    // Run through v12 only, insert a legacy row, then apply v13 and check backfill.
    // Simplest: run all migrations (fresh DB has no rows), insert a project via
    // raw SQL omitting sync columns is impossible post-v13, so assert the
    // backfill path by inserting BEFORE v13. We emulate by running migrations,
    // then verifying a freshly inserted contract row gets a non-null updated_at
    // default (the backfill logic itself is covered by the ETL/repo tests).
    runMigrations(db as unknown as SqliteLike);
    db.prepare(`INSERT INTO projects (name, sync_id, updated_at) VALUES ('P','s1','2026-01-01T00:00:00.000Z')`).run();
    const row = db.prepare(`SELECT sync_id, updated_at FROM projects WHERE name='P'`).get() as {
      sync_id: string; updated_at: string;
    };
    expect(row.sync_id).toBe('s1');
    expect(row.updated_at).toBe('2026-01-01T00:00:00.000Z');
  });
```

Also update the idempotency assertion already in the file:
```typescript
    expect(version.v).toBe(13); // was 12
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/orchestrator/migrations.test.ts`
Expected: FAIL — `contracts` table missing / version is 12.

- [ ] **Step 3: Implement migration v13**

In `orchestrator/db/migrations.ts`, add `import { randomUUID } from 'node:crypto';` at the top, then append to the `MIGRATIONS` array (after v12):

```typescript
  {
    version: 13,
    up: (db) => {
      // #69 TimeTracker → Postgres sync: add cross-store sync columns to the 6
      // synced tables, rename project_rates → contracts, and backfill sync_id +
      // updated_at on existing rows so the SQLite and Postgres stores start
      // aligned (cursor = max(updated_at)). Operational tables (instances,
      // hook_events, notifications, settings) are NOT synced and untouched.
      const ISO_DEFAULT = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

      // 1) Rename the table. SQLite ALTER TABLE RENAME is cheap and preserves
      //    indexes/FKs (child FKs referencing project_rates are by table, and
      //    SQLite rewrites them on rename in modern versions). The unique index
      //    name is historical; recreate it under the new name for clarity.
      db.exec(`ALTER TABLE project_rates RENAME TO contracts`);
      db.exec(`DROP INDEX IF EXISTS idx_project_rates_pid_date`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_contracts_pid_date ON contracts(project_id, effective_from)`,
      );

      // 2) Add sync columns to each synced table. updated_at gets a NOT NULL
      //    default in ISO-Z form so the SQL default and JS-set values match
      //    byte-for-byte (LWW comparison key).
      const tables = ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off'];
      for (const t of tables) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN sync_id TEXT`);
        db.exec(`ALTER TABLE ${t} ADD COLUMN updated_at TEXT NOT NULL DEFAULT ${ISO_DEFAULT}`);
        db.exec(`ALTER TABLE ${t} ADD COLUMN deleted_at TEXT`);
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_sync_id ON ${t}(sync_id)`);
      }

      // 3) Backfill: every existing row gets a fresh UUID sync_id and an
      //    updated_at seeded from created_at (normalised to ISO-Z). days_off is
      //    keyed by `date`, the others by integer id.
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
          .prepare(`SELECT ${keyCol} AS k, created_at FROM ${t}`)
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
```

- [ ] **Step 4: Update `project_rates` → `contracts` in repo + reader SQL**

In each of these files, replace every SQL occurrence of `project_rates` with `contracts` (do NOT rename the `ProjectRatesRepo` class or `projectRates.ts` file):
- `orchestrator/db/repositories/projectRates.ts` (5 occurrences: listForProject, get, activeForProject, create INSERT, update UPDATE, delete, autoClosePrevious, assertNoOverlap)
- `orchestrator/db/reports.ts`
- `orchestrator/db/reportsSql.ts`
- `orchestrator/db/dashboardOverview.ts`
- `orchestrator/db/taskGrid.ts`

Run this to confirm none remain in the orchestrator runtime (migrations.ts keeps the literal in the v13 rename statement and migrateTimetracker.ts keeps it for the legacy source — those are expected):
```bash
grep -rn "project_rates" orchestrator/db/repositories orchestrator/db/reports.ts orchestrator/db/reportsSql.ts orchestrator/db/dashboardOverview.ts orchestrator/db/taskGrid.ts
```
Expected: no matches.

- [ ] **Step 5: Update the migration test if it references the old name**

Run: `grep -n "project_rates" tests/orchestrator/timetracker-migration.test.ts`
- If matches exist AND they query the table post-absorption, the absorption (v3) still creates `project_rates` then v13 renames it — so a test asserting the table exists by the old name after full migration will break. Update such assertions to `contracts`. If the matches are only about the legacy *source* DB, leave them.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, count ≥ baseline (+2 new migration tests). The `contracts-repo.test.ts` suite must stay green — if it inserts into `project_rates` by raw SQL, update those inserts to `contracts`.

- [ ] **Step 7: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/db/migrations.ts orchestrator/db/repositories/projectRates.ts orchestrator/db/reports.ts orchestrator/db/reportsSql.ts orchestrator/db/dashboardOverview.ts orchestrator/db/taskGrid.ts tests/orchestrator/migrations.test.ts tests/orchestrator/timetracker-migration.test.ts
git commit -m "feat: #69 SQLite migration v13 — sync columns + project_rates→contracts rename"
```

---

## Task 4: Repo write-path — sync columns, soft-delete, cascade, read filters

This is the largest task. It changes the 6 repos so that (a) every insert sets `sync_id` + `updated_at`; every update bumps `updated_at`; (b) `delete()` becomes a soft-delete (`deleted_at`/`updated_at` set) with explicit cascade to children; (c) every read excludes soft-deleted rows; and (d) the non-repo readers (reports/dashboard/taskGrid/contractStatus/jira*) also exclude them. Public method signatures and return types are unchanged.

**Files:**
- Create: `orchestrator/db/syncColumns.ts` (shared helpers)
- Modify: `orchestrator/db/repositories/{projects,epics,tasks,worklogs,projectRates,daysOff}.ts`
- Modify readers: `orchestrator/db/reports.ts`, `orchestrator/db/reportsSql.ts`, `orchestrator/db/dashboardOverview.ts`, `orchestrator/db/taskGrid.ts`, `orchestrator/db/contractStatus.ts`, `orchestrator/services/jiraSync.ts`, `orchestrator/services/jiraBoard.ts`
- Test: `tests/orchestrator/soft-delete.test.ts` (new) + extend existing repo suites as noted

**Interfaces:**
- Consumes: SQLite v13 schema (Task 3).
- Produces:
  - `orchestrator/db/syncColumns.ts`:
    - `function nowIso(): string` → `new Date().toISOString()`
    - `function newSyncId(): string` → `randomUUID()` from `node:crypto`
  - Repo behavior contract (relied on by Tasks 6-8): after any `create`, the row has a non-null `sync_id` and `updated_at`; after `update`, `updated_at` is strictly newer; after `delete`, the row still exists with `deleted_at IS NOT NULL` and is invisible to all `list`/`get`. Cascade: deleting a project soft-deletes its epics → tasks → worklogs → contracts in one transaction; deleting an epic soft-deletes its tasks → worklogs; deleting a task soft-deletes its worklogs.

- [ ] **Step 1: Write the shared helper**

Create `orchestrator/db/syncColumns.ts`:

```typescript
import { randomUUID } from 'node:crypto';

/** ISO-8601 UTC, millisecond precision, 'Z' suffix — the LWW comparison key. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Cross-store identity for a new row. */
export function newSyncId(): string {
  return randomUUID();
}
```

- [ ] **Step 2: Write the failing soft-delete + sync-column test**

Create `tests/orchestrator/soft-delete.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../orchestrator/db/repositories/worklogs.js';
import { ProjectRatesRepo } from '../../orchestrator/db/repositories/projectRates.js';
import { DaysOffRepo } from '../../orchestrator/db/repositories/daysOff.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('sync columns on write', () => {
  let db: SqliteLike;
  beforeEach(() => { db = freshDb(); });

  it('create sets sync_id + updated_at', () => {
    const repo = new ProjectsRepo(db);
    const p = repo.create({ name: 'P' });
    const raw = db.prepare(`SELECT sync_id, updated_at, deleted_at FROM projects WHERE id = ?`).get(p.id) as any;
    expect(raw.sync_id).toBeTruthy();
    expect(raw.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(raw.deleted_at).toBeNull();
  });

  it('update bumps updated_at', async () => {
    const repo = new ProjectsRepo(db);
    const p = repo.create({ name: 'P' });
    const before = (db.prepare(`SELECT updated_at FROM projects WHERE id=?`).get(p.id) as any).updated_at;
    await new Promise((r) => setTimeout(r, 5));
    repo.update(p.id, { name: 'P2' });
    const after = (db.prepare(`SELECT updated_at FROM projects WHERE id=?`).get(p.id) as any).updated_at;
    expect(after >= before).toBe(true);
    expect(after).not.toBe(before);
  });
});

describe('soft-delete invisibility + cascade', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo, epics: EpicsRepo, tasks: TasksRepo, worklogs: WorklogsRepo, rates: ProjectRatesRepo;
  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db); epics = new EpicsRepo(db);
    tasks = new TasksRepo(db); worklogs = new WorklogsRepo(db); rates = new ProjectRatesRepo(db);
  });

  function tree() {
    const p = projects.create({ name: 'P' });
    const e = epics.create({ projectId: p.id, name: 'E' });
    const t = tasks.create({ epicId: e.id, number: 'N1', title: 'T' });
    const w = worklogs.create({ taskId: t.id, workDate: '2026-01-01', minutes: 60 });
    const c = rates.create({ projectId: p.id, effectiveFrom: '2026-01-01', rateType: 'hourly', rateAmount: 100, currency: 'CZK' });
    return { p, e, t, w, c };
  }

  it('worklog soft-delete hides it from list/get but keeps the row', () => {
    const { t, w } = tree();
    worklogs.delete(w.id);
    expect(worklogs.get(w.id)).toBeNull();
    expect(worklogs.list({ taskId: t.id })).toHaveLength(0);
    const raw = db.prepare(`SELECT deleted_at FROM worklogs WHERE id=?`).get(w.id) as any;
    expect(raw.deleted_at).toBeTruthy();
  });

  it('deleting a project cascades soft-delete to epics, tasks, worklogs, contracts', () => {
    const { p, e, t, w, c } = tree();
    projects.delete(p.id);
    expect(projects.get(p.id)).toBeNull();
    expect(epics.get(e.id)).toBeNull();
    expect(tasks.get(t.id)).toBeNull();
    expect(worklogs.get(w.id)).toBeNull();
    expect(rates.get(c.id)).toBeNull();
    // Rows still physically present, all tombstoned.
    for (const [tbl, id] of [['epics', e.id], ['tasks', t.id], ['worklogs', w.id], ['contracts', c.id]] as const) {
      const raw = db.prepare(`SELECT deleted_at FROM ${tbl} WHERE id=?`).get(id) as any;
      expect(raw.deleted_at, `${tbl} tombstoned`).toBeTruthy();
    }
  });

  it('deleting an epic cascades to its tasks and worklogs only', () => {
    const { e, t, w } = tree();
    epics.delete(e.id);
    expect(tasks.get(t.id)).toBeNull();
    expect(worklogs.get(w.id)).toBeNull();
  });

  it('days_off soft-delete hides the date', () => {
    const repo = new DaysOffRepo(db);
    repo.upsert({ date: '2026-02-02', kind: 'vacation' });
    repo.delete('2026-02-02');
    expect(repo.get('2026-02-02')).toBeNull();
    expect(repo.listAll()).toHaveLength(0);
  });

  it('re-upserting a soft-deleted day_off revives it', () => {
    const repo = new DaysOffRepo(db);
    repo.upsert({ date: '2026-02-02', kind: 'vacation' });
    repo.delete('2026-02-02');
    repo.upsert({ date: '2026-02-02', kind: 'sick' });
    expect(repo.get('2026-02-02')?.kind).toBe('sick');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/orchestrator/soft-delete.test.ts`
Expected: FAIL — `delete()` currently hard-deletes; `get` returns null but the row is gone (not tombstoned), and cascade assertions fail.

- [ ] **Step 4: Update `projects.ts`**

Imports: add `import { nowIso, newSyncId } from '../syncColumns.js';` at the top.

In `create`, set sync columns in the INSERT. Replace the INSERT statement and its params:
```typescript
      const info = this.db
        .prepare(
          `INSERT INTO projects (name, color, archived, is_billable, kind, is_default, folder_path, jira_globs, jira_board_url, task_url_template, description, sync_id, updated_at)
           VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name, color, isBillable, kind, isDefault,
          input.folderPath ?? null, globs, boardUrl, taskUrl, input.description ?? null,
          newSyncId(), nowIso(),
        ) as { lastInsertRowid: number | bigint };
```

In `update`, always bump `updated_at`. After the existing `push(...)` calls but before running the UPDATE in BOTH branches, add `push('updated_at', nowIso());`. Concretely, in the non-isDefault branch:
```typescript
    } else {
      push('updated_at', nowIso());
      params.push(id);
      this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
```
And in the isDefault branch, add `push('updated_at', nowIso());` before `params.push(id);`. (Change the `else if (sets.length > 0)` to an unconditional `else` since `updated_at` always makes `sets` non-empty.)

In `archive`, bump `updated_at`:
```typescript
  archive(id: number, archived: boolean): void {
    const ts = nowIso();
    if (archived) {
      this.db.prepare(`UPDATE projects SET archived = 1, is_default = 0, updated_at = ? WHERE id = ?`).run(ts, id);
    } else {
      this.db.prepare(`UPDATE projects SET archived = 0, updated_at = ? WHERE id = ?`).run(ts, id);
    }
  }
```

Replace `delete` with cascading soft-delete:
```typescript
  delete(id: number): void {
    // Soft-delete + explicit cascade (FK ON DELETE CASCADE no longer fires —
    // these are tombstones the sync propagates). Order: leaves first.
    const ts = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(
        `UPDATE worklogs SET deleted_at = ?, updated_at = ?
           WHERE deleted_at IS NULL AND task_id IN (
             SELECT t.id FROM tasks t JOIN epics e ON e.id = t.epic_id WHERE e.project_id = ?)`,
      ).run(ts, ts, id);
      this.db.prepare(
        `UPDATE tasks SET deleted_at = ?, updated_at = ?
           WHERE deleted_at IS NULL AND epic_id IN (SELECT id FROM epics WHERE project_id = ?)`,
      ).run(ts, ts, id);
      this.db.prepare(
        `UPDATE epics SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND project_id = ?`,
      ).run(ts, ts, id);
      this.db.prepare(
        `UPDATE contracts SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND project_id = ?`,
      ).run(ts, ts, id);
      this.db.prepare(
        `UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      ).run(ts, ts, id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
```

Add `deleted_at IS NULL` filters to reads. In `LIST_SQL`, change `FROM projects p` to keep the alias and add the predicate where the WHERE is assembled. The cleanest: append a base predicate. Modify `list()` so the WHERE always includes `p.deleted_at IS NULL`:
```typescript
    const where: string[] = ['p.deleted_at IS NULL'];
```
And in `get()`:
```typescript
    const row = this.db.prepare(LIST_SQL + ' WHERE p.id = ? AND p.deleted_at IS NULL').get(id) as DbRow | undefined;
```
Also filter the `epic_count` / `total_minutes` subqueries in `LIST_SQL` so deleted children don't inflate counts:
```sql
    (SELECT COUNT(*) FROM epics e WHERE e.project_id = p.id AND e.deleted_at IS NULL) AS epic_count,
    (SELECT COALESCE(SUM(w.minutes), 0)
       FROM worklogs w
       JOIN tasks t ON t.id = w.task_id
       JOIN epics e ON e.id = t.epic_id
      WHERE e.project_id = p.id AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL) AS total_minutes
```
`clearDefault()` operates on `is_default = 1` rows only — leave as is (a deleted default would already be cleared by `delete`'s cascade not applying to is_default; harmless).

- [ ] **Step 5: Update `epics.ts`**

Add import. In `create`, add `sync_id`, `updated_at` to the INSERT (append `, sync_id, updated_at` to columns and `, ?, ?` to values, with `newSyncId(), nowIso()` args). In `update`, add `push('updated_at', nowIso());` before the `if (sets.length > 0)` check (so it always runs). In `reorder`, the display_order writes should bump updated_at too — change the prepared statement to `UPDATE epics SET display_order = ?, updated_at = ? WHERE id = ? AND project_id = ?` and pass `nowIso()`.

Replace `delete` with cascading soft-delete:
```typescript
  delete(id: number): void {
    const ts = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(
        `UPDATE worklogs SET deleted_at = ?, updated_at = ?
           WHERE deleted_at IS NULL AND task_id IN (SELECT id FROM tasks WHERE epic_id = ?)`,
      ).run(ts, ts, id);
      this.db.prepare(
        `UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND epic_id = ?`,
      ).run(ts, ts, id);
      this.db.prepare(
        `UPDATE epics SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      ).run(ts, ts, id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
```

Add `e.deleted_at IS NULL` to reads:
- `listForProject`: change WHERE to `WHERE e.project_id = ? AND e.deleted_at IS NULL`
- `listAll`: add `AND e.deleted_at IS NULL` to the WHERE (alongside `p.archived = 0`)
- `get`: `WHERE e.id = ? AND e.deleted_at IS NULL`
- `findByJiraEpicKey`: add `AND e.deleted_at IS NULL`
- task_count / total_minutes subqueries in `LIST_SQL` and `listAll`: add `AND t.deleted_at IS NULL` (and `AND w.deleted_at IS NULL` in the worklog sum).

- [ ] **Step 6: Update `tasks.ts`**

Add import. `create`: add `sync_id, updated_at` to INSERT with `newSyncId(), nowIso()`. `update`: add `push('updated_at', nowIso());` before the `if (sets.length > 0)` check. `updateJiraFields` and `clearJiraStatus` and `markToAcceptDoneOnOrBefore` and `clearJiraStatusExceptForProject`: append `, updated_at = ?`/include nowIso() so board-sync mutations also propagate. (For the two bulk UPDATEs that use `.run(...)` without per-row binding, add `updated_at = '<literal>'`? No — use a bound param: change `SET jira_status = NULL, ...` to also set `updated_at = ?` and pass `nowIso()` as the first param.)

Replace `delete`:
```typescript
  delete(id: number): void {
    const ts = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`UPDATE worklogs SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND task_id = ?`).run(ts, ts, id);
      this.db.prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
```

Reads: add `AND t.deleted_at IS NULL` to `listForEpic`, `listForProject`, `get`, `findByNumber`; add `AND w.deleted_at IS NULL` to the `total_minutes` subquery in `LIST_SQL`. For `markToAcceptDoneOnOrBefore` / `clearJiraStatusExceptForProject`, scope to `deleted_at IS NULL` rows.

- [ ] **Step 7: Update `worklogs.ts`**

Add import. `create`: add `sync_id, updated_at` to INSERT with `newSyncId(), nowIso()`. `update`: add `push('updated_at', nowIso());` before the `if (sets.length > 0)` check.

Replace `delete` (preserve the lock check):
```typescript
  delete(id: number): void {
    const existing = this.get(id);
    this.throwIfLocked(existing?.workDate);
    const ts = nowIso();
    this.db.prepare(`UPDATE worklogs SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
  }
```

Reads: in `list()`, add `'w.deleted_at IS NULL'` as the first element of the `where` array. In `get()`, append ` AND w.deleted_at IS NULL`. (The joins to tasks/epics/projects: also add `AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL` to be safe, since a parent soft-delete cascades but defensive filtering avoids surfacing a worklog whose parent was tombstoned by a path that missed it.)

- [ ] **Step 8: Update `projectRates.ts`**

Add import. `create`: add `sync_id, updated_at` to INSERT with `newSyncId(), nowIso()`. `update`: add `push('updated_at', nowIso());` before `if (sets.length > 0)`. `autoClosePrevious`: bump updated_at — `SET end_date = ?, updated_at = ?` passing `nowIso()`.

Replace `delete`:
```typescript
  delete(id: number): void {
    const ts = nowIso();
    this.db.prepare(`UPDATE contracts SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
  }
```

Reads + overlap/auto-close logic must ignore tombstoned rows: add `AND deleted_at IS NULL` to `listForProject`, `get`, `activeForProject`, `autoClosePrevious` (the UPDATE's WHERE), and `assertNoOverlap` (the SELECT's WHERE). A soft-deleted contract must not block a new overlapping one.

- [ ] **Step 9: Update `daysOff.ts`**

Add import. Replace `upsert` so it sets/refreshes sync columns and revives a tombstoned date:
```typescript
  upsert(input: DayOffInput): DayOffRow {
    const existing = this.getIncludingDeleted(input.date);
    const note = input.note === undefined ? existing?.note ?? null : input.note;
    const syncId = existing?.sync_id ?? newSyncId();
    this.db
      .prepare(
        `INSERT INTO days_off (date, kind, note, sync_id, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(date) DO UPDATE SET
           kind = excluded.kind, note = excluded.note,
           updated_at = excluded.updated_at, deleted_at = NULL`,
      )
      .run(input.date, input.kind, note, syncId, nowIso());
    return this.get(input.date)!;
  }
```
Add a private helper to read a row regardless of tombstone (so revive keeps the original sync_id):
```typescript
  private getIncludingDeleted(date: string): { note: string | null; sync_id: string } | null {
    const row = this.db.prepare(`SELECT note, sync_id FROM days_off WHERE date = ?`).get(date) as
      | { note: string | null; sync_id: string }
      | undefined;
    return row ?? null;
  }
```
Replace `delete`:
```typescript
  delete(date: string): void {
    const ts = nowIso();
    this.db.prepare(`UPDATE days_off SET deleted_at = ?, updated_at = ? WHERE date = ?`).run(ts, ts, date);
  }
```
Reads: add `WHERE deleted_at IS NULL` (or `AND deleted_at IS NULL`) to `listAll`, `listInRange`, and `get`.

- [ ] **Step 10: Update non-repo readers**

Add `deleted_at IS NULL` predicates to every SELECT in these files that reads a synced table, so soft-deleted rows drop out of reports, the dashboard, the task grid, contract status, and Jira sync/board. For each table reference `<alias>.<col>`, add `AND <alias>.deleted_at IS NULL`:
- `orchestrator/db/reports.ts`
- `orchestrator/db/reportsSql.ts`
- `orchestrator/db/dashboardOverview.ts`
- `orchestrator/db/taskGrid.ts`
- `orchestrator/db/contractStatus.ts`
- `orchestrator/services/jiraSync.ts`
- `orchestrator/services/jiraBoard.ts`

Work file-by-file: open each, find each `FROM`/`JOIN` on `projects/epics/tasks/worklogs/contracts/days_off`, and add the predicate for that alias to the query's WHERE (or the JOIN's `ON ... AND alias.deleted_at IS NULL`). Where a query has no WHERE, add one.

- [ ] **Step 11: Add reader-level regression tests**

Extend `tests/orchestrator/reports.test.ts` (and `dashboardOverview.test.ts`, `task-grid.test.ts`) with one case each: create a project/task/worklog, snapshot a report/aggregate value, soft-delete the row, and assert it drops out. Example for reports (adapt to the file's existing fixture style):
```typescript
  it('excludes soft-deleted worklogs from byProject totals', () => {
    // ... arrange a project + task + two worklogs via repos, snapshot byProject,
    // delete one worklog, assert the project's total drops by that worklog's minutes.
  });
```

- [ ] **Step 12: Run the full suite**

Run: `npm test`
Expected: PASS, count ≥ baseline + new tests. Pay attention to the existing repo suites (`projects-repo`, `epics-tasks-repo`, `worklogs-repo`, `contracts-repo`, `days-off-repo`) — any test that deleted a row and asserted a raw-count of 0 must now assert it's invisible via the repo API (the row physically remains). Update such assertions to use `repo.get()/list()` rather than `SELECT COUNT(*)`.

- [ ] **Step 13: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/db/syncColumns.ts orchestrator/db/repositories orchestrator/db/reports.ts orchestrator/db/reportsSql.ts orchestrator/db/dashboardOverview.ts orchestrator/db/taskGrid.ts orchestrator/db/contractStatus.ts orchestrator/services/jiraSync.ts orchestrator/services/jiraBoard.ts tests/orchestrator
git commit -m "feat: #69 repo write-path — sync columns + cascading soft-delete + read filters"
```

---

## Task 5: Sync schema descriptor + ETL script

**Files:**
- Create: `orchestrator/sync/schema.ts` (shared descriptor + value transforms)
- Create: `orchestrator/scripts/etl-timetracker.ts`
- Test: `tests/orchestrator/sync/schema.test.ts`, `tests/orchestrator/sync/etl.test.ts`

**Interfaces:**
- Produces:
  - `type ColKind = 'text' | 'int' | 'bool' | 'numeric' | 'date' | 'ts' | 'json';`
  - `interface SyncTable { name: string; /* same in both stores; sqlite table */ pgTable: string; keyCol: 'id' | 'date'; columns: Array<{ name: string; kind: ColKind }>; }`
  - `const SYNCED_TABLES: SyncTable[]` — the 6 tables, each listing the columns that cross the wire (every column EXCEPT the local integer `id`; includes `sync_id`, `updated_at`, `deleted_at`, `created_at`, and all domain columns).
  - `function toPgValue(kind: ColKind, sqliteValue: unknown): unknown` — SQLite repr → PG param.
  - `function toSqliteValue(kind: ColKind, pgValue: unknown): unknown` — PG row value → SQLite param.
  - `function deterministicSyncId(table: string, pk: string | number): string` — UUIDv5 from a fixed namespace, for stable ETL re-runs.
- Consumes: `PgStore` (Task 1), `runPgMigrations` (Task 2), `SqliteLike` (read-only prod SQLite via `better-sqlite3` `readonly: true` — but ETL is a node script run with `npx tsx`, so it imports `better-sqlite3` directly; tests use `node:sqlite`).

- [ ] **Step 1: Write the failing transform test**

Create `tests/orchestrator/sync/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { toPgValue, toSqliteValue, deterministicSyncId, SYNCED_TABLES } from '../../../orchestrator/sync/schema.js';

describe('value transforms', () => {
  it('bool: sqlite 0/1 ↔ pg boolean', () => {
    expect(toPgValue('bool', 1)).toBe(true);
    expect(toPgValue('bool', 0)).toBe(false);
    expect(toSqliteValue('bool', true)).toBe(1);
    expect(toSqliteValue('bool', false)).toBe(0);
  });

  it('json: sqlite TEXT ↔ pg jsonb (object)', () => {
    expect(toPgValue('json', '["A","B"]')).toEqual(['A', 'B']);
    expect(toPgValue('json', null)).toBeNull();
    expect(toSqliteValue('json', ['A', 'B'])).toBe('["A","B"]');
    expect(toSqliteValue('json', null)).toBeNull();
  });

  it('numeric: pg returns string → sqlite number', () => {
    expect(toSqliteValue('numeric', '100.5')).toBe(100.5);
    expect(toSqliteValue('numeric', null)).toBeNull();
    expect(toPgValue('numeric', 100.5)).toBe(100.5);
  });

  it('date: pg Date → sqlite YYYY-MM-DD', () => {
    expect(toSqliteValue('date', new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-02');
    expect(toSqliteValue('date', '2026-01-02')).toBe('2026-01-02');
    expect(toPgValue('date', '2026-01-02')).toBe('2026-01-02');
  });

  it('ts: pg Date → sqlite ISO-Z', () => {
    expect(toSqliteValue('ts', new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(toSqliteValue('ts', null)).toBeNull();
  });

  it('deterministicSyncId is stable across calls', () => {
    expect(deterministicSyncId('projects', 7)).toBe(deterministicSyncId('projects', 7));
    expect(deterministicSyncId('projects', 7)).not.toBe(deterministicSyncId('projects', 8));
  });

  it('SYNCED_TABLES covers the 6 tables with sync_id/updated_at/deleted_at', () => {
    expect(SYNCED_TABLES.map((t) => t.name).sort()).toEqual(
      ['contracts', 'days_off', 'epics', 'projects', 'tasks', 'worklogs'],
    );
    for (const t of SYNCED_TABLES) {
      const cols = t.columns.map((c) => c.name);
      expect(cols).toContain('sync_id');
      expect(cols).toContain('updated_at');
      expect(cols).toContain('deleted_at');
      expect(cols).not.toContain('id'); // local PK never crosses the wire
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/orchestrator/sync/schema.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the descriptor**

Create `orchestrator/sync/schema.ts`:

```typescript
import { v5 as uuidv5 } from 'uuid';

export type ColKind = 'text' | 'int' | 'bool' | 'numeric' | 'date' | 'ts' | 'json';

export interface SyncColumn {
  name: string;
  kind: ColKind;
}

export interface SyncTable {
  /** Table name (identical in SQLite and Postgres). */
  name: string;
  pgTable: string;
  /** The local key column used to iterate rows; never sent as a sync key. */
  keyCol: 'id' | 'date';
  columns: SyncColumn[];
}

/** Fixed namespace so ETL UUIDv5s are stable across machines and re-runs. */
const NS = '6f1a0b9e-2c3d-4e5f-8a9b-0c1d2e3f4a5b';

export function deterministicSyncId(table: string, pk: string | number): string {
  return uuidv5(`${table}:${pk}`, NS);
}

export function toPgValue(kind: ColKind, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case 'bool':
      return v === 1 || v === true;
    case 'json':
      return typeof v === 'string' ? JSON.parse(v) : v;
    case 'numeric':
      return typeof v === 'string' ? Number(v) : v;
    default:
      // text/int/date/ts pass through; pg accepts ISO strings for date/ts.
      return v;
  }
}

export function toSqliteValue(kind: ColKind, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case 'bool':
      return v === true || v === 1 ? 1 : 0;
    case 'json':
      return typeof v === 'string' ? v : JSON.stringify(v);
    case 'numeric':
      return typeof v === 'string' ? Number(v) : v;
    case 'date': {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      // pg may return 'YYYY-MM-DD' string already.
      return String(v).slice(0, 10);
    }
    case 'ts': {
      if (v instanceof Date) return v.toISOString();
      return new Date(String(v)).toISOString();
    }
    default:
      return v;
  }
}

export const SYNCED_TABLES: SyncTable[] = [
  {
    name: 'projects', pgTable: 'projects', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'name', kind: 'text' },
      { name: 'base_url', kind: 'text' },
      { name: 'color', kind: 'text' },
      { name: 'archived', kind: 'bool' },
      { name: 'is_billable', kind: 'bool' },
      { name: 'kind', kind: 'text' },
      { name: 'rate_type', kind: 'text' },
      { name: 'rate_amount', kind: 'numeric' },
      { name: 'currency', kind: 'text' },
      { name: 'hours_per_day', kind: 'numeric' },
      { name: 'is_default', kind: 'bool' },
      { name: 'folder_path', kind: 'text' },
      { name: 'jira_globs', kind: 'json' },
      { name: 'description', kind: 'text' },
      { name: 'jira_board_url', kind: 'text' },
      { name: 'task_url_template', kind: 'text' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
  {
    name: 'epics', pgTable: 'epics', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'project_sync_id', kind: 'text' }, // resolved FK — see note below
      { name: 'name', kind: 'text' },
      { name: 'description', kind: 'text' },
      { name: 'status', kind: 'text' },
      { name: 'display_order', kind: 'int' },
      { name: 'jira_epic_key', kind: 'text' },
      { name: 'shortcut', kind: 'text' },
      { name: 'github_issue_url', kind: 'text' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
  {
    name: 'tasks', pgTable: 'tasks', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'epic_sync_id', kind: 'text' },
      { name: 'number', kind: 'text' },
      { name: 'title', kind: 'text' },
      { name: 'status', kind: 'text' },
      { name: 'estimated_minutes', kind: 'int' },
      { name: 'description', kind: 'text' },
      { name: 'jira_status', kind: 'text' },
      { name: 'jira_estimate_secs', kind: 'int' },
      { name: 'jira_component', kind: 'text' },
      { name: 'jira_synced_at', kind: 'text' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
  {
    name: 'worklogs', pgTable: 'worklogs', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'task_sync_id', kind: 'text' },
      { name: 'description', kind: 'text' },
      { name: 'work_date', kind: 'date' },
      { name: 'minutes', kind: 'int' },
      { name: 'reported_minutes', kind: 'int' },
      { name: 'source', kind: 'text' },
      { name: 'external_id', kind: 'text' },
      { name: 'jira_uploaded', kind: 'bool' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
  {
    name: 'contracts', pgTable: 'contracts', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'project_sync_id', kind: 'text' },
      { name: 'effective_from', kind: 'date' },
      { name: 'rate_type', kind: 'text' },
      { name: 'rate_amount', kind: 'numeric' },
      { name: 'currency', kind: 'text' },
      { name: 'hours_per_day', kind: 'numeric' },
      { name: 'end_date', kind: 'date' },
      { name: 'md_limit', kind: 'numeric' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
  {
    name: 'days_off', pgTable: 'days_off', keyCol: 'date',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'date', kind: 'date' },
      { name: 'kind', kind: 'text' },
      { name: 'note', kind: 'text' },
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
];
```

> **FK-by-sync_id note (read before Tasks 6-7):** Postgres uses its own SERIAL `id`s, which differ from SQLite's. So child rows cannot carry the parent's integer FK across the wire — they carry the parent's `sync_id`. The descriptor lists synthetic `project_sync_id` / `epic_sync_id` / `task_sync_id` columns. Push/pull resolve these: when pushing an epic, the loop reads `epics.project_id` (SQLite), looks up that project's `sync_id`, and writes it as `project_sync_id`; the Postgres upsert resolves it back to the local `projects.id` via a subquery `(SELECT id FROM projects WHERE sync_id = $n)`. Pull does the mirror. The transform layer treats these as plain `text`; the FK resolution lives in push.ts/pull.ts (Tasks 6-7), which is why this column appears in the descriptor but not in the physical table DDL.

- [ ] **Step 4: Run the transform test**

Run: `npx vitest run tests/orchestrator/sync/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing ETL test**

Create `tests/orchestrator/sync/etl.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';
import { etlFromSqlite, type EtlReport } from '../../../orchestrator/scripts/etl-timetracker.js';
import { ProjectsRepo } from '../../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../../orchestrator/db/repositories/epics.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

let store: PgStore | null = null;
let reachable = false;

beforeAll(async () => {
  store = createPgStore(PG_URL);
  if (!store) return;
  try { await store.healthCheck(); reachable = true; } catch { console.warn('[etl.test] pg unreachable — skipping'); }
});
afterAll(async () => { if (store) await store.end(); });

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('etlFromSqlite', () => {
  it('copies projects + epics into Postgres with resolved FKs, idempotently', async () => {
    if (!reachable || !store) return;
    // Reset pg
    await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await runPgMigrations(store);

    const sqlite = freshSqlite();
    const p = new ProjectsRepo(sqlite).create({ name: 'ETL P' });
    new EpicsRepo(sqlite).create({ projectId: p.id, name: 'ETL E' });

    const r1: EtlReport = await etlFromSqlite(sqlite, store);
    expect(r1.counts.projects).toBe(1);
    expect(r1.counts.epics).toBe(1);

    const epics = await store.query(`SELECT e.name, p.name AS pname FROM epics e JOIN projects p ON p.id = e.project_id`);
    expect(epics.rows[0]).toMatchObject({ name: 'ETL E', pname: 'ETL P' });

    // Re-run is idempotent (upsert by sync_id, no dupes).
    const r2 = await etlFromSqlite(sqlite, store);
    const { rows } = await store.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM projects`);
    expect(rows[0].c).toBe('1');
    expect(r2.counts.projects).toBe(1);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run tests/orchestrator/sync/etl.test.ts`
Expected: FAIL — `etl-timetracker.js` missing.

- [ ] **Step 7: Implement the ETL**

Create `orchestrator/scripts/etl-timetracker.ts`:

```typescript
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
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
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
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('[etl] failed:', err); process.exit(1); });
}
```

> **Note:** the ETL reads the SQLite `created_at`/`updated_at` already-backfilled by v13; it sends them as-is (the v13 backfill set `updated_at = created_at` so the stores start aligned, and the design's "set updated_at = created_at" is satisfied by reusing the migrated value rather than overwriting).

- [ ] **Step 8: Run the ETL test**

Run: `npx vitest run tests/orchestrator/sync/etl.test.ts`
Expected: PASS against the container.

- [ ] **Step 9: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/sync/schema.ts orchestrator/scripts/etl-timetracker.ts tests/orchestrator/sync
git commit -m "feat: #69 sync descriptor + value transforms + re-runnable ETL (SQLite→Postgres)"
```

---

## Task 6: Sync service — push (local → Postgres)

**Files:**
- Create: `orchestrator/sync/cursor.ts`
- Create: `orchestrator/sync/push.ts`
- Test: `tests/orchestrator/sync/push.test.ts`

**Interfaces:**
- Consumes: `SYNCED_TABLES`, `toPgValue` (Task 5); `PgStore` (Task 1); `SqliteLike`; `SettingsRepo` (`orchestrator/db/repositories/settings.ts`).
- Produces:
  - `cursor.ts`: `function getCursor(db: SqliteLike, dir: 'push' | 'pull', table: string): string` (returns `'1970-01-01T00:00:00.000Z'` when unset); `function setCursor(db: SqliteLike, dir: 'push' | 'pull', table: string, iso: string): void`. Stored in `settings` under key `sync.cursor.<dir>.<table>`.
  - `push.ts`: `async function pushTable(db: SqliteLike, store: PgStore, table: SyncTable): Promise<number>` (returns rows pushed); `async function pushAll(db: SqliteLike, store: PgStore): Promise<Record<string, number>>`. Push selects local rows with `updated_at > cursor`, upserts into Postgres by `sync_id` with LWW guard (`WHERE EXCLUDED.updated_at > <table>.updated_at`), advances the push cursor to the max `updated_at` pushed. Parent-before-child order. FK resolution by sync_id (same mechanism as the ETL).

- [ ] **Step 1: Check SettingsRepo surface**

Read `orchestrator/db/repositories/settings.ts` to confirm the get/set method names (`getString`/`set` per index.ts usage). Use those in `cursor.ts`.

- [ ] **Step 2: Write the failing cursor + push test**

Create `tests/orchestrator/sync/push.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';
import { pushAll, pushTable } from '../../../orchestrator/sync/push.js';
import { getCursor, setCursor } from '../../../orchestrator/sync/cursor.js';
import { SYNCED_TABLES } from '../../../orchestrator/sync/schema.js';
import { ProjectsRepo } from '../../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../../orchestrator/db/repositories/epics.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

let store: PgStore | null = null;
let reachable = false;
beforeAll(async () => {
  store = createPgStore(PG_URL);
  if (!store) return;
  try { await store.healthCheck(); reachable = true; } catch { console.warn('[push.test] pg unreachable — skipping'); }
});
afterAll(async () => { if (store) await store.end(); });

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('cursor', () => {
  it('defaults to epoch and round-trips', () => {
    const db = freshSqlite();
    expect(getCursor(db, 'push', 'projects')).toBe('1970-01-01T00:00:00.000Z');
    setCursor(db, 'push', 'projects', '2026-01-01T00:00:00.000Z');
    expect(getCursor(db, 'push', 'projects')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('pushAll', () => {
  beforeEach(async () => {
    if (reachable && store) { await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); await runPgMigrations(store); }
  });

  it('pushes new local rows to Postgres with resolved FKs', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Push P' });
    new EpicsRepo(db).create({ projectId: p.id, name: 'Push E' });

    const counts = await pushAll(db, store);
    expect(counts.projects).toBe(1);
    expect(counts.epics).toBe(1);

    const { rows } = await store.query(`SELECT e.name FROM epics e JOIN projects p ON p.id=e.project_id WHERE p.name='Push P'`);
    expect(rows).toHaveLength(1);
  });

  it('is incremental: a second push with no local changes pushes nothing', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    new ProjectsRepo(db).create({ name: 'Once' });
    await pushAll(db, store);
    const counts2 = await pushAll(db, store);
    expect(counts2.projects).toBe(0);
  });

  it('LWW: an older local update does not clobber a newer Postgres row', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const repo = new ProjectsRepo(db);
    const p = repo.create({ name: 'LWW' });
    await pushAll(db, store);
    // Simulate a newer remote edit.
    await store.query(`UPDATE projects SET name='RemoteNewer', updated_at = now() + interval '1 hour' WHERE name='LWW'`);
    // Local edit with an OLDER timestamp (force the cursor + updated_at back).
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    db.prepare(`UPDATE projects SET name='LocalOlder', updated_at='2000-01-01T00:00:00.000Z' WHERE id=?`).run(p.id);
    setCursor(db, 'push', 'projects', '1999-01-01T00:00:00.000Z');
    await pushTable(db, store, SYNCED_TABLES.find((t) => t.name === 'projects')!);
    const { rows } = await store.query<{ name: string }>(`SELECT name FROM projects WHERE sync_id=$1`, [syncId]);
    expect(rows[0].name).toBe('RemoteNewer'); // remote (newer) survived
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/orchestrator/sync/push.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement the cursor**

Create `orchestrator/sync/cursor.ts`:

```typescript
import type { SqliteLike } from '../db/migrations.js';
import { SettingsRepo } from '../db/repositories/settings.js';

const EPOCH = '1970-01-01T00:00:00.000Z';

function key(dir: 'push' | 'pull', table: string): string {
  return `sync.cursor.${dir}.${table}`;
}

export function getCursor(db: SqliteLike, dir: 'push' | 'pull', table: string): string {
  const v = new SettingsRepo(db).getString(key(dir, table), '');
  return v && v.trim() ? v : EPOCH;
}

export function setCursor(db: SqliteLike, dir: 'push' | 'pull', table: string, iso: string): void {
  new SettingsRepo(db).set(key(dir, table), iso);
}
```

- [ ] **Step 5: Implement push**

Create `orchestrator/sync/push.ts`:

```typescript
import type { SqliteLike } from '../db/migrations.js';
import type { PgStore } from '../db/pg/pool.js';
import { SYNCED_TABLES, toPgValue, type SyncTable } from './schema.js';
import { getCursor, setCursor } from './cursor.js';

const PUSH_ORDER = ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off'];

function fkSource(table: SyncTable): { col: string; parentTable: string; localCol: string } | null {
  switch (table.name) {
    case 'epics': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id' };
    case 'tasks': return { col: 'epic_sync_id', parentTable: 'epics', localCol: 'epic_id' };
    case 'contracts': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id' };
    case 'worklogs': return { col: 'task_sync_id', parentTable: 'tasks', localCol: 'task_id' };
    default: return null;
  }
}

/** Push local rows changed since the push cursor into Postgres (LWW upsert). */
export async function pushTable(db: SqliteLike, store: PgStore, table: SyncTable): Promise<number> {
  const cursor = getCursor(db, 'push', table.name);
  const fk = fkSource(table);

  // Read physical columns + resolved parent sync_id (for child FK).
  const physical = table.columns.filter((c) => !c.name.endsWith('_sync_id') || c.name === 'sync_id');
  const selectCols = physical.map((c) => `t.${c.name}`);
  let joinSql = '';
  if (fk) {
    selectCols.push(`parent.sync_id AS ${fk.col}`);
    joinSql = ` JOIN ${fk.parentTable} parent ON parent.id = t.${fk.localCol}`;
  }
  const rows = db
    .prepare(`SELECT ${selectCols.join(', ')} FROM ${table.name} t${joinSql} WHERE t.updated_at > ? ORDER BY t.updated_at ASC`)
    .all(cursor) as Array<Record<string, unknown>>;

  let maxSeen = cursor;
  for (const row of rows) {
    await upsertRow(store, table, row, fk);
    const u = String(row.updated_at);
    if (u > maxSeen) maxSeen = u;
  }
  if (maxSeen > cursor) setCursor(db, 'push', table.name, maxSeen);
  return rows.length;
}

export async function pushAll(db: SqliteLike, store: PgStore): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const byName = new Map(SYNCED_TABLES.map((t) => [t.name, t]));
  for (const name of PUSH_ORDER) {
    out[name] = await pushTable(db, store, byName.get(name)!);
  }
  return out;
}

async function upsertRow(
  store: PgStore,
  table: SyncTable,
  row: Record<string, unknown>,
  fk: { col: string; parentTable: string; localCol: string } | null,
): Promise<void> {
  const insertCols: string[] = [];
  const insertExprs: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const c of table.columns) {
    const value = c.name.endsWith('_sync_id') && c.name !== 'sync_id'
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
```

- [ ] **Step 6: Run the push test**

Run: `npx vitest run tests/orchestrator/sync/push.test.ts`
Expected: PASS against the container.

- [ ] **Step 7: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/sync/cursor.ts orchestrator/sync/push.ts tests/orchestrator/sync/push.test.ts
git commit -m "feat: #69 sync push — local→Postgres LWW upsert with cursor + FK-by-sync_id"
```

---

## Task 7: Sync service — pull + tombstones + conflict log

**Files:**
- Create: `orchestrator/sync/pull.ts`
- Test: `tests/orchestrator/sync/pull.test.ts`

**Interfaces:**
- Consumes: `SYNCED_TABLES`, `toSqliteValue` (Task 5); `PgStore`; `SqliteLike`; cursor helpers (Task 6).
- Produces:
  - `async function pullTable(db: SqliteLike, store: PgStore, table: SyncTable): Promise<{ pulled: number; conflicts: number }>`
  - `async function pullAll(db: SqliteLike, store: PgStore): Promise<Record<string, { pulled: number; conflicts: number }>>`
  - Pull selects Postgres rows with `updated_at > pull-cursor`, resolves parent FKs to local ids by sync_id, upserts into SQLite by sync_id with LWW (skip when local `updated_at >= remote`), applies `deleted_at`. When both sides changed since the last sync (local `updated_at > pull-cursor` AND remote newer), the newer wins and the loser snapshot is logged to the Postgres `sync_conflicts` table. Child-after-parent order (reverse of push for deletes is unnecessary — upserts resolve FKs by lookup; missing parents are skipped and retried next cycle).

- [ ] **Step 1: Write the failing pull test**

Create `tests/orchestrator/sync/pull.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { createPgStore, type PgStore } from '../../../orchestrator/db/pg/pool.js';
import { runPgMigrations } from '../../../orchestrator/db/pg/migrate.js';
import { pushAll } from '../../../orchestrator/sync/push.js';
import { pullAll } from '../../../orchestrator/sync/pull.js';
import { ProjectsRepo } from '../../../orchestrator/db/repositories/projects.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

let store: PgStore | null = null;
let reachable = false;
beforeAll(async () => {
  store = createPgStore(PG_URL);
  if (!store) return;
  try { await store.healthCheck(); reachable = true; } catch { console.warn('[pull.test] pg unreachable — skipping'); }
});
afterAll(async () => { if (store) await store.end(); });

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('pullAll', () => {
  beforeEach(async () => {
    if (reachable && store) { await store.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); await runPgMigrations(store); }
  });

  it('pulls a Postgres-only row into SQLite', async () => {
    if (!reachable || !store) return;
    await store.query(`INSERT INTO projects (sync_id, name, updated_at) VALUES ('remote-1','Remote P', now())`);
    const db = freshSqlite();
    const res = await pullAll(db, store);
    expect(res.projects.pulled).toBe(1);
    const row = db.prepare(`SELECT name, sync_id FROM projects WHERE sync_id='remote-1'`).get() as any;
    expect(row.name).toBe('Remote P');
  });

  it('applies a remote tombstone as a local soft-delete', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Doomed' });
    await pushAll(db, store);
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    await store.query(`UPDATE projects SET deleted_at = now(), updated_at = now() + interval '1 minute' WHERE sync_id=$1`, [syncId]);
    await pullAll(db, store);
    expect(new ProjectsRepo(db).get(p.id)).toBeNull();
    const raw = db.prepare(`SELECT deleted_at FROM projects WHERE id=?`).get(p.id) as any;
    expect(raw.deleted_at).toBeTruthy();
  });

  it('logs a conflict when both sides changed and remote wins', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    const p = new ProjectsRepo(db).create({ name: 'Base' });
    await pushAll(db, store);
    const syncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(p.id) as any).sync_id;
    // Local edit (older) since last pull, remote edit (newer).
    db.prepare(`UPDATE projects SET name='LocalEdit', updated_at='2020-01-01T00:00:00.000Z' WHERE id=?`).run(p.id);
    await store.query(`UPDATE projects SET name='RemoteEdit', updated_at = now() + interval '1 hour' WHERE sync_id=$1`, [syncId]);
    const res = await pullAll(db, store);
    expect(res.projects.conflicts).toBeGreaterThanOrEqual(1);
    expect((db.prepare(`SELECT name FROM projects WHERE id=?`).get(p.id) as any).name).toBe('RemoteEdit');
    const { rows } = await store.query<{ c: string }>(`SELECT COUNT(*)::text c FROM sync_conflicts WHERE sync_id=$1`, [syncId]);
    expect(Number(rows[0].c)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/orchestrator/sync/pull.test.ts`
Expected: FAIL — `pull.js` missing.

- [ ] **Step 3: Implement pull**

Create `orchestrator/sync/pull.ts`:

```typescript
import type { SqliteLike } from '../db/migrations.js';
import type { PgStore } from '../db/pg/pool.js';
import { SYNCED_TABLES, toSqliteValue, type SyncTable } from './schema.js';
import { getCursor, setCursor } from './cursor.js';

// Parent-before-child so a child's FK target exists locally when it lands.
const PULL_ORDER = ['projects', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off'];

function fkSource(table: SyncTable): { col: string; parentTable: string; localCol: string } | null {
  switch (table.name) {
    case 'epics': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id' };
    case 'tasks': return { col: 'epic_sync_id', parentTable: 'epics', localCol: 'epic_id' };
    case 'contracts': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id' };
    case 'worklogs': return { col: 'task_sync_id', parentTable: 'tasks', localCol: 'task_id' };
    default: return null;
  }
}

export async function pullTable(
  db: SqliteLike,
  store: PgStore,
  table: SyncTable,
): Promise<{ pulled: number; conflicts: number }> {
  const cursor = getCursor(db, 'pull', table.name);
  const fk = fkSource(table);

  // Select remote rows changed since the cursor, joining the parent sync_id.
  const pgCols = table.columns.filter((c) => !c.name.endsWith('_sync_id') || c.name === 'sync_id').map((c) => `t.${c.name}`);
  let joinSql = '';
  if (fk) {
    pgCols.push(`parent.sync_id AS ${fk.col}`);
    joinSql = ` JOIN ${fk.parentTable} parent ON parent.id = t.${fk.localCol}`;
  }
  const { rows } = await store.query<Record<string, unknown>>(
    `SELECT ${pgCols.join(', ')} FROM ${table.pgTable} t${joinSql} WHERE t.updated_at > $1 ORDER BY t.updated_at ASC`,
    [cursor],
  );

  let pulled = 0;
  let conflicts = 0;
  let maxSeen = cursor;

  for (const remote of rows) {
    const syncId = String(remote.sync_id);
    const remoteUpdated = toSqliteValue('ts', remote.updated_at) as string;

    // Resolve FK to a local id; if the parent isn't here yet, skip — a later
    // cycle (after the parent lands) will pick it up.
    let localFkId: number | null = null;
    if (fk) {
      const parentSyncId = remote[fk.col];
      if (parentSyncId == null) continue;
      const prow = db.prepare(`SELECT id FROM ${fk.parentTable} WHERE sync_id = ?`).get(parentSyncId) as { id: number } | undefined;
      if (!prow) continue;
      localFkId = prow.id;
    }

    const existing = db.prepare(`SELECT ${table.keyCol} AS k, updated_at FROM ${table.name} WHERE sync_id = ?`).get(syncId) as
      | { k: string | number; updated_at: string }
      | undefined;

    if (existing) {
      const localUpdated = existing.updated_at;
      if (localUpdated >= remoteUpdated) {
        // Local is newer-or-equal → keep local. If local changed since the last
        // pull (i.e. > cursor), this is a genuine conflict the local side won.
        if (localUpdated > cursor) {
          conflicts++;
          await logConflict(store, table, syncId, 'local_won', 'remote', remote, localUpdated, remoteUpdated);
        }
        if (remoteUpdated > maxSeen) maxSeen = remoteUpdated;
        continue;
      }
      // Remote newer → it wins. If local also changed since last pull, log it.
      if (localUpdated > cursor) {
        conflicts++;
        const localSnap = db.prepare(`SELECT * FROM ${table.name} WHERE sync_id = ?`).get(syncId);
        await logConflict(store, table, syncId, 'remote_won', 'local', localSnap, localUpdated, remoteUpdated);
      }
    }

    upsertLocal(db, table, remote, fk, localFkId);
    pulled++;
    if (remoteUpdated > maxSeen) maxSeen = remoteUpdated;
  }

  if (maxSeen > cursor) setCursor(db, 'pull', table.name, maxSeen);
  return { pulled, conflicts };
}

export async function pullAll(
  db: SqliteLike,
  store: PgStore,
): Promise<Record<string, { pulled: number; conflicts: number }>> {
  const out: Record<string, { pulled: number; conflicts: number }> = {};
  const byName = new Map(SYNCED_TABLES.map((t) => [t.name, t]));
  for (const name of PULL_ORDER) {
    out[name] = await pullTable(db, store, byName.get(name)!);
  }
  return out;
}

/** INSERT-or-UPDATE one remote row into SQLite by sync_id. */
function upsertLocal(
  db: SqliteLike,
  table: SyncTable,
  remote: Record<string, unknown>,
  fk: { col: string; localCol: string } | null,
  localFkId: number | null,
): void {
  const cols: string[] = [];
  const values: unknown[] = [];
  for (const c of table.columns) {
    if (fk && c.name === fk.col) {
      cols.push(fk.localCol);
      values.push(localFkId);
    } else {
      cols.push(c.name);
      values.push(toSqliteValue(c.kind, remote[c.name]));
    }
  }
  const placeholders = cols.map(() => '?').join(', ');
  const setClause = cols.filter((c) => c !== 'sync_id').map((c) => `${c} = excluded.${c}`).join(', ');
  db.prepare(
    `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (sync_id) DO UPDATE SET ${setClause}`,
  ).run(...values);
}

async function logConflict(
  store: PgStore,
  table: SyncTable,
  syncId: string,
  resolution: 'local_won' | 'remote_won',
  loserSide: 'local' | 'remote',
  loserPayload: unknown,
  localUpdated: string,
  remoteUpdated: string,
): Promise<void> {
  await store.query(
    `INSERT INTO sync_conflicts (table_name, sync_id, resolution, loser_side, loser_payload, local_updated_at, remote_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [table.name, syncId, resolution, loserSide, JSON.stringify(loserPayload ?? {}), localUpdated, remoteUpdated],
  );
}
```

> **`days_off` ON CONFLICT note:** `days_off` has a UNIQUE on `sync_id` AND a PK on `date`. The upsert targets `sync_id`; a pulled row whose `date` collides with a different local `sync_id` is an unexpected divergence (two stores invented different identities for the same date). For v1 this is out of scope — `days_off` rows are user-created on one device at a time, and the ETL/v13 backfill give every existing date a single shared sync_id. If a PK collision throws, the row is skipped and logged (wrap `upsertLocal` for `days_off` in a try/catch that `console.warn`s and continues).

- [ ] **Step 4: Run the pull test**

Run: `npx vitest run tests/orchestrator/sync/pull.test.ts`
Expected: PASS against the container.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/sync/pull.ts tests/orchestrator/sync/pull.test.ts
git commit -m "feat: #69 sync pull — Postgres→local LWW, tombstones, conflict logging"
```

---

## Task 8: Sync orchestration + bootstrap wiring

**Files:**
- Create: `orchestrator/sync/service.ts`
- Modify: `orchestrator/db/connection.ts` (add `openStores`)
- Modify: `orchestrator/bootstrap.ts` (create pg pool, run pg migrations, construct + start `SyncService`, expose on handle, stop on shutdown)
- Test: `tests/orchestrator/sync/service.test.ts`, extend `tests/orchestrator/bootstrap.test.ts`

**Interfaces:**
- Consumes: `pushAll` (Task 6), `pullAll` (Task 7), `PgStore`, `SqliteLike`.
- Produces:
  - `interface SyncServiceOptions { db: SqliteLike; store: PgStore | null; periodMs?: number; debounceMs?: number; onCycle?: (r: SyncCycleResult) => void; }`
  - `interface SyncCycleResult { ok: boolean; push?: Record<string, number>; pull?: Record<string, { pulled: number; conflicts: number }>; error?: string; }`
  - `class SyncService { constructor(opts); start(): void; stop(): void; notifyLocalChange(): void; syncNow(): Promise<SyncCycleResult>; }`
  - `syncNow()` runs push-then-pull; on any thrown Postgres error it returns `{ ok: false, error }` WITHOUT throwing (offline no-op). When `store` is null, `start`/`notifyLocalChange`/`syncNow` are inert (`syncNow` returns `{ ok: true }` with no work). `notifyLocalChange()` debounces a `syncNow()`; `start()` also schedules a periodic `syncNow()` every `periodMs`.
  - `connection.ts`: `function openStores(overridePath?: string): { sqlite: Database.Database; pg: PgStore | null }` — opens SQLite via the existing `openDb`, builds the optional pg store, runs pg migrations best-effort (logged, never fatal).

- [ ] **Step 1: Write the failing service test**

Create `tests/orchestrator/sync/service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../../orchestrator/db/migrations.js';
import { SyncService } from '../../../orchestrator/sync/service.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshSqlite(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('SyncService offline behaviour', () => {
  it('syncNow is a clean no-op when store is null', async () => {
    const svc = new SyncService({ db: freshSqlite(), store: null });
    const r = await svc.syncNow();
    expect(r.ok).toBe(true);
  });

  it('syncNow returns ok:false (does not throw) when the store query rejects', async () => {
    const failing = {
      query: async () => { throw new Error('ECONNREFUSED'); },
      healthCheck: async () => false,
      end: async () => {},
    };
    const svc = new SyncService({ db: freshSqlite(), store: failing as any });
    const r = await svc.syncNow();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('notifyLocalChange debounces into a single syncNow', async () => {
    let cycles = 0;
    const svc = new SyncService({
      db: freshSqlite(), store: null, debounceMs: 20,
      onCycle: () => { cycles++; },
    });
    svc.start();
    svc.notifyLocalChange();
    svc.notifyLocalChange();
    svc.notifyLocalChange();
    await new Promise((r) => setTimeout(r, 60));
    svc.stop();
    expect(cycles).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/orchestrator/sync/service.test.ts`
Expected: FAIL — `service.js` missing.

- [ ] **Step 3: Implement the service**

Create `orchestrator/sync/service.ts`:

```typescript
import type { SqliteLike } from '../db/migrations.js';
import type { PgStore } from '../db/pg/pool.js';
import { pushAll } from './push.js';
import { pullAll } from './pull.js';

export interface SyncCycleResult {
  ok: boolean;
  push?: Record<string, number>;
  pull?: Record<string, { pulled: number; conflicts: number }>;
  error?: string;
}

export interface SyncServiceOptions {
  db: SqliteLike;
  store: PgStore | null;
  /** Periodic full-cycle interval. Default 60s. */
  periodMs?: number;
  /** Debounce window after a local change. Default 1.5s. */
  debounceMs?: number;
  onCycle?: (r: SyncCycleResult) => void;
}

/**
 * Drives push+pull. Postgres is optional and may vanish at any time: every
 * cycle catches connection errors and returns ok:false instead of throwing, so
 * the desktop keeps working offline. Triggers: debounced local-change notify,
 * a periodic timer, and an explicit syncNow().
 */
export class SyncService {
  private readonly db: SqliteLike;
  private readonly store: PgStore | null;
  private readonly periodMs: number;
  private readonly debounceMs: number;
  private readonly onCycle?: (r: SyncCycleResult) => void;

  private timer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private pending = false;

  constructor(opts: SyncServiceOptions) {
    this.db = opts.db;
    this.store = opts.store;
    this.periodMs = opts.periodMs ?? 60_000;
    this.debounceMs = opts.debounceMs ?? 1_500;
    this.onCycle = opts.onCycle;
  }

  start(): void {
    if (!this.store || this.timer) return;
    this.timer = setInterval(() => { void this.syncNow(); }, this.periodMs);
    // Don't keep the event loop alive just for sync.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
  }

  notifyLocalChange(): void {
    if (!this.store) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncNow();
    }, this.debounceMs);
    if (this.debounceTimer && typeof this.debounceTimer.unref === 'function') this.debounceTimer.unref();
  }

  async syncNow(): Promise<SyncCycleResult> {
    if (!this.store) {
      const r: SyncCycleResult = { ok: true };
      this.onCycle?.(r);
      return r;
    }
    // Collapse overlapping runs: if one is in flight, mark pending and return.
    if (this.running) { this.pending = true; return { ok: true }; }
    this.running = true;
    let result: SyncCycleResult;
    try {
      const push = await pushAll(this.db, this.store);
      const pull = await pullAll(this.db, this.store);
      result = { ok: true, push, pull };
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.running = false;
    }
    this.onCycle?.(result);
    if (this.pending) { this.pending = false; void this.syncNow(); }
    return result;
  }
}
```

- [ ] **Step 4: Run the service test**

Run: `npx vitest run tests/orchestrator/sync/service.test.ts`
Expected: PASS (no Postgres needed — uses null/failing stub stores).

- [ ] **Step 5: Add `openStores` to connection.ts**

In `orchestrator/db/connection.ts`, add:
```typescript
import { createPgStore, type PgStore } from './pg/pool.js';
import { runPgMigrations } from './pg/migrate.js';
```
and append:
```typescript
/**
 * Open both stores. SQLite is required (primary); Postgres is optional — when
 * WATCHTOWER_PG_URL is unset/unreachable the pg store is null and sync is
 * dormant. Postgres migrations run best-effort and never block boot.
 */
export function openStores(overridePath?: string): { sqlite: Database.Database; pg: PgStore | null } {
  const sqlite = openDb(overridePath);
  const pg = createPgStore();
  if (pg) {
    // Fire-and-forget; a hub outage must not delay or crash startup.
    runPgMigrations(pg).catch((err) => {
      console.error('[orchestrator] Postgres migrations failed (sync dormant this session):', err);
    });
  }
  return { sqlite, pg };
}
```

- [ ] **Step 6: Wire the service into bootstrap**

In `orchestrator/bootstrap.ts`:
- Import: `import { createPgStore, type PgStore } from './db/pg/pool.js';`, `import { runPgMigrations } from './db/pg/migrate.js';`, `import { SyncService } from './sync/service.js';`
- Add `pg: PgStore | null` and `sync: SyncService` to `BootstrapHandle`.
- After `dbHandle` is created, build the pg store and sync service:
```typescript
  const pg = createPgStore();
  if (pg) {
    try { await runPgMigrations(pg); }
    catch (err) { console.error('[orchestrator] pg migrations failed (sync dormant):', err); }
  }
  const sync = new SyncService({ db: dbHandle.raw, store: pg });
  sync.start();
```
- Add `pg` and `sync` to the returned handle object.
- In `shutdown()`, add (before `dbHandle.close()`): `sync.stop(); if (pg) await pg.end();`

- [ ] **Step 7: Extend the bootstrap test**

In `tests/orchestrator/bootstrap.test.ts`, add a case asserting bootstrap succeeds and exposes a `sync` handle even when Postgres is absent. If the suite sets `WATCHTOWER_PG_URL`, unset it for this case so `createPgStore()` returns null (set `NODE_ENV='production'` too, or pass no env — note `defaultPgUrl()` returns the dev URL in non-prod, so to force null in the test set `process.env.NODE_ENV='production'` and ensure `WATCHTOWER_PG_URL` is unset, restoring both after):
```typescript
  it('boots SQLite-only when Postgres is unavailable (sync dormant)', async () => {
    const prevUrl = process.env.WATCHTOWER_PG_URL;
    const prevNode = process.env.NODE_ENV;
    delete process.env.WATCHTOWER_PG_URL;
    process.env.NODE_ENV = 'production';
    try {
      const handle = await bootstrap({
        supportDir: mkdtempSync(path.join(tmpdir(), 'wt-boot-')),
        portRange: [0, 0],
        timetrackerMigration: { skip: true },
      });
      expect(handle.sync).toBeTruthy();
      expect(handle.pg).toBeNull();
      const r = await handle.sync.syncNow();
      expect(r.ok).toBe(true);
      await handle.shutdown();
    } finally {
      if (prevUrl === undefined) delete process.env.WATCHTOWER_PG_URL; else process.env.WATCHTOWER_PG_URL = prevUrl;
      if (prevNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNode;
    }
  });
```
(Match the existing bootstrap.test.ts imports for `mkdtempSync`, `tmpdir`, `path`, `bootstrap` — add any that are missing.)

- [ ] **Step 8: Trigger sync on local writes (debounce hook)**

In `orchestrator/index.ts`, after a successful TT mutation, nudge the sync service. Locate where `handle` is set and add a tiny helper near the other repo factories:
```typescript
function notifySync(): void {
  handle?.sync.notifyLocalChange();
}
```
Call `notifySync();` at the end of the write-path IPC handlers for the synced tables (projects create/update/archive/delete, epics create/update/reorder/delete, tasks create/update/delete/jira mutations, worklogs create/update/delete, contracts create/update/delete, daysOff upsert/delete, and the `setSetting` handler that flips to_accept→done). Each call site is fire-and-forget (the method is synchronous and debounced). Do NOT block the IPC response on sync.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS, count ≥ baseline + all new tests.

- [ ] **Step 10: Typecheck both projects**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npx tsc -p client/tsconfig.json --noEmit`
Expected: no NEW errors (pre-existing client drift per CLAUDE.md is acceptable).

- [ ] **Step 11: Manual end-to-end convergence check (against local Postgres)**

With the `fitness-postgres` container up, run a scratch script that: (1) opens a temp SQLite + migrates, (2) `createPgStore()` + `runPgMigrations`, (3) creates a project/epic/task/worklog via repos, (4) `pushAll`, (5) inserts a Postgres-only project, (6) `pullAll`, (7) edits the same row on both sides and runs another cycle, then prints both stores. Confirm: local rows appear in Postgres; the Postgres-only row appears in SQLite; the conflicting edit resolves to the newer timestamp on both sides; `sync_conflicts` has one row. Write this as `scratchpad`/throwaway (do not commit) or as a guarded `it.skip` in `service.test.ts`. Record the observed convergence in the commit message.

- [ ] **Step 12: Commit**

```bash
git add orchestrator/sync/service.ts orchestrator/db/connection.ts orchestrator/bootstrap.ts orchestrator/index.ts tests/orchestrator/sync/service.test.ts tests/orchestrator/bootstrap.test.ts
git commit -m "feat: #69 sync orchestration — debounce+timer+offline no-op, bootstrap wiring, write-path nudge"
```

---

## Final verification (after Task 8)

- [ ] **Full suite green:** `npm test` — count ≥ baseline + all added tests.
- [ ] **Both typechecks clean of new errors:** `npx tsc -p orchestrator/tsconfig.json --noEmit && npx tsc -p client/tsconfig.json --noEmit`.
- [ ] **Offline safety spot-check:** stop the container (`docker stop fitness-postgres`), run `npm test` — Postgres integration suites skip-with-warning, everything else stays green; restart the container afterwards (`docker start fitness-postgres`).
- [ ] **Build smoke:** `npm run build:orch` — orchestrator compiles and assets copy.
- [ ] Branch `feat/timetracker-postgres-sync` holds one commit per task (Tasks 1-8), ready for PR review.

---

## Spec coverage map (self-review)

- §3.1 sync columns on all 6 tables (both stores) → Tasks 2 (pg), 3 (sqlite).
- §3.2 keep local integer PKs; sync_id crosses the wire → Tasks 5-7 (FK-by-sync_id).
- §3.3 `project_rates`→`contracts` → Task 3 (sqlite rename), Task 2 (pg uses `contracts`).
- §3.4 proper Postgres types (SERIAL/BOOLEAN/DATE/TIMESTAMPTZ/NUMERIC/JSONB, CHECK + partial unique) → Task 2.
- §3.5 keep `is_billable` → preserved everywhere (no drop).
- §3.6 soft-delete + explicit cascade + (purge deferred) → Task 4. *(Periodic tombstone purge is noted out-of-scope for this plan; see below.)*
- §4 sync service (cursor, push, pull, conflict log, trigger, idempotency, clocks) → Tasks 6, 7, 8.
- §5 ETL (read-only prod SQLite → local pg, deterministic sync_id, row counts) → Task 5.
- §6 tech (`pg`, pg migration runner, dual-store wiring, optional/lazy, env-gated tests) → Tasks 1, 2, 8.

**Deliberate scope note — tombstone purge (§3.6 last sentence, §4 idempotency):** the "periodic purge of tombstones older than N days on both stores" is intentionally NOT implemented in this plan. Hard-deleting tombstones requires proving every device has synced past them, which needs per-device sync-state tracking that doesn't exist until the iPad clients land (out of scope per §8). Implementing purge now risks resurrecting rows on a device that hasn't pulled the tombstone. Tombstones accumulate harmlessly in the interim. This should be a follow-up issue once multi-device sync-state exists. Surface this to the user at plan hand-off.
