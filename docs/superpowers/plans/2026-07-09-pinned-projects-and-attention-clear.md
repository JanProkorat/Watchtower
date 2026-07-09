# Pinned Projects + Attention-Dot Clear-on-Interaction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "default project" flag with a multi-select "pinned" flag that preselects projects in the task-grid *and* dashboard filters, and fix the Instances red attention-dot so it clears when interacting with an already-focused terminal.

**Architecture:** Part A renames `is_default`/`isDefault` → `is_pinned`/`isPinned` end-to-end (SQLite + Postgres + sync registry + TS types + UI) and drops the one-default invariant, then converts the dashboard from single- to multi-select (mirroring the task-grid's existing `projectIds[]` pattern). Part B re-emits the existing `focusChanged` IPC on click/keystroke into a terminal that currently needs attention — reusing the orchestrator's `tabFocused → clearAttention` transition, no new IPC.

**Tech Stack:** Electron + Node orchestrator (utilityProcess), better-sqlite3 (prod) / node:sqlite (tests), Postgres (sync backend), React + MUI v5 + xterm.js renderer, vitest.

## Global Constraints

- Locale is Czech; **do NOT add i18n**. UI control labels in this codebase are English ("All projects", "Project", "Projects") while inline error copy is Czech — keep that convention; "Pinned" is an English control label.
- `npm test` must stay green (currently 1026+ tests); if a task adds code, add tests.
- `npx tsc -p orchestrator/tsconfig.json --noEmit` and `npx tsc -p client/tsconfig.json --noEmit` must pass; CI runs `typecheck:ci` + `npm test` across all workspaces.
- Migration versions are append-only. Next **SQLite** migration = **v19** (current max is v18 in `orchestrator/db/migrations.ts`). Next **Postgres** migration = **v11** (current max is v10 in `orchestrator/db/pg/schema.ts` `PG_MIGRATIONS`).
- Do NOT edit the historical create-DDL for `is_default` (`timetracker_schema.sql`, the PG `PROJECTS` constant): fresh installs run the full migration chain, so v3-creates-then-v19-renames yields the correct end state — matching how `project_rates→contracts` was handled in v13.
- Never bypass pre-commit hooks / signing.
- Delivery: **one branch, two commits** — Part A, then Part B. Tasks commit individually as resume points; the final task regroups them into exactly two commits (Part A files and Part B files are disjoint).

---

## PART A — Pinned projects

### Task 1: SQLite migration v19 — drop the one-default index, rename the column

**Files:**
- Modify: `orchestrator/db/migrations.ts` (append to the `MIGRATIONS` array, after the `version: 18` entry at ~line 364)
- Test: `tests/orchestrator/migrations.test.ts`

**Interfaces:**
- Produces: SQLite `projects.is_pinned` column (INTEGER 0/1), no `idx_projects_is_default` index, no single-default constraint.

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator/migrations.test.ts` (follow the file's existing pattern for building a migrated in-memory db; it already imports `runMigrations` and a sqlite factory):

```ts
it('v19 renames is_default → is_pinned and allows multiple pinned projects', () => {
  const db = newDb();          // same helper the other tests in this file use
  runMigrations(db);

  const cols = (db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>).map((c) => c.name);
  expect(cols).toContain('is_pinned');
  expect(cols).not.toContain('is_default');

  // The partial-unique index is gone: two pinned projects can coexist.
  db.exec(`INSERT INTO projects (name, sync_id, updated_at, is_pinned) VALUES ('A', 'sa', '2026-01-01T00:00:00.000Z', 1)`);
  db.exec(`INSERT INTO projects (name, sync_id, updated_at, is_pinned) VALUES ('B', 'sb', '2026-01-01T00:00:00.000Z', 1)`);
  const n = db.prepare(`SELECT COUNT(*) AS c FROM projects WHERE is_pinned = 1`).get() as { c: number };
  expect(n.c).toBe(2);
});
```

If the test file uses a different db-construction helper name, match it (grep the top of the file). Do not invent a helper.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/migrations.test.ts -t "v19 renames"`
Expected: FAIL — column `is_pinned` missing / `is_default` still present.

- [ ] **Step 3: Implement migration v19**

Append this entry to the `MIGRATIONS` array in `orchestrator/db/migrations.ts` (immediately after the `version: 18` object, before the closing `];`):

```ts
  {
    version: 19,
    up: (db) => {
      // "Pinned" projects: the former single-"default" flag becomes a
      // multi-select preselection for the task-grid + dashboard filters.
      // Drop the partial-unique index that enforced at-most-one default, then
      // rename the column. RENAME COLUMN has no IF EXISTS, so guard on the old
      // column still being present (replay-safe; a fresh install that already
      // has is_pinned is a no-op). The column-level CHECK (is_default IN (0,1))
      // travels with the rename and becomes CHECK (is_pinned IN (0,1)).
      db.exec(`DROP INDEX IF EXISTS idx_projects_is_default`);
      const cols = (db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>).map((c) => c.name);
      if (cols.includes('is_default') && !cols.includes('is_pinned')) {
        db.exec(`ALTER TABLE projects RENAME COLUMN is_default TO is_pinned`);
      }
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/migrations.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/migrations.ts tests/orchestrator/migrations.test.ts
git commit -m "feat(db): migration v19 — rename is_default→is_pinned, allow multiple pinned"
```

---

### Task 2: Rename to `isPinned` + drop the single-default invariant (repo, shared types, all renderer consumers)

This is one atomic task: the shared `ProjectViewPayload.isDefault`/`ProjectInputPayload.isDefault` fields are referenced across the repo and renderer, so they must all rename together to keep the build green. It also removes `clearDefault()` (the invariant) and switches the task-grid seed from "first default" to "all pinned".

**Files:**
- Modify: `orchestrator/db/repositories/projects.ts`
- Modify: `packages/shared/src/ipcContract.ts` (`ProjectViewPayload`, `ProjectInputPayload`)
- Modify: `packages/shared/src/messagePort.ts` (`OrchProjectView` line 432, `OrchProjectInput` line 420)
- Modify: `apps/desktop/src/components/timetracker/ProjectDrawer.tsx`
- Modify: `apps/desktop/src/components/timetracker/ProjectDetailPane.tsx`
- Modify: `apps/desktop/src/components/timetracker/ProjectsPage.tsx` (line 56)
- Modify: `apps/desktop/src/components/timetracker/ProjectsSidebar.tsx` (line 164)
- Modify: `apps/desktop/src/components/timetracker/ReportsTab.tsx` (lines 107, 249)
- Modify: `apps/desktop/src/components/timetracker/TaskGridView.tsx` (lines 182–196)
- Modify: `apps/desktop/src/components/dashboard/ModuleDashboard.tsx` (line 93 — mechanical rename only; dashboard rework is A4/A5)
- Test: `tests/orchestrator/projects-repo.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProjectRow.isPinned: boolean`, `ProjectInput.isPinned?: boolean`, `ProjectViewPayload.isPinned: boolean`, `ProjectInputPayload.isPinned?: boolean`. Repo `create`/`update` set multiple pins independently (no clearing). `archive` still forces `is_pinned = 0`.

- [ ] **Step 1: Write the failing repo test**

Add to `tests/orchestrator/projects-repo.test.ts` (match the file's existing setup for building a `ProjectsRepo` over a migrated db):

```ts
it('allows multiple pinned projects and does not clear others', () => {
  const a = repo.create({ name: 'A', isPinned: true });
  const b = repo.create({ name: 'B', isPinned: true });
  expect(repo.get(a.id)!.isPinned).toBe(true);
  expect(repo.get(b.id)!.isPinned).toBe(true);

  const c = repo.update(a.id, { isPinned: false });
  expect(c.isPinned).toBe(false);
  expect(repo.get(b.id)!.isPinned).toBe(true); // unaffected
});

it('unpins on archive', () => {
  const a = repo.create({ name: 'A', isPinned: true });
  repo.archive(a.id, true);
  expect(repo.get(a.id)!.isPinned).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/projects-repo.test.ts -t "multiple pinned"`
Expected: FAIL — `isPinned` unknown (still `isDefault`) / compile error.

- [ ] **Step 3: Rename + de-invariant the repo**

In `orchestrator/db/repositories/projects.ts`:

- `ProjectRow` (line 12): `isDefault: boolean;` → `isPinned: boolean;`
- `ProjectInput` (line 32): `isDefault?: boolean;` → `isPinned?: boolean;`
- `DbRow` (line 54): `is_default: number;` → `is_pinned: number;`
- `toRow` (line 109): `isDefault: r.is_default === 1,` → `isPinned: r.is_pinned === 1,`
- `LIST_SQL` (line 133): `p.archived, p.kind, p.is_default,` → `p.archived, p.kind, p.is_pinned,`
- `list` ORDER BY (line 169): `ORDER BY p.is_default DESC, ...` → `ORDER BY p.is_pinned DESC, ...`

Replace `create` (lines 179–212) with a version that drops the transaction + `clearDefault`:

```ts
  create(input: ProjectInput): ProjectRow {
    const color = input.color ?? DEFAULTS.color;
    const kind = input.kind ?? DEFAULTS.kind;
    const isPinned = input.isPinned ? 1 : 0;
    const isBillable = kind === 'work' ? 1 : 0;
    const globs = input.jiraGlobs ? JSON.stringify(input.jiraGlobs) : null;
    const boardUrl = normaliseBoardUrl(input.jiraBoardUrl);
    const taskUrl = normaliseTaskUrlTemplate(input.taskUrlTemplate);

    const info = this.db
      .prepare(
        `INSERT INTO projects (name, color, archived, is_billable, kind, is_pinned, folder_path, jira_globs, jira_board_url, task_url_template, description, auto_track, sync_id, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name, color, isBillable, kind, isPinned,
        input.folderPath ?? null, globs, boardUrl, taskUrl, input.description ?? null,
        input.autoTrack ? 1 : 0,
        newSyncId(), nowIso(),
      ) as { lastInsertRowid: number | bigint };
    const id = Number(info.lastInsertRowid);
    return this.get(id)!;
  }
```

In `update` (lines 214–268), replace the `if (input.isDefault !== undefined) { ...transaction... } else { ... }` block (lines 241–263) with a plain push — no transaction, no clearDefault:

```ts
    if (input.isPinned !== undefined) push('is_pinned', input.isPinned ? 1 : 0);

    push('updated_at', nowIso());
    params.push(id);
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
```

In `archive` (line 273): `SET archived = 1, is_default = 0, updated_at = ?` → `SET archived = 1, is_pinned = 0, updated_at = ?`.

Delete the `clearDefault()` helper entirely (lines 310–313).

- [ ] **Step 4: Rename the shared types**

- `packages/shared/src/ipcContract.ts`: `ProjectViewPayload.isDefault: boolean;` → `isPinned: boolean;`; `ProjectInputPayload.isDefault?: boolean;` → `isPinned?: boolean;`
- `packages/shared/src/messagePort.ts`: line 420 `isDefault?: boolean;` → `isPinned?: boolean;`; line 432 `isDefault: boolean;` → `isPinned: boolean;`

- [ ] **Step 5: Rename + relabel the renderer consumers**

- `ProjectDrawer.tsx`: `DraftState.isDefault` (line 51) → `isPinned`; init `isDefault: false` (line 65) → `isPinned: false`; init `isDefault: project.isDefault` (line 81) → `isPinned: project.isPinned`; checkbox `checked={draft.isDefault}` / `onChange ... isDefault: e.target.checked` (lines 170–171) → `isPinned`; `label="Default project"` (line 174) → `label="Pinned"`; `toInput` `isDefault: draft.isDefault` (line 446) → `isPinned: draft.isPinned`.
- `ProjectDetailPane.tsx`: `toggleDefault` body (line 122) `state.update({ isDefault: !project.isDefault })` → `state.update({ isPinned: !project.isPinned })` (rename the function to `togglePinned` and its call site at line 234); tooltip (line 233) `project.isDefault ? 'Default project' : 'Make default'` → `project.isPinned ? 'Pinned' : 'Pin project'`; the two `project.isDefault ?` icon checks (lines 235, and the toggle icon) → `project.isPinned ?`.
- `ProjectsPage.tsx` line 56: `.find((p) => p.isDefault)?.id` → `.find((p) => p.isPinned)?.id`.
- `ProjectsSidebar.tsx` line 164: `{project.isDefault ? (` → `{project.isPinned ? (`.
- `ReportsTab.tsx` line 107: `.find((p) => p.isDefault)` → `.find((p) => p.isPinned)`; line 249: `{p.isDefault ? ' (default)' : ''}` → `{p.isPinned ? ' (pinned)' : ''}`.
- `ModuleDashboard.tsx` line 93: `.find((p) => p.isDefault)` → `.find((p) => p.isPinned)` (mechanical only — surrounding single-select logic untouched here).

- [ ] **Step 6: Task-grid — seed ALL pinned instead of the first default**

In `TaskGridView.tsx`, replace the seed block (lines 191–195) inside the `projects:list` `.then`:

```ts
      if (projectId === undefined && !initialProjectSelectionDoneRef.current) {
        initialProjectSelectionDoneRef.current = true;
        const pinned = r.projects.filter((p) => p.isPinned).map((p) => p.id);
        if (pinned.length > 0) setProjectFilters(pinned);
      }
```

Also update the stale comment at lines 182–186 to say "snaps the filter to every project marked is_pinned = 1".

- [ ] **Step 7: Run tests + typecheck**

Run:
```bash
npx vitest run tests/orchestrator/projects-repo.test.ts
npx tsc -p orchestrator/tsconfig.json --noEmit
npx tsc -p client/tsconfig.json --noEmit
```
Expected: repo tests PASS; both typechecks clean (pre-existing client drift noted in CLAUDE.md is acceptable — do not fix it; just confirm no NEW `isDefault`/`isPinned` errors).

- [ ] **Step 8: Commit**

```bash
git add orchestrator/db/repositories/projects.ts packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts apps/desktop/src/components/timetracker/ProjectDrawer.tsx apps/desktop/src/components/timetracker/ProjectDetailPane.tsx apps/desktop/src/components/timetracker/ProjectsPage.tsx apps/desktop/src/components/timetracker/ProjectsSidebar.tsx apps/desktop/src/components/timetracker/ReportsTab.tsx apps/desktop/src/components/timetracker/TaskGridView.tsx apps/desktop/src/components/dashboard/ModuleDashboard.tsx tests/orchestrator/projects-repo.test.ts
git commit -m "feat(projects): rename default→pinned, allow multiple, seed all pinned in task grid"
```

---

### Task 3: Postgres migration v11 + sync registry + legacy importer

**Files:**
- Modify: `orchestrator/db/pg/schema.ts` (append `PG_MIGRATIONS` version 11, after the `version: 10` entry)
- Modify: `orchestrator/sync/schema.ts` (line 82)
- Modify: `orchestrator/db/migrateTimetracker.ts` (line 77)
- Test: `tests/orchestrator/sync/schema.test.ts`

**Interfaces:**
- Produces: Postgres `projects.is_pinned` column, no `idx_projects_is_default`, and a sync registry that reads/writes `is_pinned`.

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator/sync/schema.test.ts` (this file imports the synced-table registry — match its existing import name for the tables array):

```ts
it('projects sync registry uses is_pinned, not is_default', () => {
  const projects = SYNCED_TABLES.find((t) => t.name === 'projects')!;
  const names = projects.columns.map((c) => c.name);
  expect(names).toContain('is_pinned');
  expect(names).not.toContain('is_default');
});
```

If the exported constant is not named `SYNCED_TABLES`, use whatever the file already imports (grep the test file's existing imports).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/sync/schema.test.ts -t "is_pinned"`
Expected: FAIL — registry still has `is_default`.

- [ ] **Step 3: Update the sync registry**

`orchestrator/sync/schema.ts` line 82: `{ name: 'is_default', kind: 'bool' },` → `{ name: 'is_pinned', kind: 'bool' },`.

- [ ] **Step 4: Add PG migration v11**

Append to the `PG_MIGRATIONS` array in `orchestrator/db/pg/schema.ts` (after the `version: 10` entry, before the closing `];`):

```ts
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
```

- [ ] **Step 5: Fix the legacy TT importer**

`orchestrator/db/migrateTimetracker.ts`: the `COLUMNS.projects` list (lines 66–79) is used for both the source SELECT and the target INSERT with identical names. The source (old TimeTracker db) has `is_default`; the target now has `is_pinned`. This one-time importer is effectively retired (the TT app is deleted), so simply **remove** `'is_default',` (line 77) from the `projects` column list — imported projects land unpinned (`is_pinned` defaults to 0). Leave a comment:

```ts
    // (is_default is intentionally not copied: the target column is is_pinned
    //  now; legacy imports land unpinned and the user re-pins as desired.)
```

- [ ] **Step 6: Run test to verify it passes + typecheck orchestrator**

Run:
```bash
npx vitest run tests/orchestrator/sync/schema.test.ts
npx tsc -p orchestrator/tsconfig.json --noEmit
```
Expected: PASS + clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add orchestrator/db/pg/schema.ts orchestrator/sync/schema.ts orchestrator/db/migrateTimetracker.ts tests/orchestrator/sync/schema.test.ts
git commit -m "feat(sync): pinned rename in Postgres migration + sync registry + legacy importer"
```

---

### Task 4: Dashboard overview — accept `projectIds[]` (server + payload)

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (`DashboardOverviewRequestPayload` line 139)
- Modify: `packages/shared/src/messagePort.ts` (only if it mirrors the dashboard payload — grep first)
- Modify: `orchestrator/db/dashboardOverview.ts`
- Test: `tests/orchestrator/dashboardOverview.test.ts`

**Interfaces:**
- Consumes: `ReportsService.earnings(from, to, projectId?)` (returns `{ totalEarned, ... }`) — per-project earnings are additive.
- Produces: `DashboardOverviewRequestPayload.projectIds?: number[]` (wins over legacy `projectId` when non-empty; empty/absent = all). `DashboardOverviewService.run` honours both.

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator/dashboardOverview.test.ts` (match the file's existing db + seeding helpers; seed two work projects each with worklogs in the target month):

```ts
it('filters today/month minutes to the union of projectIds', () => {
  // Assumes the file's helper seeds project A (id aId) and B (id bId) with
  // known minutes on `todayDate`. Adjust ids/values to the file's fixtures.
  const both = svc.run({ projectIds: [aId, bId], sprintAnchor: todayDate, todayDate });
  const onlyA = svc.run({ projectIds: [aId], sprintAnchor: todayDate, todayDate });
  const all = svc.run({ sprintAnchor: todayDate, todayDate }); // no filter = all

  expect(both.today.minutes).toBe(onlyA.today.minutes + minutesForB);
  expect(all.today.minutes).toBeGreaterThanOrEqual(both.today.minutes);
});

it('honours the legacy single projectId', () => {
  const legacy = svc.run({ projectId: aId, sprintAnchor: todayDate, todayDate });
  const viaArray = svc.run({ projectIds: [aId], sprintAnchor: todayDate, todayDate });
  expect(legacy.today.minutes).toBe(viaArray.today.minutes);
});
```

Use the exact fixture ids/values the test file already sets up; do not hardcode unrelated numbers.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/dashboardOverview.test.ts -t "projectIds"`
Expected: FAIL — `projectIds` not a known payload field / not filtered.

- [ ] **Step 3: Extend the payload**

`packages/shared/src/ipcContract.ts` — replace `DashboardOverviewRequestPayload` (line 139) with:

```ts
export interface DashboardOverviewRequestPayload {
  /** @deprecated legacy single-project filter; null = all. Prefer projectIds. */
  projectId?: number | null;
  /** Multi-project filter; empty/absent = all projects. Wins over projectId. */
  projectIds?: number[];
  /** Any ISO date inside the target sprint (YYYY-MM-DD). Server computes the sprint window. */
  sprintAnchor: string;
  /** ISO YYYY-MM-DD in the user's local tz, sent by renderer so the orchestrator
   *  doesn't derive "today" from its own clock. */
  todayDate: string;
}
```

Then grep for a mirror: `grep -n "DashboardOverviewRequest\|dashboard:overview" packages/shared/src/messagePort.ts`. If a separate payload type exists there, apply the identical `projectId?`/`projectIds?` change so the orchestrator round-trip typechecks.

- [ ] **Step 4: Make the service multi-project**

In `orchestrator/db/dashboardOverview.ts`:

Replace `projectClause` (lines 43–46):

```ts
function projectClause(projectIds: number[]): { sql: string; params: number[] } {
  if (projectIds.length === 0) return { sql: '', params: [] };
  const placeholders = projectIds.map(() => '?').join(', ');
  return { sql: ` AND p.id IN (${placeholders})`, params: projectIds };
}
```

Replace the body of `run` (lines 51–76) with:

```ts
  run(req: DashboardOverviewRequestPayload): DashboardOverviewResponsePayload {
    const { sprintAnchor, todayDate } = req;
    // Precedence: projectIds[] wins when non-empty; else the legacy single
    // projectId; else empty = all projects.
    const projectIds =
      req.projectIds && req.projectIds.length > 0
        ? req.projectIds
        : req.projectId != null
          ? [req.projectId]
          : [];
    const reports = new ReportsService(this.db);

    // earnings() filters by one project (or all). Across a multi-project
    // selection the earned totals are additive — each worklog belongs to
    // exactly one project — so sum per selected project.
    const earnedBetween = (from: string, to: string): number =>
      projectIds.length === 0
        ? reports.earnings(from, to).totalEarned
        : projectIds.reduce((sum, pid) => sum + reports.earnings(from, to, pid).totalEarned, 0);

    const todayEarned = earnedBetween(todayDate, todayDate);
    const monthFrom = todayDate.slice(0, 7) + '-01';
    const monthTo = lastDayOfMonth(todayDate);
    const monthEarned = earnedBetween(monthFrom, monthTo);

    const sprint = this.sprintFor(sprintAnchor, projectIds);
    const sprintEarned = earnedBetween(sprint.fromDate, sprint.toDate);

    const today = { minutes: this.sumForDate(todayDate, projectIds), earned: todayEarned };
    const month = { minutes: this.sumForMonth(todayDate, projectIds), earned: monthEarned };
    const heatmap30d = this.heatmap30d(todayDate, projectIds);
    const topProjects = this.topProjects(todayDate, projectIds);
    const activeContracts = this.activeContracts(todayDate);
    return {
      today,
      month,
      sprint: { ...sprint, totalEarned: sprintEarned },
      heatmap30d,
      topProjects,
      activeContracts,
    };
  }
```

Change the five private helpers' signatures from `(…, projectId: number | null)` to `(…, projectIds: number[])` and their internal `projectClause(projectId)` calls to `projectClause(projectIds)`:
- `sumForDate` (line 145)
- `sumForMonth` (line 160)
- `sprintFor` (line 176)
- `heatmap30d` (line 221)
- `topProjects` (line 248)

`activeContracts` (line 88) is unchanged — it is deliberately filter-independent.

- [ ] **Step 5: Run test + typecheck**

Run:
```bash
npx vitest run tests/orchestrator/dashboardOverview.test.ts
npx tsc -p orchestrator/tsconfig.json --noEmit
```
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts orchestrator/db/dashboardOverview.ts tests/orchestrator/dashboardOverview.test.ts
git commit -m "feat(dashboard): overview accepts multi-project projectIds filter"
```

(If `messagePort.ts` had no mirror to change, drop it from the `git add`.)

---

### Task 5: Dashboard renderer — multi-select preselecting all pinned

**Files:**
- Modify: `apps/desktop/src/state/useDashboardOverview.ts`
- Modify: `apps/desktop/src/components/dashboard/ModuleDashboard.tsx`
- Modify: `apps/desktop/src/components/dashboard/DashboardHeader.tsx`

**Interfaces:**
- Consumes: `DashboardOverviewRequestPayload.projectIds` (Task 4); `ProjectViewPayload.isPinned` (Task 2).
- Produces: dashboard state `projectIds: number[]`, persisted under `watchtower.dashboard.projectIds`, seeded to all pinned.

No new automated test (xterm/RTL-free component; verified by typecheck + manual run). The behaviour is covered end-to-end by the A4 service test plus manual verification.

- [ ] **Step 1: Convert the hook to `projectIds[]`**

Replace `useDashboardOverview` (`apps/desktop/src/state/useDashboardOverview.ts`) signature + body:

```ts
export function useDashboardOverview(
  projectIds: number[],
  sprintAnchor: string,
  todayDate: string,
): DashboardOverviewState {
  const [data, setData] = useState<DashboardOverviewResponsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Arrays are a fresh reference each render — key the callback on a stable
  // serialisation so refresh only re-fires when the selection actually changes.
  const projectIdsKey = projectIds.length > 0 ? projectIds.join(',') : '';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = projectIdsKey === '' ? [] : projectIdsKey.split(',').map(Number);
      const payload: DashboardOverviewRequestPayload = { projectIds: ids, sprintAnchor, todayDate };
      const res = await window.watchtower.invoke('dashboard:overview', payload);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectIdsKey, sprintAnchor, todayDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
```

- [ ] **Step 2: Convert `ModuleDashboard` state + seeding + persistence**

In `apps/desktop/src/components/dashboard/ModuleDashboard.tsx`:

Replace the `FILTER_KEY` + persistence helpers (lines 18–40) with:

```ts
const FILTER_KEY = 'watchtower.dashboard.projectIds';

function todayIso(): string {
  return dayjs().format('YYYY-MM-DD');
}

function readPersistedProjects(): number[] | null {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    if (v === null) return null; // never persisted → caller seeds pinned
    const arr = JSON.parse(v) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return null;
  }
}

function persistProjects(ids: number[]) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(ids));
  } catch { /* best-effort */ }
}
```

Replace the state + seed + persist effects (lines 61, 62, 76–100) with:

```ts
  const [projectIds, setProjectIds] = useState<number[]>(() => readPersistedProjects() ?? []);
  const [defaultSeeded, setDefaultSeeded] = useState(false);
```

```ts
  // Seed all pinned projects on first load, but only if nothing was ever
  // persisted (so we never override an explicit "All projects" [] the user
  // chose). Wait for projects to load before deciding.
  useEffect(() => {
    if (defaultSeeded) return;
    if (projectsState.projects.length === 0) return;
    let persisted: string | null = null;
    try {
      persisted = localStorage.getItem(FILTER_KEY);
    } catch { /* ignore */ }
    setDefaultSeeded(true);
    if (persisted !== null) return; // explicit choice (including []) preserved
    const pinned = projectsState.projects.filter((p) => p.isPinned).map((p) => p.id);
    if (pinned.length > 0) setProjectIds(pinned);
  }, [defaultSeeded, projectsState.projects]);

  // Persist only AFTER seeding has resolved — otherwise the initial [] would be
  // written before the seed effect reads localStorage, making the seed think
  // the user had explicitly chosen "All projects".
  useEffect(() => {
    if (!defaultSeeded) return;
    persistProjects(projectIds);
  }, [defaultSeeded, projectIds]);
```

Update the overview call (line 102): `const overview = useDashboardOverview(projectIds, sprintAnchor, today);`

Update the `DashboardHeader` usage (lines 127–132):

```tsx
      <DashboardHeader
        projects={projectList}
        projectIds={projectIds}
        onProjectsChange={setProjectIds}
        todayDate={today}
      />
```

- [ ] **Step 3: Convert `DashboardHeader` to a multiple-Select**

Replace `apps/desktop/src/components/dashboard/DashboardHeader.tsx` entirely:

```tsx
import { Box, Checkbox, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { ProjectViewPayload } from '@watchtower/shared/ipcContract.js';
import { formatWeekdayDateLongCz } from '../../util/format.js';

export interface DashboardHeaderProps {
  projects: ProjectViewPayload[];
  projectIds: number[];
  onProjectsChange(next: number[]): void;
  todayDate: string;
}

export function DashboardHeader({ projects, projectIds, onProjectsChange, todayDate }: DashboardHeaderProps) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      alignItems={{ xs: 'flex-start', md: 'center' }}
      justifyContent="space-between"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        backgroundColor: 'background.default',
        py: 0.5,
        mb: 1.5,
      }}
    >
      <Typography variant="h5" sx={{ fontWeight: 600 }}>Dashboard</Typography>
      <Stack direction="row" spacing={3} alignItems="center">
        <TextField
          select
          size="small"
          label="Projects"
          InputLabelProps={{ shrink: true }}
          value={projectIds.map(String)}
          onChange={(e) => {
            const raw = e.target.value as unknown as string[];
            onProjectsChange(raw.map(Number));
          }}
          SelectProps={{
            multiple: true,
            displayEmpty: true,
            renderValue: (selected) => {
              const ids = (selected as string[]).map(Number);
              if (ids.length === 0) return 'All projects';
              const names = ids
                .map((id) => projects.find((p) => p.id === id)?.name)
                .filter((n): n is string => Boolean(n));
              return names.join(', ');
            },
          }}
          sx={{ minWidth: 220, maxWidth: 340 }}
        >
          {projects.map((p) => (
            <MenuItem key={p.id} value={String(p.id)}>
              <Checkbox
                size="small"
                checked={projectIds.includes(p.id)}
                sx={{ ml: -1, mr: 0.5 }}
              />
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: p.color }} />
                <span>{p.name}</span>
              </Stack>
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          {formatWeekdayDateLongCz(todayDate)}
        </Typography>
      </Stack>
    </Stack>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: no NEW errors involving `DashboardHeader`, `useDashboardOverview`, `ModuleDashboard`, `projectIds`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/state/useDashboardOverview.ts apps/desktop/src/components/dashboard/ModuleDashboard.tsx apps/desktop/src/components/dashboard/DashboardHeader.tsx
git commit -m "feat(dashboard): multi-select project filter preselecting all pinned projects"
```

---

## PART B — Attention dot clears on interaction

### Task 6: `signalTerminalInteraction` helper (pure, testable)

**Files:**
- Create: `apps/desktop/src/components/instances/terminalInteraction.ts`
- Test: `tests/client/instances/terminalInteraction.test.ts`

**Interfaces:**
- Consumes: `ACTION_NEEDED_STATUSES` from `@watchtower/shared/tabAttention.js`.
- Produces: `signalTerminalInteraction(instanceId: string, status: string, invokeFocusChanged: (instanceId: string) => void): void` — calls `invokeFocusChanged(instanceId)` iff `status` is action-needed.

- [ ] **Step 1: Write the failing test**

Create `tests/client/instances/terminalInteraction.test.ts`. Match the import style of a sibling client test (`tests/client/state/projectsBus.test.ts`) — it will use either a path alias or a relative path into `apps/desktop/src`. Use the same convention:

```ts
import { describe, it, expect, vi } from 'vitest';
import { signalTerminalInteraction } from '../../../apps/desktop/src/components/instances/terminalInteraction.js';

describe('signalTerminalInteraction', () => {
  it('emits focusChanged when the instance needs attention', () => {
    const spy = vi.fn();
    signalTerminalInteraction('i1', 'waiting-permission', spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('i1');
  });

  it('does nothing for a non-attention status', () => {
    const spy = vi.fn();
    signalTerminalInteraction('i1', 'working', spy);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/instances/terminalInteraction.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

Create `apps/desktop/src/components/instances/terminalInteraction.ts`:

```ts
import { ACTION_NEEDED_STATUSES } from '@watchtower/shared/tabAttention.js';

/**
 * Clear an instance's "attention needed" dot on genuine interaction.
 *
 * The dot is a pure function of instance status, and status is only cleared by
 * a focus *transition* (the layout-derived `focusChanged` effect fires only
 * when the focused instance id changes). Clicking or typing in an ALREADY
 * focused terminal produces no transition, so the dot lingers until the user
 * leaves and refocuses. When the instance currently needs attention, re-emit
 * `focusChanged` for it so the orchestrator runs its `tabFocused →
 * clearAttention` transition. Gated on status so ordinary typing never spams IPC.
 */
export function signalTerminalInteraction(
  instanceId: string,
  status: string,
  invokeFocusChanged: (instanceId: string) => void,
): void {
  if (!ACTION_NEEDED_STATUSES.has(status)) return;
  invokeFocusChanged(instanceId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/instances/terminalInteraction.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/instances/terminalInteraction.ts tests/client/instances/terminalInteraction.test.ts
git commit -m "feat(instances): add gated terminal-interaction attention-clear helper"
```

---

### Task 7: Wire the helper into `Terminal.tsx` (keystroke + click)

**Files:**
- Modify: `apps/desktop/src/components/Terminal.tsx`

**Interfaces:**
- Consumes: `signalTerminalInteraction` (Task 6); the existing `focusChanged` IPC.

Verified manually (xterm needs a real DOM/canvas — not unit-testable in the node vitest env). The gate logic is already covered by B1's test.

- [ ] **Step 1: Add the import + a live status ref**

At the top of `apps/desktop/src/components/Terminal.tsx`, add to the imports:

```ts
import { signalTerminalInteraction } from './instances/terminalInteraction.js';
```

Inside the `Terminal` component, just after the existing refs (after line 26 `const slot = useSlotForInstance(instanceId);`), add a ref that always holds the current status (the mount effect's closures capture `status` once, so read it via a ref):

```ts
  const statusRef = useRef(status);
  statusRef.current = status;
```

Add a stable clear callback (below the refs):

```ts
  const clearAttentionOnInteraction = () =>
    signalTerminalInteraction(instanceId, statusRef.current, (id) =>
      void window.watchtower.invoke('focusChanged', { instanceId: id }),
    );
```

- [ ] **Step 2: Fire on keystroke**

In the mount effect, extend the `term.onData` handler (lines 72–74):

```ts
    const inputDisp = term.onData((data) => {
      void window.watchtower.invoke('ptyWrite', { instanceId, data });
      clearAttentionOnInteraction();
    });
```

- [ ] **Step 3: Fire on click (capture-phase mousedown on the host)**

Still in the mount effect (which already early-returns if `!hostRef.current`), register a capture-phase `mousedown` listener on the xterm host so a click into an already-focused terminal also clears attention. Add after the `onData` wiring and include cleanup in the returned disposer:

```ts
    const host = hostRef.current;
    const onHostMouseDown = () => clearAttentionOnInteraction();
    host.addEventListener('mousedown', onHostMouseDown, true);

    return () => {
      offData();
      inputDisp.dispose();
      host.removeEventListener('mousedown', onHostMouseDown, true);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
```

(Replace the existing `return () => { ... }` disposer at lines 82–88 with the version above — same contents plus the listener removal. `host` is safely non-null here because the effect early-returns at line 41 when `hostRef.current` is falsy.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: no NEW errors in `Terminal.tsx`.

- [ ] **Step 5: Manual verification**

Run the app (`npm run dev`), start a Claude instance, trigger a permission prompt (red dot), keep that terminal focused, and confirm:
1. Typing a character clears the red dot immediately.
2. Clicking inside the already-focused terminal clears the red dot.
3. During normal work (status `working`), typing does not spam — confirm no runaway `focusChanged` (e.g. no state churn / re-render storm).

If you cannot run the app in this environment, say so explicitly and leave the manual step unchecked for the user to verify.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/Terminal.tsx
git commit -m "fix(instances): clear attention dot on click/keystroke in an already-focused terminal"
```

---

## FINALIZE

### Task 8: Full verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green (1026+); no regressions.

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck:ci`
Expected: clean across workspaces (pre-existing drift documented in CLAUDE.md aside — confirm nothing NEW).

### Task 9: Regroup into two commits

Part A and Part B touch disjoint file sets, so the per-task commits can be collapsed into the two the user asked for.

- [ ] **Step 1: Soft-reset to the design-doc commit**

Find the spec commit (the `docs: design for pinned projects…` commit) and soft-reset onto it (keeps all working-tree changes staged-able; no data loss):

```bash
BASE=$(git log --oneline --grep="design for pinned projects" --format=%H -n 1)
git reset --soft "$BASE"
```

- [ ] **Step 2: Commit Part A**

```bash
git add orchestrator/db/migrations.ts orchestrator/db/repositories/projects.ts \
        orchestrator/db/pg/schema.ts orchestrator/sync/schema.ts orchestrator/db/migrateTimetracker.ts \
        orchestrator/db/dashboardOverview.ts \
        packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts \
        apps/desktop/src/components/timetracker/ProjectDrawer.tsx \
        apps/desktop/src/components/timetracker/ProjectDetailPane.tsx \
        apps/desktop/src/components/timetracker/ProjectsPage.tsx \
        apps/desktop/src/components/timetracker/ProjectsSidebar.tsx \
        apps/desktop/src/components/timetracker/ReportsTab.tsx \
        apps/desktop/src/components/timetracker/TaskGridView.tsx \
        apps/desktop/src/components/dashboard/ModuleDashboard.tsx \
        apps/desktop/src/components/dashboard/DashboardHeader.tsx \
        apps/desktop/src/state/useDashboardOverview.ts \
        tests/orchestrator/migrations.test.ts tests/orchestrator/projects-repo.test.ts \
        tests/orchestrator/sync/schema.test.ts tests/orchestrator/dashboardOverview.test.ts
git commit -m "feat(projects): pinned projects — allow multiple, preselect in task grid + dashboard

Rename the single 'default project' flag to a multi-select 'pinned' flag
(is_default→is_pinned end-to-end: SQLite v19, Postgres v11, sync registry,
shared types, UI). Pinned projects preselect in the task-grid and the newly
multi-select dashboard filter. Drops the one-default unique index + clearDefault.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 2b: Handle messagePort if unchanged**

If `packages/shared/src/messagePort.ts` had no dashboard-payload mirror (Task 4), it was still changed in A2 (the `OrchProject*` rename) — so it belongs in the Part A commit above regardless. Confirm `git status` shows a clean tree after the two commits.

- [ ] **Step 3: Commit Part B**

```bash
git add apps/desktop/src/components/instances/terminalInteraction.ts \
        apps/desktop/src/components/Terminal.tsx \
        tests/client/instances/terminalInteraction.test.ts
git commit -m "fix(instances): clear attention dot on click/keystroke in an already-focused terminal

The dot was a pure function of status, cleared only on a focus transition, so
interacting with an already-focused terminal never dismissed it. Re-emit the
existing focusChanged IPC (→ tabFocused → clearAttention) on click/keystroke,
gated on the instance currently needing attention.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Final sanity**

Run: `git status` (clean tree) and `git log --oneline -3` (spec commit + two feature commits). Re-run `npm test` once more to confirm the regrouped tree still builds green.

---

## Self-review notes (coverage map)

- Spec "migration drop index + rename" → A1 (SQLite v19), A3 (PG v11). **Correction vs spec:** SQLite migration is **v19** (not v6) and PG is **v11** — the spec's "v6" predated reading the actual migration lists.
- Spec "mirror rename in pg/schema, sync registry, migrateTimetracker" → A3.
- Spec "repo drop clearDefault, keep archive-unpin, ORDER BY" → A2.
- Spec "rename all TS types + UI labels" → A2.
- Spec "task grid seed all pinned" → A2 Step 6.
- Spec "dashboard single→multi (state, localStorage, header, hook, payload, service)" → A4 (server/payload) + A5 (renderer).
- Spec "minor consumers renamed (ProjectsPage/Sidebar/Reports)" → A2 Step 5.
- Spec "Part B root cause + fix, gated, reuse focusChanged" → B1 (helper+test) + B2 (wiring).
- Spec "tests" → A1/A2/A3/A4 automated; A5/B2 typecheck + manual (documented why).
- **Simplification vs spec:** `timetracker_schema.sql` and the PG `PROJECTS` create-constant are NOT edited — the migration chain handles fresh installs, matching v13's `project_rates→contracts` precedent.
