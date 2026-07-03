# Project Time Auto-Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically log active time from any managed Claude instance to its matching project — tagged task if the instance is tagged, otherwise a per-project catch-all — for projects that opt in via a toggle.

**Architecture:** A single orchestrator service (`AutoTimeLogger`) hangs off the existing hook-event path. On a managed instance's `SessionEnd`, it matches the instance's `cwd` to a project's `folder_path`, and if that project has `auto_track` enabled, computes capped-gap active minutes from the instance's stored `hook_events` and upserts one `source='watchtower-auto'` worklog per `(instance, work_date)`. Idempotent via the existing `(source, external_id)` unique index — re-fires recompute the same value.

**Tech Stack:** TypeScript, Node `utilityProcess` orchestrator, better-sqlite3 (prod) / node:sqlite (tests), vitest, React + MUI v5 renderer.

## Global Constraints

- **DB engine divergence:** ADD COLUMN with a *non-constant* default diverges between node:sqlite (tests) and better-sqlite3 (prod). New column MUST use a **constant** default. Use the existing `addColumnIfMissing(db, table, column, decl)` helper in `migrations.ts`.
- **Current migration version is 16.** The new migration is **version 17**.
- **Worklog `source`/`external_id` are immutable on update** (`worklogs.ts:250-252`); `minutes` and `task_id` ARE updatable. The upsert relies on this.
- **`(source, external_id)` unique index** is partial: `WHERE source IS NOT NULL AND deleted_at IS NULL` (`migrations.ts:311-312`). Auto rows always set both.
- **Billing derivation:** leave `reported_minutes = null` on auto rows — `computeWorklogBilling` uses `reportedMinutes ?? minutes` (`packages/shared/src/billing/worklogBilling.ts`), so a null reported value bills the actual minutes. Do NOT compute rounding in the service.
- **Never break the hook path:** all auto-logging work is wrapped so an exception can never propagate into the instance state machine.
- **Locale:** Czech UI, no i18n. Auto-worklog description is a fixed string `'Auto-tracked'`.
- **Repo/IPC boundary:** the renderer never reaches SQLite; the toggle rides the existing `projects:update` IPC. The service runs inside the orchestrator and writes through the worklogs repo directly (server-side, not via IPC) — this is allowed for orchestrator-internal logic.
- **Tests:** vitest with an in-memory `node:sqlite` DB + `runMigrations`. Keep the suite green (219+); add tests for new code.
- **Test harness boilerplate** (top of every new orchestrator test file):
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { createRequire } from 'node:module';
  import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  ```
- **Commit message trailer** (every commit): end with
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 1: `auto_track` column end-to-end (migration + projects repo + shared contract)

Adds the per-project opt-in flag across the data and wire layers so it round-trips through create/update and is visible in `ProjectRow` / `ProjectViewPayload`.

**Files:**
- Modify: `orchestrator/db/migrations.ts` (append version 17 to the `MIGRATIONS` array, after the version-16 entry at `:315-344`)
- Modify: `orchestrator/db/repositories/projects.ts` (`ProjectRow`, `ProjectInput`, `DbRow`, `toRow`, `LIST_SQL`, `create`, `update`)
- Modify: `packages/shared/src/ipcContract.ts` (`ProjectInputPayload:462`, `ProjectViewPayload:475`)
- Test: `tests/orchestrator/projectsAutoTrack.test.ts` (create)

**Interfaces:**
- Produces: `ProjectRow.autoTrack: boolean`; `ProjectInput.autoTrack?: boolean`; `ProjectInputPayload.autoTrack?: boolean`; `ProjectViewPayload.autoTrack: boolean`. Column `projects.auto_track INTEGER NOT NULL DEFAULT 0`.

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator/projectsAutoTrack.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

describe('projects.auto_track', () => {
  let sqlite: SqliteLike;
  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    sqlite = db as unknown as SqliteLike;
    runMigrations(sqlite);
  });

  it('defaults autoTrack to false', () => {
    const repo = new ProjectsRepo(sqlite);
    const p = repo.create({ name: 'Alpha' });
    expect(p.autoTrack).toBe(false);
  });

  it('round-trips autoTrack via create and update', () => {
    const repo = new ProjectsRepo(sqlite);
    const p = repo.create({ name: 'Beta', autoTrack: true });
    expect(p.autoTrack).toBe(true);
    const off = repo.update(p.id, { autoTrack: false });
    expect(off.autoTrack).toBe(false);
    const on = repo.update(p.id, { autoTrack: true });
    expect(on.autoTrack).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/projectsAutoTrack.test.ts`
Expected: FAIL — `autoTrack` is `undefined` (column and mapping don't exist yet).

- [ ] **Step 3: Add migration version 17**

In `orchestrator/db/migrations.ts`, append to the `MIGRATIONS` array (after the `version: 16` object, before the closing `]`):

```ts
  {
    version: 17,
    up: (db) => {
      // Per-project opt-in for automatic time logging from instance activity
      // (see docs/superpowers/specs/2026-07-03-project-time-autolog-design.md).
      // Constant default 0 — a non-constant ADD COLUMN default diverges between
      // node:sqlite (tests) and better-sqlite3 (prod); see memory
      // sqlite-add-column-engine-divergence.
      addColumnIfMissing(db, 'projects', 'auto_track', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
```

- [ ] **Step 4: Thread `autoTrack` through the projects repo**

In `orchestrator/db/repositories/projects.ts`:

Add to `ProjectRow` (after `description: string | null;`):
```ts
  /** Per-project opt-in: auto-log instance active time to this project. */
  autoTrack: boolean;
```
Add to `ProjectInput` (after `description?: string | null;`):
```ts
  autoTrack?: boolean;
```
Add to `DbRow` (after `description: string | null;`):
```ts
  auto_track: number;
```
Add to `toRow`'s returned object (after `description: r.description,`):
```ts
    autoTrack: r.auto_track === 1,
```
In `LIST_SQL`, add `p.auto_track` to the first SELECT column list — change:
```ts
    p.folder_path, p.jira_globs, p.jira_board_url, p.task_url_template, p.description, p.created_at,
```
to:
```ts
    p.folder_path, p.jira_globs, p.jira_board_url, p.task_url_template, p.description, p.auto_track, p.created_at,
```
In `create`, add the column to the INSERT. Change the column list `... task_url_template, description, sync_id, updated_at)` to include `auto_track`, add a placeholder, and pass the value. Replace the INSERT statement block with:
```ts
      const info = this.db
        .prepare(
          `INSERT INTO projects (name, color, archived, is_billable, kind, is_default, folder_path, jira_globs, jira_board_url, task_url_template, description, auto_track, sync_id, updated_at)
           VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name, color, isBillable, kind, isDefault,
          input.folderPath ?? null, globs, boardUrl, taskUrl, input.description ?? null,
          input.autoTrack ? 1 : 0,
          newSyncId(), nowIso(),
        ) as { lastInsertRowid: number | bigint };
```
In `update`, add a push for `auto_track` (after the `description` push at `:232`):
```ts
    if (input.autoTrack !== undefined) push('auto_track', input.autoTrack ? 1 : 0);
```

- [ ] **Step 5: Add `autoTrack` to the shared wire types**

In `packages/shared/src/ipcContract.ts`, add to `ProjectInputPayload` (after `description?: string | null;`):
```ts
  autoTrack?: boolean;
```
Add to `ProjectViewPayload` (after `description: string | null;`):
```ts
  autoTrack: boolean;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/projectsAutoTrack.test.ts`
Expected: PASS (3 assertions).

Then rebuild the shared composite and typecheck (the wire types are consumed by orchestrator + renderer):
Run: `npm run build -w @watchtower/shared && npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add orchestrator/db/migrations.ts orchestrator/db/repositories/projects.ts packages/shared/src/ipcContract.ts tests/orchestrator/projectsAutoTrack.test.ts
git commit -m "feat(timetracker): add per-project auto_track flag (migration 17 + repo + contract)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `WorklogsRepo.findByExternalId`

The upsert needs to find an existing auto worklog by `(source, external_id)`. The repo has no such lookup yet.

**Files:**
- Modify: `orchestrator/db/repositories/worklogs.ts` (add method to `WorklogsRepo`, after `get(id)` at `:205`)
- Test: `tests/orchestrator/worklogsFindByExternal.test.ts` (create)

**Interfaces:**
- Consumes: `WorklogsRepo` (`create`, `WorklogRow`), `ProjectsRepo`, `EpicsRepo`, `TasksRepo` from earlier tasks.
- Produces: `WorklogsRepo.findByExternalId(source: string, externalId: string): WorklogRow | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator/worklogsFindByExternal.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../orchestrator/db/repositories/worklogs.js';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function seedTask(sqlite: SqliteLike): number {
  const p = new ProjectsRepo(sqlite).create({ name: 'P' });
  const e = new EpicsRepo(sqlite).create({ projectId: p.id, name: 'E' });
  return new TasksRepo(sqlite).create({ epicId: e.id, number: 'T-1', title: 'Task' }).id;
}

describe('WorklogsRepo.findByExternalId', () => {
  let sqlite: SqliteLike;
  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    sqlite = db as unknown as SqliteLike;
    runMigrations(sqlite);
  });

  it('finds a row by (source, external_id) and returns null otherwise', () => {
    const taskId = seedTask(sqlite);
    const repo = new WorklogsRepo(sqlite);
    repo.create({
      taskId, workDate: '2026-07-03', minutes: 42,
      source: 'watchtower-auto', externalId: 'auto:inst-1:2026-07-03',
    });
    const found = repo.findByExternalId('watchtower-auto', 'auto:inst-1:2026-07-03');
    expect(found?.minutes).toBe(42);
    expect(repo.findByExternalId('watchtower-auto', 'auto:inst-1:2026-07-04')).toBeNull();
    expect(repo.findByExternalId('manual', 'auto:inst-1:2026-07-03')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/worklogsFindByExternal.test.ts`
Expected: FAIL — `findByExternalId` is not a function.

- [ ] **Step 3: Add the method**

In `orchestrator/db/repositories/worklogs.ts`, add to `WorklogsRepo` right after the `get(id)` method (`:205`):

```ts
  /** Look up a single non-deleted worklog by its (source, external_id) pair. */
  findByExternalId(source: string, externalId: string): WorklogRow | null {
    const row = this.db
      .prepare(
        SELECT_JOINED +
          ' WHERE w.source = ? AND w.external_id = ? AND w.deleted_at IS NULL LIMIT 1',
      )
      .get(source, externalId) as DbRow | undefined;
    return row ? toRow(row) : null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/worklogsFindByExternal.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/repositories/worklogs.ts tests/orchestrator/worklogsFindByExternal.test.ts
git commit -m "feat(timetracker): WorklogsRepo.findByExternalId for auto-log upsert

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `activeMinutesByDate` pure function

The capped-gap active-time calculation, isolated and pure for unit testing.

**Files:**
- Create: `orchestrator/services/autoTimeLogger.ts` (this task adds only the pure exports; Task 4 adds the class)
- Test: `tests/orchestrator/autoTimeLogger.test.ts` (create)

**Interfaces:**
- Produces:
  - `IDLE_CAP_MS: number` (= `10 * 60 * 1000`)
  - `localDateStr(ms: number): string` — local `YYYY-MM-DD`
  - `activeMinutesByDate(pings: number[], idleCapMs: number): Map<string, number>` — capped-gap minutes credited to the earlier ping's local date; rounds each date's total to whole minutes.

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator/autoTimeLogger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { activeMinutesByDate, localDateStr, IDLE_CAP_MS } from '../../orchestrator/services/autoTimeLogger.js';

const MIN = 60 * 1000;

describe('activeMinutesByDate', () => {
  it('returns empty for zero or one ping (no measurable duration)', () => {
    expect(activeMinutesByDate([], IDLE_CAP_MS).size).toBe(0);
    expect(activeMinutesByDate([Date.parse('2026-07-03T10:00:00')], IDLE_CAP_MS).size).toBe(0);
  });

  it('sums sub-cap gaps within a day', () => {
    const t = Date.parse('2026-07-03T10:00:00');
    const pings = [t, t + 3 * MIN, t + 8 * MIN]; // 3 + 5 = 8 min
    const m = activeMinutesByDate(pings, IDLE_CAP_MS);
    expect(m.get('2026-07-03')).toBe(8);
  });

  it('caps a long idle gap at the idle cap', () => {
    const t = Date.parse('2026-07-03T10:00:00');
    const pings = [t, t + 60 * MIN]; // 60-min gap → capped at 10
    expect(activeMinutesByDate(pings, IDLE_CAP_MS).get('2026-07-03')).toBe(10);
  });

  it('splits across midnight, crediting each gap to the earlier ping day', () => {
    const late = Date.parse('2026-07-03T23:58:00');
    const early = Date.parse('2026-07-04T00:03:00'); // 5-min gap, spans midnight
    const next = early + 4 * MIN; // +4 min on the 4th
    const m = activeMinutesByDate([late, early, next], IDLE_CAP_MS);
    expect(m.get('2026-07-03')).toBe(5); // credited to the 3rd (earlier ping)
    expect(m.get('2026-07-04')).toBe(4);
  });

  it('is order-independent', () => {
    const t = Date.parse('2026-07-03T10:00:00');
    const m = activeMinutesByDate([t + 8 * MIN, t, t + 3 * MIN], IDLE_CAP_MS);
    expect(m.get('2026-07-03')).toBe(8);
  });

  it('localDateStr formats local YYYY-MM-DD', () => {
    expect(localDateStr(Date.parse('2026-07-03T10:00:00'))).toBe('2026-07-03');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/autoTimeLogger.test.ts`
Expected: FAIL — cannot import from a non-existent module.

- [ ] **Step 3: Create the file with the pure exports**

Create `orchestrator/services/autoTimeLogger.ts`:

```ts
/** Gaps between consecutive activity pings longer than this count as idle. */
export const IDLE_CAP_MS = 10 * 60 * 1000;

/** Local YYYY-MM-DD for an epoch-ms timestamp. */
export function localDateStr(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Capped-gap active minutes grouped by local work date. For each consecutive
 * pair of pings the elapsed time (capped at idleCapMs) is credited to the
 * local date of the EARLIER ping. A lone ping has no measurable duration → 0.
 * A gap that straddles midnight is credited whole to the earlier day; since
 * gaps are capped at idleCapMs (10 min) the misattribution is bounded and
 * accepted (see the design's edge-cases section).
 */
export function activeMinutesByDate(
  pings: number[],
  idleCapMs: number,
): Map<string, number> {
  const sorted = [...pings].sort((a, b) => a - b);
  const msByDate = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.min(sorted[i]! - sorted[i - 1]!, idleCapMs);
    if (gap <= 0) continue;
    const date = localDateStr(sorted[i - 1]!);
    msByDate.set(date, (msByDate.get(date) ?? 0) + gap);
  }
  const minutesByDate = new Map<string, number>();
  for (const [date, ms] of msByDate) {
    minutesByDate.set(date, Math.round(ms / 60000));
  }
  return minutesByDate;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/autoTimeLogger.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/autoTimeLogger.ts tests/orchestrator/autoTimeLogger.test.ts
git commit -m "feat(timetracker): activeMinutesByDate capped-gap active-time calc

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `AutoTimeLogger` service (catch-all resolution + upsert)

The orchestration: match project by cwd, gate on `auto_track`, resolve task, compute minutes, upsert one worklog per `(instance, work_date)`. Idempotent and never throws.

**Files:**
- Modify: `orchestrator/services/autoTimeLogger.ts` (add imports + the `AutoTimeLogger` class + `expandHome`)
- Test: `tests/orchestrator/autoTimeLogger.service.test.ts` (create)

**Interfaces:**
- Consumes: `activeMinutesByDate`, `IDLE_CAP_MS` (Task 3); `ProjectsRepo` + `ProjectRow.autoTrack` (Task 1); `WorklogsRepo.findByExternalId` (Task 2); `EpicsRepo.create`/`listForProject`, `TasksRepo.get`/`create`/`listForEpic`, `HookEventsRepo.listForInstance`, `InstanceRow` (existing).
- Produces: `class AutoTimeLogger { constructor(db: SqliteLike, onChange?: () => void); onSessionEnd(instance: InstanceRow): void }` — `onSessionEnd` is best-effort (swallows all errors). External id format: `auto:<instance.id>:<work_date>`; source `'watchtower-auto'`; description `'Auto-tracked'`; `reported_minutes = null`.

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator/autoTimeLogger.service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';
import { WorklogsRepo } from '../../orchestrator/db/repositories/worklogs.js';
import { HookEventsRepo } from '../../orchestrator/db/repositories/hookEvents.js';
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';
import { AutoTimeLogger } from '../../orchestrator/services/autoTimeLogger.js';
import type { InstanceRow } from '@watchtower/shared/stateModel.js';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const MIN = 60 * 1000;
const T = Date.parse('2026-07-03T10:00:00');

function makeInstance(over: Partial<InstanceRow> = {}): InstanceRow {
  return {
    id: 'inst-1', cwd: '/work/alpha', status: 'finished',
    claudeSessionId: null, spawnedAt: T, lastActivityAt: T, exitCode: 0,
    terminationReason: 'session-end', resumedFromInstanceId: null,
    jiraKeyHint: null, argsJson: null, kind: 'claude', taskId: null, ...over,
  };
}

function seedProject(sqlite: SqliteLike, autoTrack: boolean): number {
  return new ProjectsRepo(sqlite).create({ name: 'Alpha', folderPath: '/work/alpha', autoTrack }).id;
}

function seedPings(sqlite: SqliteLike, instanceId: string) {
  const h = new HookEventsRepo(sqlite);
  h.append(instanceId, 'SessionStart', {}, T);
  h.append(instanceId, 'UserPromptSubmit', {}, T + 5 * MIN);
  h.append(instanceId, 'SessionEnd', {}, T + 8 * MIN); // 5 + 3 = 8 min
}

describe('AutoTimeLogger.onSessionEnd', () => {
  let sqlite: SqliteLike;
  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    sqlite = db as unknown as SqliteLike;
    runMigrations(sqlite);
  });

  it('does nothing when the project is not auto-tracked', () => {
    seedProject(sqlite, false);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    expect(new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' })).toHaveLength(0);
  });

  it('does nothing when the cwd matches no project', () => {
    seedProject(sqlite, true);
    const inst = makeInstance({ cwd: '/work/unknown' });
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    expect(new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' })).toHaveLength(0);
  });

  it('logs to the per-project catch-all task when untagged', () => {
    seedProject(sqlite, true);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    const rows = new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.minutes).toBe(8);
    expect(rows[0]!.workDate).toBe('2026-07-03');
    expect(rows[0]!.taskNumber).toBe('AUTO');
    expect(rows[0]!.epicName).toBe('Auto-tracked');
    expect(rows[0]!.externalId).toBe('auto:inst-1:2026-07-03');
    expect(rows[0]!.reportedMinutes).toBeNull();
  });

  it('logs to the instance tagged task when set', () => {
    const pid = seedProject(sqlite, true);
    const e = new EpicsRepo(sqlite).create({ projectId: pid, name: 'Feature' });
    const t = new TasksRepo(sqlite).create({ epicId: e.id, number: 'F-1', title: 'Do it' });
    const inst = makeInstance({ taskId: t.id });
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    new AutoTimeLogger(sqlite).onSessionEnd(inst);
    const rows = new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskId).toBe(t.id);
  });

  it('is idempotent — a re-fire updates in place, no duplicate row', () => {
    seedProject(sqlite, true);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    const logger = new AutoTimeLogger(sqlite);
    logger.onSessionEnd(inst);
    logger.onSessionEnd(inst);
    const rows = new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.minutes).toBe(8);
  });

  it('accrues more minutes when new activity arrives before a later SessionEnd', () => {
    seedProject(sqlite, true);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    const logger = new AutoTimeLogger(sqlite);
    logger.onSessionEnd(inst);
    // A new /clear'd session on the same instance adds 4 more minutes.
    const h = new HookEventsRepo(sqlite);
    h.append(inst.id, 'SessionStart', {}, T + 20 * MIN);
    h.append(inst.id, 'SessionEnd', {}, T + 24 * MIN);
    logger.onSessionEnd(inst);
    const rows = new WorklogsRepo(sqlite).list({ source: 'watchtower-auto' });
    expect(rows).toHaveLength(1);
    // 8 (first) + capped(20→cap 10) + 4 = 8 + 10 + 4 = 22
    expect(rows[0]!.minutes).toBe(22);
  });

  it('calls onChange when it writes', () => {
    seedProject(sqlite, true);
    const inst = makeInstance();
    new InstancesRepo(sqlite).insert(inst);
    seedPings(sqlite, inst.id);
    let changed = 0;
    new AutoTimeLogger(sqlite, () => { changed++; }).onSessionEnd(inst);
    expect(changed).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/autoTimeLogger.service.test.ts`
Expected: FAIL — `AutoTimeLogger` is not exported.

- [ ] **Step 3: Add the class to `autoTimeLogger.ts`**

At the TOP of `orchestrator/services/autoTimeLogger.ts`, add imports:

```ts
import { homedir } from 'node:os';
import path from 'node:path';
import type { SqliteLike } from '../db/migrations.js';
import type { InstanceRow } from '@watchtower/shared/stateModel.js';
import { ProjectsRepo } from '../db/repositories/projects.js';
import { EpicsRepo } from '../db/repositories/epics.js';
import { TasksRepo } from '../db/repositories/tasks.js';
import { WorklogsRepo } from '../db/repositories/worklogs.js';
import { HookEventsRepo } from '../db/repositories/hookEvents.js';
```

At the BOTTOM of the same file (after the pure functions), add:

```ts
const AUTO_SOURCE = 'watchtower-auto';
const AUTO_EPIC_NAME = 'Auto-tracked';
const AUTO_TASK_NUMBER = 'AUTO';
const AUTO_TASK_TITLE = 'General';

/** Expand a leading `~` in a stored folder_path to the user's home dir. */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  return p;
}

/**
 * Turns a managed instance's SessionEnd into a worklog against its project.
 * Best-effort: any failure is swallowed so it can never break the hook path.
 */
export class AutoTimeLogger {
  private projects: ProjectsRepo;
  private epics: EpicsRepo;
  private tasks: TasksRepo;
  private worklogs: WorklogsRepo;
  private hookEvents: HookEventsRepo;

  constructor(
    db: SqliteLike,
    private onChange?: () => void,
  ) {
    // Construct repos in the body (not as field initializers) so `db` is
    // already bound — parameter properties assign after field initializers.
    this.projects = new ProjectsRepo(db);
    this.epics = new EpicsRepo(db);
    this.tasks = new TasksRepo(db);
    this.worklogs = new WorklogsRepo(db);
    this.hookEvents = new HookEventsRepo(db);
  }

  onSessionEnd(instance: InstanceRow): void {
    try {
      this.run(instance);
    } catch {
      /* auto-logging is best-effort — never propagate into the hook path */
    }
  }

  private run(instance: InstanceRow): void {
    const project = this.projects
      .list({ archived: false })
      .find((p) => p.folderPath != null && expandHome(p.folderPath) === instance.cwd);
    if (!project || !project.autoTrack) return;

    const taskId = this.resolveTask(instance.taskId, project.id);
    const pings = this.hookEvents.listForInstance(instance.id).map((e) => e.receivedAt);
    const minutesByDate = activeMinutesByDate(pings, IDLE_CAP_MS);

    let wrote = false;
    for (const [workDate, minutes] of minutesByDate) {
      if (minutes < 1) continue;
      const externalId = `auto:${instance.id}:${workDate}`;
      try {
        const existing = this.worklogs.findByExternalId(AUTO_SOURCE, externalId);
        if (existing) {
          if (existing.minutes !== minutes || existing.taskId !== taskId) {
            this.worklogs.update(existing.id, { minutes, taskId });
            wrote = true;
          }
        } else {
          this.worklogs.create({
            taskId,
            workDate,
            minutes,
            reportedMinutes: null,
            source: AUTO_SOURCE,
            externalId,
            description: 'Auto-tracked',
          });
          wrote = true;
        }
      } catch {
        /* locked billing window or done-task race — skip this date */
      }
    }
    if (wrote) this.onChange?.();
  }

  /** The instance's tagged task if it exists and isn't done, else the catch-all. */
  private resolveTask(taggedTaskId: number | null, projectId: number): number {
    if (taggedTaskId != null) {
      const t = this.tasks.get(taggedTaskId);
      if (t && t.status !== 'done') return t.id;
    }
    return this.catchAllTaskId(projectId);
  }

  /** Find-or-create the project's "Auto-tracked" epic → "AUTO" task. */
  private catchAllTaskId(projectId: number): number {
    const epic =
      this.epics.listForProject(projectId).find((e) => e.name === AUTO_EPIC_NAME) ??
      this.epics.create({ projectId, name: AUTO_EPIC_NAME, status: 'active' });
    const task =
      this.tasks.listForEpic(epic.id).find((t) => t.number === AUTO_TASK_NUMBER) ??
      this.tasks.create({ epicId: epic.id, number: AUTO_TASK_NUMBER, title: AUTO_TASK_TITLE });
    return task.id;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/autoTimeLogger.service.test.ts`
Expected: PASS (7 assertions).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/autoTimeLogger.ts tests/orchestrator/autoTimeLogger.service.test.ts
git commit -m "feat(timetracker): AutoTimeLogger service — cwd match, task resolve, upsert

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire `AutoTimeLogger` into the hook-event path

Fire the service on `SessionEnd` for managed instances, using the instance row already fetched in `onHookEvent`.

**Files:**
- Modify: `orchestrator/index.ts` (import, factory near `:223`, call in the `onHookEvent` closure at `:1098-1112`)

**Interfaces:**
- Consumes: `AutoTimeLogger` (Task 4), the existing `notifySync()` (`:177`), the `row: InstanceRow` fetched at `:1104`.

There is no isolated unit test for this glue (it lives inside the `bootstrap`/`parentPort` wiring); the service logic is covered by Task 4. Verification is typecheck + build + a manual smoke.

- [ ] **Step 1: Add the import**

Near the other repository/service imports at the top of `orchestrator/index.ts`, add:

```ts
import { AutoTimeLogger } from './services/autoTimeLogger.js';
```

- [ ] **Step 2: Add the factory**

After the `worklogsRepo()` factory (`:223-225`), add:

```ts
function autoTimeLogger(): AutoTimeLogger {
  return new AutoTimeLogger(handle!.db, notifySync);
}
```

- [ ] **Step 3: Call it on SessionEnd**

In the `onHookEvent` closure, after the existing `if (stateEvent) applyTransition(instanceId, stateEvent);` line (`:1111`), add:

```ts
        // Auto-log this instance's active time to its project on session end
        // (no-op unless the matched project has auto_track enabled). Best-effort:
        // the service swallows its own errors so a logging failure can't break
        // the state machine.
        if (eventName === 'SessionEnd') autoTimeLogger().onSessionEnd(row);
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npm test`
Expected: no type errors; full vitest suite green (previous count + the new auto-log tests).

- [ ] **Step 5: Manual smoke (document result)**

Run `npm run dev`, register a project whose folder is a repo you can run Claude in, enable its Auto-track toggle (Task 6 — do this step after Task 6 if toggling isn't available yet, or set `auto_track=1` directly for the smoke), open a managed instance there, submit a couple of prompts, then `/clear` (fires SessionEnd). Confirm a `watchtower-auto` worklog appears under that project's "Auto-tracked → AUTO" task (or the tagged task) in the TimeTracker worklog list, and that `/clear`-ing again does not duplicate it.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(timetracker): fire AutoTimeLogger on managed-instance SessionEnd

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: "Auto-track time" toggle in ProjectDrawer

Expose the opt-in in the project create/edit drawer.

**Files:**
- Modify: `apps/desktop/src/components/timetracker/ProjectDrawer.tsx` (`DraftState:44`, `emptyDraft:55`, `draftOf:69`, the form body near the "Default project" checkbox `:160`, `toInput:365`)

**Interfaces:**
- Consumes: `ProjectInputPayload.autoTrack` + `ProjectViewPayload.autoTrack` (Task 1).

No automated UI test (the drawer has no RTL harness in this repo). Verification is typecheck + the manual smoke from Task 5.

- [ ] **Step 1: Add the draft field**

In `DraftState` (after `folderPath: string;` at `:48`), add:
```ts
  autoTrack: boolean;
```
In `emptyDraft()` (after `folderPath: '',` at `:61`), add:
```ts
    autoTrack: false,
```
In `draftOf()` (after `folderPath: project.folderPath ?? '',` at `:76`), add:
```ts
    autoTrack: project.autoTrack,
```

- [ ] **Step 2: Add the checkbox to the form**

Immediately after the "Default project" `FormControlLabel` block (`:160-169`), add:

```tsx
          <FormControlLabel
            control={
              <Checkbox
                checked={draft.autoTrack}
                onChange={(e) => setDraft({ ...draft, autoTrack: e.target.checked })}
              />
            }
            label="Auto-track time"
            sx={{ mr: 0 }}
          />
```

- [ ] **Step 3: Pass it through `toInput`**

In `toInput()` (`:365`), add `autoTrack` to the returned object (after the `folderPath:` line at `:371`):
```ts
    autoTrack: draft.autoTrack,
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: no NEW errors (ignore the pre-existing drift noted in CLAUDE.md: `dev/` rootDir, MUI v6 slotProps, `useInstances.spawn`).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/timetracker/ProjectDrawer.tsx
git commit -m "feat(timetracker): Auto-track time toggle in the project drawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Coexistence note (operational, not code)

`green code` / `fitness platform` already auto-log via the per-repo private scripts (`source='claude'`). Those do NOT dedupe against `source='watchtower-auto'`. When enabling the toggle for such a project, retire that repo's `.claude/hooks/autolog-time.sh` (and its `.claude/private/` clock flow) to avoid double-billing. The Watchtower project's own dev-time flow stays on the private clock — simply leave its toggle off.

## Final verification

- [ ] `npm test` — full suite green (prior count + `projectsAutoTrack` (2) + `worklogsFindByExternal` (1) + `autoTimeLogger` (6) + `autoTimeLogger.service` (7) new tests).
- [ ] `npx tsc -p orchestrator/tsconfig.json --noEmit` — clean.
- [ ] `npx tsc -p client/tsconfig.json --noEmit` — no new errors.
- [ ] Manual smoke from Task 5 Step 5 confirmed.
