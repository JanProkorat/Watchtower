# Supabase data plane live (iPad billing #1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-compute per-worklog billing fields (`effective_minutes`, `resolved_rate`, `rate_currency`, `earned_amount`) into the Supabase `worklogs` rows during the existing sync, and secure the synced tables with RLS so an authenticated client can read them — no iPad UI yet.

**Architecture:** A pure `computeWorklogBilling` helper mirrors the existing `SUM_EARNED` earnings SQL. The existing generic SQLite→Postgres push (`orchestrator/sync/push.ts`) gains support for *derived* columns: for `worklogs`, a deriver computes the four fields per row (Postgres-only — never stored in SQLite) and the upsert writes them. Contract-rate edits bump affected worklogs' `updated_at` so the next push re-derives them; a one-time cursor reset backfills existing rows. RLS + `authenticated`-SELECT policies ship as orchestrator-run pg migrations.

**Tech Stack:** TypeScript, Node `pg`, `node:sqlite`/better-sqlite3, vitest (`environment: node`), Supabase (Postgres + Auth + RLS).

## Global Constraints

- **Mirror the existing earnings formula exactly** (`orchestrator/db/reportsSql.ts` `SUM_EARNED`): hourly → `effective_minutes × rate_amount / 60`; daily → `effective_minutes / 60 / hours_per_day × rate_amount`. Rate window = the contract with the greatest `effective_from ≤ work_date`, upper-bounded by the next contract's `effective_from` (the `LEAD` semantics) — **not** `end_date`. No new/re-derived math.
- **Derived fields are Postgres-only.** Never add them to the SQLite schema; they are computed in the push path.
- **RLS:** `anon` → no access; `authenticated` → SELECT all rows (single-user, no `owner` column). Write policies are out of scope (sub-project 3). The orchestrator's sync role bypasses RLS.
- Connection string is read from `process.env.WATCHTOWER_PG_URL` (`orchestrator/db/pg/pool.ts`) — already points at Supabase (`https://xggihnrvsmbzbkhsnuky.supabase.co`).
- vitest `environment: node`. Sync push/pull tests need a real Postgres and **skip gracefully when `WATCHTOWER_PG_URL` is unreachable**; pure tests need no DB.
- Worktree: `.claude/worktrees/supabase-dataplane` (branch `feat/supabase-dataplane`); it has its own `node_modules` (`npm install` already run).
- Do not commit `dist/` or any build output. Never edit `.env*`.

## File Structure

- `orchestrator/db/worklogBilling.ts` — **new.** Pure `computeWorklogBilling` + types.
- `orchestrator/sync/derive.ts` — **new.** `createWorklogDeriver(db)` — resolves a raw worklog row → derived field values (cached project-id + contracts lookups).
- `orchestrator/sync/schema.ts` — **modify.** Add the 4 derived columns to the `worklogs` descriptor (flagged `derived`); register the deriver.
- `orchestrator/sync/push.ts` — **modify.** Skip derived columns in the SQLite SELECT; apply the table's deriver per row before upsert.
- `orchestrator/db/pg/schema.ts` — **modify.** New migration: `ALTER TABLE worklogs ADD` the 4 columns; the RLS enable + policies.
- `orchestrator/db/rebill.ts` — **new.** `markWorklogsForRebill(db, projectId, fromDate)`.
- `orchestrator/index.ts` — **modify.** Call `markWorklogsForRebill` from the `contracts:create/update/delete` handlers.
- `orchestrator/bootstrap.ts` — **modify.** One-time worklogs push-cursor reset (backfill) guarded by a settings flag.
- `docs/runbooks/supabase-data-plane.md` — **new.** Owner steps: create auth user, the curl auth+read smoke check.
- Tests: `tests/orchestrator/worklogBilling.test.ts` (new), `tests/orchestrator/sync/derive.test.ts` (new), extend `tests/orchestrator/sync/schema.test.ts` and `tests/orchestrator/sync/push.test.ts`, `tests/orchestrator/rebill.test.ts` (new).

---

## Task 1: `computeWorklogBilling` pure helper

**Files:**
- Create: `orchestrator/db/worklogBilling.ts`
- Test: `tests/orchestrator/worklogBilling.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ContractLite { effectiveFrom: string; rateType: 'hourly' | 'daily'; rateAmount: number; currency: string; hoursPerDay: number }`
  - `interface WorklogBilling { effectiveMinutes: number; resolvedRate: number | null; rateCurrency: string | null; earnedAmount: number | null }`
  - `computeWorklogBilling(input: { minutes: number; reportedMinutes: number | null; workDate: string; contracts: ContractLite[] }): WorklogBilling`

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator/worklogBilling.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeWorklogBilling, type ContractLite } from '../../orchestrator/db/worklogBilling.js';

const hourly = (effectiveFrom: string, rateAmount: number, currency = 'EUR'): ContractLite =>
  ({ effectiveFrom, rateType: 'hourly', rateAmount, currency, hoursPerDay: 8 });
const daily = (effectiveFrom: string, rateAmount: number, hoursPerDay = 8, currency = 'CZK'): ContractLite =>
  ({ effectiveFrom, rateType: 'daily', rateAmount, currency, hoursPerDay });

describe('computeWorklogBilling', () => {
  it('reported_minutes overrides minutes for effective_minutes', () => {
    const r = computeWorklogBilling({ minutes: 120, reportedMinutes: 90, workDate: '2026-06-01', contracts: [hourly('2026-01-01', 100)] });
    expect(r.effectiveMinutes).toBe(90);
  });

  it('hourly earned = effective/60 * rate', () => {
    const r = computeWorklogBilling({ minutes: 90, reportedMinutes: null, workDate: '2026-06-01', contracts: [hourly('2026-01-01', 100)] });
    expect(r.effectiveMinutes).toBe(90);
    expect(r.resolvedRate).toBe(100);
    expect(r.rateCurrency).toBe('EUR');
    expect(r.earnedAmount).toBeCloseTo(150); // 90/60 * 100
  });

  it('daily earned = effective/60/hoursPerDay * rate', () => {
    const r = computeWorklogBilling({ minutes: 240, reportedMinutes: null, workDate: '2026-06-01', contracts: [daily('2026-01-01', 4000, 8)] });
    expect(r.earnedAmount).toBeCloseTo(2000); // 240/60/8 * 4000 = 0.5 MD * 4000
    expect(r.rateCurrency).toBe('CZK');
  });

  it('picks the contract whose window contains work_date (LEAD upper bound)', () => {
    const contracts = [hourly('2026-01-01', 100), hourly('2026-06-01', 200)];
    expect(computeWorklogBilling({ minutes: 60, reportedMinutes: null, workDate: '2026-05-31', contracts }).resolvedRate).toBe(100);
    expect(computeWorklogBilling({ minutes: 60, reportedMinutes: null, workDate: '2026-06-01', contracts }).resolvedRate).toBe(200); // boundary = inclusive lower
  });

  it('returns null rate/earned when no contract covers the date', () => {
    const r = computeWorklogBilling({ minutes: 60, reportedMinutes: null, workDate: '2025-12-31', contracts: [hourly('2026-01-01', 100)] });
    expect(r.effectiveMinutes).toBe(60);
    expect(r.resolvedRate).toBeNull();
    expect(r.rateCurrency).toBeNull();
    expect(r.earnedAmount).toBeNull();
  });

  it('no contracts at all → null earned', () => {
    const r = computeWorklogBilling({ minutes: 60, reportedMinutes: null, workDate: '2026-06-01', contracts: [] });
    expect(r.earnedAmount).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/supabase-dataplane && npx vitest run tests/orchestrator/worklogBilling.test.ts`
Expected: FAIL — cannot resolve `../../orchestrator/db/worklogBilling.js`.

- [ ] **Step 3: Write the implementation**

Create `orchestrator/db/worklogBilling.ts`:

```ts
// Per-worklog billing, mirroring orchestrator/db/reportsSql.ts SUM_EARNED.
// Pure (no I/O) so it is unit-testable; used by the sync push to write the
// Postgres-only derived columns. Do NOT re-derive — keep in lockstep with
// reportsSql's hourly/daily formula and LEAD-based rate window.

export interface ContractLite {
  effectiveFrom: string;          // 'YYYY-MM-DD'
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  currency: string;
  hoursPerDay: number;
}

export interface WorklogBilling {
  effectiveMinutes: number;
  resolvedRate: number | null;
  rateCurrency: string | null;
  earnedAmount: number | null;
}

/**
 * Resolve the contract whose window contains `workDate`: the latest contract
 * with `effectiveFrom <= workDate`, upper-bounded by the next contract's
 * `effectiveFrom` (the LEAD semantics in PROJECT_RATE_PERIODS_CTE). Returns
 * null when no contract starts on or before the date.
 */
function resolveContract(workDate: string, contracts: ContractLite[]): ContractLite | null {
  let best: ContractLite | null = null;
  for (const c of contracts) {
    if (c.effectiveFrom <= workDate && (best === null || c.effectiveFrom > best.effectiveFrom)) {
      best = c;
    }
  }
  return best;
}

export function computeWorklogBilling(input: {
  minutes: number;
  reportedMinutes: number | null;
  workDate: string;
  contracts: ContractLite[];
}): WorklogBilling {
  const effectiveMinutes = input.reportedMinutes ?? input.minutes;
  const c = resolveContract(input.workDate, input.contracts);
  if (!c) {
    return { effectiveMinutes, resolvedRate: null, rateCurrency: null, earnedAmount: null };
  }
  const earnedAmount =
    c.rateType === 'hourly'
      ? (effectiveMinutes * c.rateAmount) / 60
      : (effectiveMinutes / 60 / c.hoursPerDay) * c.rateAmount;
  return { effectiveMinutes, resolvedRate: c.rateAmount, rateCurrency: c.currency, earnedAmount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/supabase-dataplane && npx vitest run tests/orchestrator/worklogBilling.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/worklogBilling.ts tests/orchestrator/worklogBilling.test.ts
git commit -m "feat: computeWorklogBilling — per-worklog billing mirroring SUM_EARNED"
```

---

## Task 2: Derived billing columns in the Postgres schema + sync push

**Files:**
- Modify: `orchestrator/db/pg/schema.ts` (add a migration)
- Create: `orchestrator/sync/derive.ts`
- Modify: `orchestrator/sync/schema.ts`
- Modify: `orchestrator/sync/push.ts`
- Modify: `orchestrator/bootstrap.ts` (one-time backfill cursor reset)
- Test: extend `tests/orchestrator/sync/schema.test.ts`; create `tests/orchestrator/sync/derive.test.ts`; extend `tests/orchestrator/sync/push.test.ts`

**Interfaces:**
- Consumes: `computeWorklogBilling`, `ContractLite` (Task 1).
- Produces:
  - In `orchestrator/sync/schema.ts`: the `worklogs` `SyncTable.columns` includes `{ name: 'effective_minutes', kind: 'int', derived: true }`, `{ name: 'resolved_rate', kind: 'numeric', derived: true }`, `{ name: 'rate_currency', kind: 'text', derived: true }`, `{ name: 'earned_amount', kind: 'numeric', derived: true }`; `SyncColumn` gains optional `derived?: boolean`; a `DERIVERS: Record<string, (db) => (row) => Record<string, unknown>>` export maps `worklogs` → `createWorklogDeriver`.
  - In `orchestrator/sync/derive.ts`: `createWorklogDeriver(db: SqliteLike): (row: Record<string, unknown>) => { effective_minutes: number; resolved_rate: number | null; rate_currency: string | null; earned_amount: number | null }`.

> **Implementer:** first READ `orchestrator/sync/schema.ts`, `orchestrator/sync/push.ts`, and `orchestrator/db/pg/schema.ts` (its trailing `migrations` array + `runPgMigrations`) to match their exact shapes — the snippets below show the required additions, adapt them to the real surrounding code. The four `kind` values must be ones `toPgValue`/`toSqliteValue` already handle (`numeric` may need adding alongside `int`/`text` — check `schema.ts`; if there's no `numeric`, use the existing money kind or add one minimally and symmetrically).

- [ ] **Step 1 (pg schema): add the derived columns + bump the pg migration list**

In `orchestrator/db/pg/schema.ts`, add a new migration string and append it to the `migrations` array (after the existing v2). The columns are nullable (existing rows backfill via Task 2 Step 6):

```ts
const WORKLOGS_BILLING = `
ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS effective_minutes INTEGER;
ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS resolved_rate     NUMERIC;
ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS rate_currency     TEXT;
ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS earned_amount     NUMERIC;
`;
// → add WORKLOGS_BILLING as the `up` of a new migration entry (next version number).
```

- [ ] **Step 2 (derive hook): write the deriver**

Create `orchestrator/sync/derive.ts`:

```ts
import { computeWorklogBilling, type ContractLite } from '../db/worklogBilling.js';

// Minimal shape we call on the SQLite handle (matches the project's SqliteLike).
interface SqliteLike { prepare(sql: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] }; }

/**
 * Per-cycle deriver for worklog rows. Resolves each worklog's project (via
 * task_sync_id → task → epic → project) and that project's contracts, both
 * cached for the push cycle, then computes the Postgres-only billing fields.
 * The raw row comes from the push SELECT (sync_id/task_sync_id/work_date/
 * minutes/reported_minutes/...).
 */
export function createWorklogDeriver(db: SqliteLike) {
  const projectByTaskSyncId = new Map<string, number | null>();
  const contractsByProject = new Map<number, ContractLite[]>();

  const projectIdFor = (taskSyncId: string | null): number | null => {
    if (!taskSyncId) return null;
    if (projectByTaskSyncId.has(taskSyncId)) return projectByTaskSyncId.get(taskSyncId)!;
    const row = db.prepare(
      `SELECT e.project_id AS pid
         FROM tasks t JOIN epics e ON e.id = t.epic_id
        WHERE t.sync_id = ?`,
    ).get(taskSyncId) as { pid: number } | undefined;
    const pid = row ? row.pid : null;
    projectByTaskSyncId.set(taskSyncId, pid);
    return pid;
  };

  const contractsFor = (projectId: number): ContractLite[] => {
    if (contractsByProject.has(projectId)) return contractsByProject.get(projectId)!;
    const rows = db.prepare(
      `SELECT effective_from AS effectiveFrom, rate_type AS rateType,
              rate_amount AS rateAmount, currency, hours_per_day AS hoursPerDay
         FROM contracts
        WHERE project_id = ? AND deleted_at IS NULL`,
    ).all(projectId) as ContractLite[];
    contractsByProject.set(projectId, rows);
    return rows;
  };

  return (row: Record<string, unknown>) => {
    const taskSyncId = (row.task_sync_id as string | null) ?? null;
    const projectId = projectIdFor(taskSyncId);
    const contracts = projectId == null ? [] : contractsFor(projectId);
    const b = computeWorklogBilling({
      minutes: Number(row.minutes),
      reportedMinutes: row.reported_minutes == null ? null : Number(row.reported_minutes),
      workDate: String(row.work_date),
      contracts,
    });
    return {
      effective_minutes: b.effectiveMinutes,
      resolved_rate: b.resolvedRate,
      rate_currency: b.rateCurrency,
      earned_amount: b.earnedAmount,
    };
  };
}
```

- [ ] **Step 3 (descriptor): add derived columns + register the deriver**

In `orchestrator/sync/schema.ts`: add `derived?: boolean` to the `SyncColumn` type; append the four derived columns (shown in Interfaces above) to the `worklogs` table's `columns`; and export:

```ts
import { createWorklogDeriver } from './derive.js';
export const DERIVERS: Record<string, (db: any) => (row: Record<string, unknown>) => Record<string, unknown>> = {
  worklogs: createWorklogDeriver,
};
```

- [ ] **Step 4 (push): skip derived in SELECT, apply deriver before upsert**

In `orchestrator/sync/push.ts` `pushTable`: build the SQLite SELECT column list from **non-derived** columns only (`table.columns.filter(c => !c.derived)`); if `DERIVERS[table.name]` exists, build the deriver once for the cycle and, for each fetched row, merge `deriver(row)` into the row object before passing it to `upsertRow`. `upsertRow`'s INSERT/UPDATE column list stays the full `table.columns` (so the derived columns are written from the merged values). Keep the LWW `WHERE … updated_at <` guard unchanged.

- [ ] **Step 5 (schema test): assert the descriptor**

Extend `tests/orchestrator/sync/schema.test.ts`:

```ts
it('worklogs descriptor carries the 4 derived billing columns', () => {
  const wl = SYNCED_TABLES.find((t) => t.name === 'worklogs')!;
  const derived = wl.columns.filter((c) => c.derived).map((c) => c.name).sort();
  expect(derived).toEqual(['earned_amount', 'effective_minutes', 'rate_currency', 'resolved_rate']);
});
```

- [ ] **Step 6 (backfill): one-time worklogs cursor reset**

In `orchestrator/bootstrap.ts`, after pg migrations run and before/at sync start, add a guarded one-time reset so existing worklog rows re-push with derived fields:

```ts
// One-time backfill: re-push all worklogs once so the derived billing columns
// populate on rows synced before they existed. Guarded by a settings flag.
const FLAG = 'sync.backfill.worklogs_billing.done';
const done = dbHandle.raw.prepare('SELECT value FROM settings WHERE key = ?').get(FLAG) as { value: string } | undefined;
if (pg && !done) {
  dbHandle.raw.prepare('DELETE FROM settings WHERE key = ?').run('sync.cursor.push.worklogs'); // reset cursor → epoch
  dbHandle.raw.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(FLAG, '1');
}
```

(Match the real `settings` access pattern + cursor key from `orchestrator/sync/cursor.ts`; the cursor default is epoch when the key is absent.)

- [ ] **Step 7 (derive test): unit-test the deriver against a node:sqlite db**

Create `tests/orchestrator/sync/derive.test.ts` using `node:sqlite` (like the other sync tests): seed a project, epic, task, one contract, and a worklog; build `createWorklogDeriver(db)`; assert it returns the expected `earned_amount`/`effective_minutes`/`rate_currency` for a raw row `{ task_sync_id, work_date, minutes, reported_minutes }`; and that a worklog whose task resolves to no contract yields `earned_amount: null`. (Mirror the seeding style in `tests/orchestrator/sync/push.test.ts`.)

- [ ] **Step 8 (push test): derived columns land in Postgres**

Extend `tests/orchestrator/sync/push.test.ts` (the real-Postgres, skip-if-unreachable suite): after pushing a worklog backed by a contract, `SELECT effective_minutes, resolved_rate, rate_currency, earned_amount FROM worklogs WHERE sync_id = …` and assert the computed values; confirm a contract-less worklog has `earned_amount IS NULL`.

- [ ] **Step 9: Run tests + typecheck**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/supabase-dataplane && npx vitest run tests/orchestrator/sync/ tests/orchestrator/worklogBilling.test.ts && npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: pure + derive + schema tests PASS; push test PASSES if `WATCHTOWER_PG_URL` reachable, else SKIPS; orchestrator typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add orchestrator/db/pg/schema.ts orchestrator/sync/derive.ts orchestrator/sync/schema.ts orchestrator/sync/push.ts orchestrator/bootstrap.ts tests/orchestrator/sync/derive.test.ts tests/orchestrator/sync/schema.test.ts tests/orchestrator/sync/push.test.ts
git commit -m "feat: pre-compute worklog billing fields into Postgres on sync push"
```

---

## Task 3: Recompute affected worklogs on contract change

**Files:**
- Create: `orchestrator/db/rebill.ts`
- Modify: `orchestrator/index.ts` (`contracts:create` / `contracts:update` / `contracts:delete` handlers)
- Test: `tests/orchestrator/rebill.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1/2 directly (it only bumps `updated_at`; the next push re-derives).
- Produces: `markWorklogsForRebill(db: SqliteLike, projectId: number, fromDate: string, nowIso: string): number` — bumps `updated_at = nowIso` on all non-deleted worklogs of `projectId` with `work_date >= fromDate`; returns the count.

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator/rebill.test.ts` (node:sqlite; seed project/epic/task + worklogs at several dates):

```ts
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { markWorklogsForRebill } from '../../orchestrator/db/rebill.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function seed() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db as never);
  db.exec(`INSERT INTO projects (id, sync_id, name) VALUES (1,'p1','P');`);
  db.exec(`INSERT INTO epics (id, sync_id, project_id, name) VALUES (1,'e1',1,'E');`);
  db.exec(`INSERT INTO tasks (id, sync_id, epic_id, number, title) VALUES (1,'t1',1,1,'T');`);
  db.exec(`INSERT INTO worklogs (id, sync_id, task_id, work_date, minutes, updated_at) VALUES
    (1,'w1',1,'2026-05-01',60,'2026-05-01T00:00:00.000Z'),
    (2,'w2',1,'2026-06-15',60,'2026-06-15T00:00:00.000Z');`);
  return db;
}

describe('markWorklogsForRebill', () => {
  it('bumps updated_at only for worklogs on/after fromDate', () => {
    const db = seed();
    const now = '2026-06-26T10:00:00.000Z';
    const n = markWorklogsForRebill(db as never, 1, '2026-06-01', now);
    expect(n).toBe(1);
    const w = (id: number) => (db.prepare('SELECT updated_at u FROM worklogs WHERE id=?').get(id) as { u: string }).u;
    expect(w(2)).toBe(now);                    // on/after → bumped
    expect(w(1)).toBe('2026-05-01T00:00:00.000Z'); // before → untouched
  });
});
```

> **Implementer:** confirm the exact `tasks` columns (`number`, `title`) and `worklogs` columns from `orchestrator/db/migrations.ts` and adjust the seed INSERTs to satisfy NOT NULL/CHECK constraints if they differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/supabase-dataplane && npx vitest run tests/orchestrator/rebill.test.ts`
Expected: FAIL — cannot resolve `../../orchestrator/db/rebill.js`.

- [ ] **Step 3: Write the implementation**

Create `orchestrator/db/rebill.ts`:

```ts
interface SqliteLike { prepare(sql: string): { run(...a: unknown[]): { changes: number | bigint } }; }

/**
 * Mark worklogs for re-push after a contract/rate change. Bumps `updated_at`
 * (the push cursor key) on every non-deleted worklog of `projectId` whose
 * `work_date >= fromDate`, so the next sync re-derives their billing fields.
 * Returns the number of rows touched.
 */
export function markWorklogsForRebill(
  db: SqliteLike,
  projectId: number,
  fromDate: string,
  nowIso: string,
): number {
  const res = db.prepare(
    `UPDATE worklogs
        SET updated_at = ?
      WHERE deleted_at IS NULL
        AND work_date >= ?
        AND task_id IN (
          SELECT t.id FROM tasks t JOIN epics e ON e.id = t.epic_id
           WHERE e.project_id = ?
        )`,
  ).run(nowIso, fromDate, projectId);
  return Number(res.changes);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/supabase-dataplane && npx vitest run tests/orchestrator/rebill.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the contracts handlers**

In `orchestrator/index.ts`, in each of `contracts:create`, `contracts:update`, `contracts:delete` handlers, after the repo write and before/with `notifySync()`, call `markWorklogsForRebill(db, projectId, fromDate, nowIso())` where:
- `projectId` = the contract's `project_id` (from the input or the loaded row);
- `fromDate` = the **earliest** `effective_from` involved — for create/delete the row's `effective_from`; for update, the **min** of the old and new `effective_from` (so moving a contract earlier re-bills the newly-covered range). Read the existing row before updating to get the old value.
- `nowIso()` = the same timestamp helper the handlers already use for `updated_at` (match the existing import).

Show the create handler as the reference edit (adapt update/delete):

```ts
// contracts:create handler — after `const row = contractsRepo.create(input);`
markWorklogsForRebill(db, row.project_id, row.effective_from, nowIso());
notifySync();
```

- [ ] **Step 6: Typecheck**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/supabase-dataplane && npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: clean (no new errors).

- [ ] **Step 7: Commit**

```bash
git add orchestrator/db/rebill.ts orchestrator/index.ts tests/orchestrator/rebill.test.ts
git commit -m "feat: re-bill affected worklogs on contract change (bump updated_at for re-push)"
```

---

## Task 4: RLS migration + owner runbook

**Files:**
- Modify: `orchestrator/db/pg/schema.ts` (RLS migration)
- Create: `docs/runbooks/supabase-data-plane.md`

**Interfaces:** none (DDL + docs).

**Note:** RLS ships as an orchestrator-run pg migration (the sync role owns the tables, so it can enable RLS + create policies — `anon`/`authenticated` are Supabase built-in roles present in every Supabase project). This means no manual SQL step; the owner's only manual action is creating the auth user. The migration must be idempotent.

- [ ] **Step 1: Add the RLS migration**

In `orchestrator/db/pg/schema.ts`, add a migration whose `up` enables RLS and creates an `authenticated`-SELECT policy on each client-readable table. Use a `DO`/`DROP POLICY IF EXISTS` guard for idempotency (pre-PG15-safe):

```sql
-- for each of: projects, epics, tasks, worklogs, contracts, days_off
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_authenticated ON projects;
CREATE POLICY read_authenticated ON projects FOR SELECT TO authenticated USING (true);
-- (repeat the three statements for epics, tasks, worklogs, contracts, days_off)
```

Append it as the `up` of a new migration entry in the `migrations` array. Do **not** add INSERT/UPDATE/DELETE policies (sub-project 3). `sync_conflicts` is internal — leave RLS off (the client never reads it).

- [ ] **Step 2: Verify the orchestrator typechecks + migration list parses**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/supabase-dataplane && npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: clean. (The migration runs against Supabase on next orchestrator boot; applying it live is owner-validated via Step 3's runbook.)

- [ ] **Step 3: Write the runbook**

Create `docs/runbooks/supabase-data-plane.md`:

```markdown
# Supabase data plane — owner setup + smoke check (iPad billing #1)

The orchestrator syncs TimeTracker data to Supabase and pre-computes billing
fields onto worklog rows. RLS is applied automatically by the orchestrator's
Postgres migrations. Your only manual step is creating the login user; then a
curl smoke check confirms auth + RLS + the derived fields end-to-end.

## 1. Create the auth user (once)
Supabase dashboard → Authentication → Users → **Add user** → your email + a
password. (This is the login the iPad will use in sub-project 2.)

## 2. Confirm the derived fields synced
Open the orchestrator with `WATCHTOWER_PG_URL` set (it already is, in
`.env.development`). On boot it applies the billing-column + RLS migrations and
re-pushes worklogs once (backfill). Give it one sync cycle (~60s) or trigger a
TimeTracker edit.

## 3. Smoke check (auth + RLS + earned_amount), no app needed
Replace `<ANON>` and `<EMAIL>`/`<PASSWORD>`:

    # a) anon must be denied (RLS): expect [] or an RLS error, never rows
    curl -s "https://xggihnrvsmbzbkhsnuky.supabase.co/rest/v1/worklogs?select=earned_amount&limit=1" \
      -H "apikey: <ANON>"

    # b) log in → get an access token
    TOKEN=$(curl -s "https://xggihnrvsmbzbkhsnuky.supabase.co/auth/v1/token?grant_type=password" \
      -H "apikey: <ANON>" -H "Content-Type: application/json" \
      -d '{"email":"<EMAIL>","password":"<PASSWORD>"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

    # c) authenticated read → expect rows with earned_amount populated
    curl -s "https://xggihnrvsmbzbkhsnuky.supabase.co/rest/v1/worklogs?select=work_date,effective_minutes,earned_amount,rate_currency&limit=5" \
      -H "apikey: <ANON>" -H "Authorization: Bearer $TOKEN"

Success: (a) returns no rows; (c) returns worklogs with non-null `earned_amount`
for entries that have a contract.

## Notes
- The orchestrator's sync role bypasses RLS (it owns the tables) — enabling RLS
  does not affect the Mac-side sync.
- Write access from the client (logging time on the iPad) is **not** enabled
  yet — that's sub-project 3 (adds INSERT/UPDATE policies + an offline outbox).
```

- [ ] **Step 4: Commit**

```bash
git add orchestrator/db/pg/schema.ts docs/runbooks/supabase-data-plane.md
git commit -m "feat: RLS (authenticated-read) migration + Supabase data-plane runbook"
```

---

## Final verification (after all tasks)

- [ ] `cd /Users/jan/Projects/Watchtower/.claude/worktrees/supabase-dataplane && npm test` — full suite green (pure + derive + rebill pass; real-Postgres sync tests pass if `WATCHTOWER_PG_URL` reachable, else skip).
- [ ] `npx tsc -p orchestrator/tsconfig.json --noEmit` — orchestrator typecheck clean.
- [ ] Owner validation (human): create the auth user, let the orchestrator apply migrations + backfill, run the §3 curl smoke check — anon denied, authenticated reads worklogs with populated `earned_amount`.
