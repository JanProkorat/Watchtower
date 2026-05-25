# Dashboard Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level Dashboard module to Watchtower with KPI tiles, a 7-day worklog strip, a Sessions card (Live | Recent), a 30-day heatmap with streak stats, and a "Top projects this month" card; make it the default landing module with last-active persistence.

**Architecture:** New IPC `dashboard:overview` (single aggregate round-trip) backed by `DashboardOverviewService` in `orchestrator/db/dashboardOverview.ts`. Renderer-side `useDashboardOverview(projectId, weekAnchor)` hook drives `client/src/components/dashboard/ModuleDashboard.tsx`, which composes nine sub-components. A new `useActiveModule()` hook persists the last-active module in `localStorage` (default `dashboard`). Reuses the existing `Heatmap` chart component from `client/src/components/timetracker/charts/Heatmap.tsx`.

**Tech Stack:** TypeScript, React 18 (renderer), MUI v5, Node `utilityProcess` orchestrator + `node:sqlite` (`DatabaseSync`), Vitest, dayjs (cs locale + isoWeek), Electron MessagePort IPC.

**Source spec:** `docs/superpowers/specs/2026-05-25-dashboard-module-design.md`

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `orchestrator/db/dashboardOverview.ts` | `DashboardOverviewService` — KPIs / week / heatmap / topProjects + stats |
| `tests/orchestrator/dashboardOverview.test.ts` | Service tests (TDD) |
| `client/src/state/useDashboardOverview.ts` | IPC fetcher hook (deps: `projectId`, `weekAnchor`, `todayDate`) |
| `client/src/state/useActiveModule.ts` | `[ModuleId, setter]` with `localStorage` persistence; default `'dashboard'` |
| `tests/client/useActiveModule.test.ts` | Hook tests for persistence + fallback |
| `client/src/components/dashboard/ModuleDashboard.tsx` | Composition root; owns project filter + week anchor |
| `client/src/components/dashboard/DashboardHeader.tsx` | Title + project select + localized date |
| `client/src/components/dashboard/KpiTiles.tsx` | Three KPI tiles (today/week/month) |
| `client/src/components/dashboard/WeekStrip.tsx` | 7-day strip + paging controls |
| `client/src/components/dashboard/WeekDayCell.tsx` | Single day cell with worklog rows |
| `client/src/components/dashboard/LastThirtyDays.tsx` | Heatmap reuse + streak stats row |
| `client/src/components/dashboard/TopProjectsCard.tsx` | Sorted top-projects list |
| `client/src/components/dashboard/SessionsCard.tsx` | Live \| Recent two-column card |
| `client/src/components/dashboard/SessionRow.tsx` | One session card row |

**Modified files**

| Path | What changes |
|---|---|
| `shared/ipcContract.ts` | Add `dashboard:overview` request + response types |
| `shared/messagePort.ts` | Mirror new IPC into orchestrator wire types |
| `orchestrator/index.ts` | Add `case 'dashboard:overview'` handler |
| `client/src/components/ModuleRail.tsx` | Flip `dashboard.enabled` to `true` |
| `client/src/App.tsx` | Render `<ModuleDashboard>`; replace `useState('instances')` with `useActiveModule()` |

---

## Task 1: IPC contracts for `dashboard:overview`

**Files:**
- Modify: `shared/ipcContract.ts` (append types + variant entries)
- Modify: `shared/messagePort.ts` (mirror request kind)

- [ ] **Step 1.1: Add the request/response payload types**

Open `shared/ipcContract.ts` and append the following types near the existing report payload types (e.g. after `HeatmapDatumPayload`):

```ts
// ─── Dashboard overview ──────────────────────────────────────────────────

export interface DashboardOverviewRequestPayload {
  /** Optional project filter; null = all projects. */
  projectId: number | null;
  /** Any ISO date inside the target week (YYYY-MM-DD). Server normalises to Monday. */
  weekAnchor: string;
  /** ISO YYYY-MM-DD in the user's local tz, sent by renderer so the orchestrator
   *  doesn't derive "today" from its own clock. */
  todayDate: string;
}

export interface DashboardWeekDayPayload {
  /** YYYY-MM-DD. */
  date: string;
  /** Sum of minutes for the day (respects projectId filter). */
  minutes: number;
  worklogs: DashboardWeekWorklogPayload[];
}

export interface DashboardWeekWorklogPayload {
  id: number;
  /** e.g. "FIE1933-19084" — may be null for ad-hoc tasks. */
  taskNumber: string | null;
  projectName: string;
  projectColor: string | null;
  minutes: number;
  note: string | null;
}

export interface DashboardHeatmapStatsPayload {
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  /** Total minutes / 30 * 7, rounded to nearest minute. */
  weeklyAvgMinutes: number;
  busiestDay: { date: string; minutes: number } | null;
}

export interface DashboardTopProjectPayload {
  projectId: number;
  projectName: string;
  projectColor: string | null;
  minutes: number;
}

export interface DashboardOverviewResponsePayload {
  today: { minutes: number };
  month: { minutes: number };
  week: {
    fromDate: string;
    toDate: string;
    totalMinutes: number;
    days: DashboardWeekDayPayload[];
  };
  heatmap30d: {
    fromDate: string;
    toDate: string;
    days: { date: string; minutes: number }[];
    stats: DashboardHeatmapStatsPayload;
  };
  topProjects: DashboardTopProjectPayload[];
}
```

- [ ] **Step 1.2: Add the request variant to `IpcRequest`**

Find the existing `reports:rateChanges` line in `IpcRequest` (around line 54) and append the new variant immediately after it:

```ts
  | { kind: 'reports:rateChanges'; payload: { from: string; to: string; projectId?: number } }
  | { kind: 'dashboard:overview'; payload: DashboardOverviewRequestPayload }
```

- [ ] **Step 1.3: Add the response variant to `IpcResponse`**

Find the matching `reports:rateChanges` response line and append:

```ts
  | { kind: 'dashboard:overview'; payload: DashboardOverviewResponsePayload }
```

- [ ] **Step 1.4: Mirror request into `shared/messagePort.ts`**

Open `shared/messagePort.ts`. Find the `reports:rateChanges` line in `OrchRequest` (around the same area) and add immediately after it:

```ts
  | { id: string; kind: 'dashboard:overview'; payload: import('./ipcContract.js').DashboardOverviewRequestPayload }
```

- [ ] **Step 1.5: Run typecheck to confirm contract additions compile**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
```

Expected: exits 0 (no new errors caused by the additions).

- [ ] **Step 1.6: Commit**

```bash
git add shared/ipcContract.ts shared/messagePort.ts
git commit -m "feat(dashboard): add dashboard:overview IPC contract"
```

---

## Task 2: `DashboardOverviewService` (server-side aggregate)

**Files:**
- Create: `orchestrator/db/dashboardOverview.ts`
- Test: `tests/orchestrator/dashboardOverview.test.ts`

This task is TDD: tests first, then implementation. Sub-steps below test each piece independently before composing them.

- [ ] **Step 2.1: Scaffold the empty service with the public API**

Create `orchestrator/db/dashboardOverview.ts`:

```ts
import type { SqliteLike } from './migrations.js';
import type {
  DashboardOverviewRequestPayload,
  DashboardOverviewResponsePayload,
} from '../../shared/ipcContract.js';

/**
 * Aggregate dashboard data in a single round-trip. Public API mirrors
 * `DashboardOverviewResponsePayload` from the IPC contract — KPIs / week / heatmap /
 * top projects. All dates on the wire are ISO YYYY-MM-DD.
 */
export class DashboardOverviewService {
  constructor(private readonly db: SqliteLike) {}

  run(req: DashboardOverviewRequestPayload): DashboardOverviewResponsePayload {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 2.2: Write the test harness (failing — empty body)**

Create `tests/orchestrator/dashboardOverview.test.ts`:

```ts
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
import { DashboardOverviewService } from '../../orchestrator/db/dashboardOverview.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-dash-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('DashboardOverviewService', () => {
  let db: SqliteLike;
  let service: DashboardOverviewService;
  let projects: ProjectsRepo;
  let epics: EpicsRepo;
  let tasks: TasksRepo;
  let worklogs: WorklogsRepo;

  beforeEach(() => {
    db = freshDb();
    service = new DashboardOverviewService(db);
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
    worklogs = new WorklogsRepo(db);
  });

  function seedTask(projectName: string, color: string, taskNumber: string) {
    const p = projects.create({ name: projectName, color, kind: 'work' });
    const e = epics.create({ projectId: p.id, name: 'E' });
    const t = tasks.create({ epicId: e.id, number: taskNumber, title: taskNumber });
    return { project: p, task: t };
  }

  function seedWorklog(taskId: number, date: string, minutes: number, description?: string) {
    return worklogs.create({ taskId, workDate: date, minutes, description: description ?? null });
  }

  // Tests added in subsequent steps.
});
```

- [ ] **Step 2.3: Run test file to confirm it loads + first assertion-less describe works**

```bash
npx vitest run tests/orchestrator/dashboardOverview.test.ts
```

Expected: PASS (no `it()` blocks yet, but the file loads).

- [ ] **Step 2.4: TEST — `today.minutes` sums today's worklogs and respects `projectId`**

Append inside the `describe(...)` block:

```ts
  it('today.minutes sums worklogs on todayDate, ignoring other days', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 90);
    seedWorklog(task.id, '2026-05-24', 60);

    const res = service.run({
      projectId: null,
      weekAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.today.minutes).toBe(90);
  });

  it('today.minutes respects projectId filter', () => {
    const a = seedTask('A', '#aaa', 'A-1');
    const b = seedTask('B', '#bbb', 'B-1');
    seedWorklog(a.task.id, '2026-05-25', 60);
    seedWorklog(b.task.id, '2026-05-25', 30);

    const res = service.run({
      projectId: a.project.id,
      weekAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.today.minutes).toBe(60);
  });
```

- [ ] **Step 2.5: Run failing test**

```bash
npx vitest run tests/orchestrator/dashboardOverview.test.ts
```

Expected: FAIL with "not implemented".

- [ ] **Step 2.6: Implement `today` and the `run` composer skeleton**

Replace the body of `orchestrator/db/dashboardOverview.ts`:

```ts
import type { SqliteLike } from './migrations.js';
import type {
  DashboardOverviewRequestPayload,
  DashboardOverviewResponsePayload,
  DashboardWeekDayPayload,
  DashboardHeatmapStatsPayload,
  DashboardTopProjectPayload,
} from '../../shared/ipcContract.js';

interface MinutesRow {
  minutes: number | null;
}

interface MinutesByDateRow {
  work_date: string;
  minutes: number;
}

interface WorklogJoinedRow {
  id: number;
  task_number: string | null;
  project_name: string;
  project_color: string | null;
  minutes: number;
  description: string | null;
  work_date: string;
}

interface TopProjectRow {
  project_id: number;
  project_name: string;
  project_color: string | null;
  minutes: number;
}

/**
 * Single SQL clause used everywhere to scope by project. Returns an object
 * holding the partial SQL + bindings so callers can spread it inline.
 */
function projectClause(projectId: number | null): { sql: string; params: number[] } {
  if (projectId == null) return { sql: '', params: [] };
  return { sql: ' AND p.id = ?', params: [projectId] };
}

export class DashboardOverviewService {
  constructor(private readonly db: SqliteLike) {}

  run(req: DashboardOverviewRequestPayload): DashboardOverviewResponsePayload {
    const { projectId, weekAnchor, todayDate } = req;

    const today = { minutes: this.sumForDate(todayDate, projectId) };
    const month = { minutes: this.sumForMonth(todayDate, projectId) };
    const week = this.weekFor(weekAnchor, projectId);
    const heatmap30d = this.heatmap30d(todayDate, projectId);
    const topProjects = this.topProjects(todayDate, projectId);

    return { today, month, week, heatmap30d, topProjects };
  }

  // ── 1. KPIs ────────────────────────────────────────────────────────────

  private sumForDate(date: string, projectId: number | null): number {
    const pc = projectClause(projectId);
    const sql = `
      SELECT COALESCE(SUM(w.minutes), 0) AS minutes
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE w.work_date = ?${pc.sql}
    `;
    const row = (this.db.prepare(sql).get(date, ...pc.params) as MinutesRow | undefined) ?? null;
    return row?.minutes ?? 0;
  }

  private sumForMonth(todayDate: string, projectId: number | null): number {
    // todayDate is YYYY-MM-DD; derive the YYYY-MM prefix and use strftime in SQL.
    const ym = todayDate.slice(0, 7); // "2026-05"
    const pc = projectClause(projectId);
    const sql = `
      SELECT COALESCE(SUM(w.minutes), 0) AS minutes
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE strftime('%Y-%m', w.work_date) = ?${pc.sql}
    `;
    const row = (this.db.prepare(sql).get(ym, ...pc.params) as MinutesRow | undefined) ?? null;
    return row?.minutes ?? 0;
  }

  // ── 2. This-week worklog list ──────────────────────────────────────────

  private weekFor(weekAnchor: string, projectId: number | null) {
    const monday = mondayOf(weekAnchor);
    const sunday = addDays(monday, 6);
    const pc = projectClause(projectId);
    const sql = `
      SELECT w.id, t.number AS task_number, p.name AS project_name, p.color AS project_color,
             w.minutes, w.description, w.work_date
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE w.work_date BETWEEN ? AND ?${pc.sql}
      ORDER BY w.work_date ASC, w.id ASC
    `;
    const rows = this.db.prepare(sql).all(monday, sunday, ...pc.params) as WorklogJoinedRow[];

    const days: DashboardWeekDayPayload[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      const worklogs = rows
        .filter((r) => r.work_date === date)
        .map((r) => ({
          id: r.id,
          taskNumber: r.task_number,
          projectName: r.project_name,
          projectColor: r.project_color,
          minutes: r.minutes,
          note: r.description,
        }));
      const minutes = worklogs.reduce((acc, w) => acc + w.minutes, 0);
      days.push({ date, minutes, worklogs });
    }
    const totalMinutes = days.reduce((acc, d) => acc + d.minutes, 0);
    return { fromDate: monday, toDate: sunday, totalMinutes, days };
  }

  // ── 3. 30-day heatmap + stats ──────────────────────────────────────────

  private heatmap30d(todayDate: string, projectId: number | null) {
    const fromDate = addDays(todayDate, -29);
    const toDate = todayDate;
    const pc = projectClause(projectId);
    const sql = `
      SELECT w.work_date, SUM(w.minutes) AS minutes
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE w.work_date BETWEEN ? AND ?${pc.sql}
      GROUP BY w.work_date
      ORDER BY w.work_date ASC
    `;
    const grouped = this.db.prepare(sql).all(fromDate, toDate, ...pc.params) as MinutesByDateRow[];
    const map = new Map(grouped.map((r) => [r.work_date, r.minutes]));

    const days: { date: string; minutes: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const date = addDays(fromDate, i);
      days.push({ date, minutes: map.get(date) ?? 0 });
    }
    const stats = computeStats(days, todayDate);
    return { fromDate, toDate, days, stats };
  }

  // ── 4. Top projects this month ─────────────────────────────────────────

  private topProjects(todayDate: string, projectId: number | null): DashboardTopProjectPayload[] {
    const ym = todayDate.slice(0, 7);
    const pc = projectClause(projectId);
    const sql = `
      SELECT p.id AS project_id, p.name AS project_name, p.color AS project_color,
             SUM(w.minutes) AS minutes
      FROM worklogs w
      JOIN tasks   t ON t.id = w.task_id
      JOIN epics   e ON e.id = t.epic_id
      JOIN projects p ON p.id = e.project_id
      WHERE strftime('%Y-%m', w.work_date) = ?${pc.sql}
      GROUP BY p.id, p.name, p.color
      HAVING SUM(w.minutes) > 0
      ORDER BY minutes DESC, p.name ASC
    `;
    const rows = this.db.prepare(sql).all(ym, ...pc.params) as TopProjectRow[];
    return rows.map((r) => ({
      projectId: r.project_id,
      projectName: r.project_name,
      projectColor: r.project_color,
      minutes: r.minutes,
    }));
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Normalise any YYYY-MM-DD to the Monday of its ISO week. */
function mondayOf(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0 = Sun
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function computeStats(
  days: { date: string; minutes: number }[],
  todayDate: string,
): DashboardHeatmapStatsPayload {
  const map = new Map(days.map((d) => [d.date, d.minutes]));
  const activeDays = days.filter((d) => d.minutes > 0).length;
  const totalMinutes = days.reduce((acc, d) => acc + d.minutes, 0);
  const weeklyAvgMinutes = Math.round((totalMinutes / 30) * 7);

  // Current streak: count back from today through non-zero days.
  let cursor = todayDate;
  let currentStreak = 0;
  while (map.has(cursor) && (map.get(cursor) ?? 0) > 0) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  // Longest streak: walk the window in ascending order, max run of non-zero days.
  let longestStreak = 0;
  let run = 0;
  for (const d of days) {
    if (d.minutes > 0) {
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }

  let busiestDay: { date: string; minutes: number } | null = null;
  for (const d of days) {
    if (d.minutes > 0 && (busiestDay === null || d.minutes > busiestDay.minutes)) {
      busiestDay = { date: d.date, minutes: d.minutes };
    }
  }

  return { currentStreak, longestStreak, activeDays, weeklyAvgMinutes, busiestDay };
}
```

- [ ] **Step 2.7: Run tests — today.* should pass**

```bash
npx vitest run tests/orchestrator/dashboardOverview.test.ts
```

Expected: 2 PASS for `today.minutes` tests.

- [ ] **Step 2.8: TEST — `month.minutes` covers the current calendar month**

Append:

```ts
  it('month.minutes sums all worklogs in the YYYY-MM derived from todayDate', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-01', 60);
    seedWorklog(task.id, '2026-05-25', 120);
    seedWorklog(task.id, '2026-05-31', 30);
    seedWorklog(task.id, '2026-04-30', 999);  // previous month — excluded
    seedWorklog(task.id, '2026-06-01', 999);  // next month — excluded

    const res = service.run({
      projectId: null,
      weekAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.month.minutes).toBe(60 + 120 + 30);
  });
```

- [ ] **Step 2.9: Run — expect PASS**

```bash
npx vitest run tests/orchestrator/dashboardOverview.test.ts
```

Expected: all 3 PASS.

- [ ] **Step 2.10: TEST — `week.days` length 7, Mon→Sun, totals correct**

Append:

```ts
  it('week.days is always length 7 Mon→Sun and totals match', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 90, 'Mon task');     // Monday
    seedWorklog(task.id, '2026-05-28', 60);                  // Thursday
    seedWorklog(task.id, '2026-05-31', 30);                  // Sunday

    const res = service.run({
      projectId: null,
      weekAnchor: '2026-05-27', // Wednesday in the same ISO week
      todayDate: '2026-05-27',
    });

    expect(res.week.fromDate).toBe('2026-05-25');
    expect(res.week.toDate).toBe('2026-05-31');
    expect(res.week.days.map((d) => d.date)).toEqual([
      '2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28',
      '2026-05-29', '2026-05-30', '2026-05-31',
    ]);
    expect(res.week.days[0].minutes).toBe(90);
    expect(res.week.days[3].minutes).toBe(60);
    expect(res.week.days[6].minutes).toBe(30);
    expect(res.week.days[0].worklogs[0]).toMatchObject({
      taskNumber: 'T-1',
      projectName: 'P',
      projectColor: '#7aa7ff',
      minutes: 90,
      note: 'Mon task',
    });
    expect(res.week.totalMinutes).toBe(180);
  });

  it('mondayOf snaps Sunday correctly to the preceding Monday', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 10);

    const res = service.run({
      projectId: null,
      weekAnchor: '2026-05-31', // Sunday
      todayDate: '2026-05-31',
    });

    expect(res.week.fromDate).toBe('2026-05-25');
    expect(res.week.toDate).toBe('2026-05-31');
  });
```

- [ ] **Step 2.11: Run — expect PASS**

```bash
npx vitest run tests/orchestrator/dashboardOverview.test.ts
```

Expected: all 5 PASS.

- [ ] **Step 2.12: TEST — `heatmap30d` window + stats**

Append:

```ts
  it('heatmap30d covers exactly 30 consecutive days ending todayDate', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 60);
    seedWorklog(task.id, '2026-04-26', 60);
    seedWorklog(task.id, '2026-04-25', 999); // 31 days before — excluded

    const res = service.run({
      projectId: null,
      weekAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.heatmap30d.fromDate).toBe('2026-04-26');
    expect(res.heatmap30d.toDate).toBe('2026-05-25');
    expect(res.heatmap30d.days).toHaveLength(30);
    expect(res.heatmap30d.days.find((d) => d.date === '2026-05-25')?.minutes).toBe(60);
    expect(res.heatmap30d.days.find((d) => d.date === '2026-04-26')?.minutes).toBe(60);
  });

  it('streak counts back from today through consecutive non-zero days', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    for (const d of ['2026-05-25', '2026-05-24', '2026-05-23']) {
      seedWorklog(task.id, d, 30);
    }
    // gap on 22nd
    seedWorklog(task.id, '2026-05-21', 30);

    const res = service.run({
      projectId: null,
      weekAnchor: '2026-05-25',
      todayDate: '2026-05-25',
    });

    expect(res.heatmap30d.stats.currentStreak).toBe(3);
    expect(res.heatmap30d.stats.longestStreak).toBe(3);
    expect(res.heatmap30d.stats.activeDays).toBe(4);
  });

  it('busiestDay returns the heaviest non-zero day, null when empty', () => {
    const empty = service.run({
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
    });
    expect(empty.heatmap30d.stats.busiestDay).toBeNull();

    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-20', 90);
    seedWorklog(task.id, '2026-05-25', 200);
    seedWorklog(task.id, '2026-05-22', 100);

    const res = service.run({
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
    });
    expect(res.heatmap30d.stats.busiestDay).toEqual({ date: '2026-05-25', minutes: 200 });
  });

  it('weeklyAvgMinutes is total / 30 * 7 rounded', () => {
    const { task } = seedTask('P', '#7aa7ff', 'T-1');
    seedWorklog(task.id, '2026-05-25', 300);
    seedWorklog(task.id, '2026-05-20', 300);

    const res = service.run({
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
    });
    expect(res.heatmap30d.stats.weeklyAvgMinutes).toBe(Math.round((600 / 30) * 7));
  });
```

- [ ] **Step 2.13: Run — expect PASS**

```bash
npx vitest run tests/orchestrator/dashboardOverview.test.ts
```

Expected: all 9 PASS.

- [ ] **Step 2.14: TEST — `topProjects` sorted desc, excludes zero-minute projects**

Append:

```ts
  it('topProjects is sorted by minutes desc, excludes zero-minute projects', () => {
    const a = seedTask('Alpha', '#aaa', 'A-1');
    const b = seedTask('Bravo', '#bbb', 'B-1');
    const c = seedTask('Charlie', '#ccc', 'C-1');

    seedWorklog(a.task.id, '2026-05-10', 60);
    seedWorklog(b.task.id, '2026-05-15', 180);
    seedWorklog(b.task.id, '2026-05-20', 120);
    seedWorklog(c.task.id, '2026-04-15', 999); // previous month — excluded

    const res = service.run({
      projectId: null, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
    });

    expect(res.topProjects.map((p) => p.projectName)).toEqual(['Bravo', 'Alpha']);
    expect(res.topProjects[0]).toMatchObject({
      projectName: 'Bravo',
      minutes: 300,
      projectColor: '#bbb',
    });
  });

  it('topProjects respects projectId filter', () => {
    const a = seedTask('Alpha', '#aaa', 'A-1');
    const b = seedTask('Bravo', '#bbb', 'B-1');
    seedWorklog(a.task.id, '2026-05-10', 60);
    seedWorklog(b.task.id, '2026-05-15', 180);

    const res = service.run({
      projectId: a.project.id, weekAnchor: '2026-05-25', todayDate: '2026-05-25',
    });

    expect(res.topProjects.map((p) => p.projectName)).toEqual(['Alpha']);
  });
```

- [ ] **Step 2.15: Run — expect PASS**

```bash
npx vitest run tests/orchestrator/dashboardOverview.test.ts
```

Expected: all 11 PASS.

- [ ] **Step 2.16: Commit**

```bash
git add orchestrator/db/dashboardOverview.ts tests/orchestrator/dashboardOverview.test.ts
git commit -m "feat(dashboard): DashboardOverviewService — aggregate KPIs/week/heatmap/topProjects"
```

---

## Task 3: Wire `dashboard:overview` into the orchestrator handler

**Files:**
- Modify: `orchestrator/index.ts`

- [ ] **Step 3.1: Import the service at the top**

In `orchestrator/index.ts`, find the existing imports of `ReportsService` (the file currently imports services for each IPC kind). Add alongside it:

```ts
import { DashboardOverviewService } from './db/dashboardOverview.js';
```

- [ ] **Step 3.2: Add the case handler in the dispatch switch**

Find the `case 'reports:rateChanges':` block (around line 580) and add the new case immediately after it:

```ts
    case 'dashboard:overview':
      return new DashboardOverviewService(handle!.db).run(req.payload);
```

- [ ] **Step 3.3: Typecheck**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
```

Expected: exits 0.

- [ ] **Step 3.4: Run full test suite — no regressions**

```bash
npm test -- --run
```

Expected: all existing tests + the 11 new ones pass. Final count should be ≥ existing baseline + 11.

- [ ] **Step 3.5: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(dashboard): wire dashboard:overview IPC handler"
```

---

## Task 4: `useDashboardOverview` renderer hook

**Files:**
- Create: `client/src/state/useDashboardOverview.ts`

- [ ] **Step 4.1: Write the hook**

Create `client/src/state/useDashboardOverview.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type {
  DashboardOverviewRequestPayload,
  DashboardOverviewResponsePayload,
} from '../../../shared/ipcContract.js';

export interface DashboardOverviewState {
  data: DashboardOverviewResponsePayload | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/**
 * Single-call dashboard fetcher. Refetches whenever projectId, weekAnchor,
 * or todayDate change. The "today" date is passed in by the caller so the
 * orchestrator doesn't need to know the user's local timezone.
 */
export function useDashboardOverview(
  projectId: number | null,
  weekAnchor: string,
  todayDate: string,
): DashboardOverviewState {
  const [data, setData] = useState<DashboardOverviewResponsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: DashboardOverviewRequestPayload = { projectId, weekAnchor, todayDate };
      const res = await window.watchtower.invoke('dashboard:overview', payload);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, weekAnchor, todayDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
```

- [ ] **Step 4.2: Typecheck the client**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head -30
```

Expected: no NEW errors. (Pre-existing drift is suppressed by the grep — anything else is a real problem.)

- [ ] **Step 4.3: Commit**

```bash
git add client/src/state/useDashboardOverview.ts
git commit -m "feat(dashboard): useDashboardOverview hook"
```

---

## Task 5: `useActiveModule` hook (default + persistence)

**Files:**
- Create: `client/src/state/useActiveModule.ts`
- Test: `tests/client/useActiveModule.test.ts`

- [ ] **Step 5.1: Write the failing test**

Create `tests/client/useActiveModule.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readActiveModule, writeActiveModule, DEFAULT_ACTIVE_MODULE } from '../../client/src/state/useActiveModule.js';

// Tiny in-memory localStorage stub for vitest's node env.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

describe('useActiveModule helpers', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
  });

  it('defaults to dashboard when nothing is persisted', () => {
    expect(readActiveModule()).toBe(DEFAULT_ACTIVE_MODULE);
    expect(DEFAULT_ACTIVE_MODULE).toBe('dashboard');
  });

  it('round-trips a valid module id', () => {
    writeActiveModule('timetracker');
    expect(readActiveModule()).toBe('timetracker');
  });

  it('falls back to dashboard on an unknown value', () => {
    localStorage.setItem('watchtower.activeModule', 'garbage');
    expect(readActiveModule()).toBe('dashboard');
  });

  it('swallows storage exceptions gracefully', () => {
    const broken = {
      getItem() { throw new Error('boom'); },
      setItem() { throw new Error('boom'); },
      removeItem() {}, clear() {}, key() { return null; }, length: 0,
    } as Storage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = broken;

    expect(() => readActiveModule()).not.toThrow();
    expect(readActiveModule()).toBe('dashboard');
    expect(() => writeActiveModule('settings')).not.toThrow();
  });
});
```

- [ ] **Step 5.2: Run failing test**

```bash
npx vitest run tests/client/useActiveModule.test.ts
```

Expected: FAIL — file does not exist yet.

- [ ] **Step 5.3: Implement the hook**

Create `client/src/state/useActiveModule.ts`:

```ts
import { useCallback, useState } from 'react';
import type { ModuleId } from '../components/ModuleRail.js';

const STORAGE_KEY = 'watchtower.activeModule';
const VALID: ReadonlySet<ModuleId> = new Set(['dashboard', 'instances', 'timetracker', 'settings']);

export const DEFAULT_ACTIVE_MODULE: ModuleId = 'dashboard';

export function readActiveModule(): ModuleId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && VALID.has(v as ModuleId)) return v as ModuleId;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return DEFAULT_ACTIVE_MODULE;
}

export function writeActiveModule(id: ModuleId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* best-effort persistence — same pattern as useInstances */
  }
}

export function useActiveModule(): [ModuleId, (m: ModuleId) => void] {
  const [active, setActive] = useState<ModuleId>(readActiveModule);
  const set = useCallback((next: ModuleId) => {
    writeActiveModule(next);
    setActive(next);
  }, []);
  return [active, set];
}
```

- [ ] **Step 5.4: Run test — expect PASS**

```bash
npx vitest run tests/client/useActiveModule.test.ts
```

Expected: 4 PASS.

- [ ] **Step 5.5: Commit**

```bash
git add client/src/state/useActiveModule.ts tests/client/useActiveModule.test.ts
git commit -m "feat(dashboard): useActiveModule hook with localStorage persistence"
```

---

## Task 6: Enable Dashboard rail entry + wire `useActiveModule` into `App.tsx`

This unlocks navigation to the Dashboard module even though the module body is still a stub. Subsequent tasks fill in the body.

**Files:**
- Modify: `client/src/components/ModuleRail.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 6.1: Flip `dashboard.enabled` to `true` in `ModuleRail`**

Open `client/src/components/ModuleRail.tsx` and find the `ITEMS` array:

```ts
const ITEMS: RailItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <SpaceDashboardIcon fontSize="small" />, enabled: false },
```

Change it to:

```ts
const ITEMS: RailItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <SpaceDashboardIcon fontSize="small" />, enabled: true },
```

- [ ] **Step 6.2: Replace the `useState` in `App.tsx` with `useActiveModule`**

Open `client/src/App.tsx`. Find:

```ts
const [activeModule, setActiveModule] = useState<ModuleId>('instances');
```

Replace with:

```ts
const [activeModule, setActiveModule] = useActiveModule();
```

Add the import at the top (alongside the other state-hook imports):

```ts
import { useActiveModule } from './state/useActiveModule.js';
```

- [ ] **Step 6.3: Add a placeholder dashboard render branch**

In `App.tsx`, find the existing chain of `activeModule === 'settings' ? ... : activeModule === 'timetracker' ? ...` (around line 242–245). Prepend a new branch:

```tsx
{activeModule === 'dashboard' ? (
  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-disabled, #5a6068)' }}>
    Dashboard module — wiring in progress
  </div>
) : activeModule === 'settings' ? (
  // …existing branches…
```

Make sure to keep the existing branches intact and balance the ternary's parentheses / colons.

- [ ] **Step 6.4: Typecheck**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head -30
```

Expected: no new errors.

- [ ] **Step 6.5: Run dev server, click the Dashboard rail icon**

```bash
npm run dev
```

Manual: app launches, defaults to Dashboard (placeholder text), and clicking the other rail icons + relaunching restores the last-active module.

- [ ] **Step 6.6: Commit**

```bash
git add client/src/components/ModuleRail.tsx client/src/App.tsx
git commit -m "feat(dashboard): enable rail entry + default-landing wiring"
```

---

## Task 7: `KpiTiles` component

**Files:**
- Create: `client/src/components/dashboard/KpiTiles.tsx`

- [ ] **Step 7.1: Implement the tiles**

Create the file:

```tsx
import { Box, Paper, Stack, Typography } from '@mui/material';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { formatHours } from '../../util/format.js';

export interface KpiTilesProps {
  todayMinutes: number;
  weekMinutes: number;
  monthMinutes: number;
}

interface TileProps {
  label: string;
  minutes: number;
}

function Tile({ label, minutes }: TileProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        flex: 1,
        minWidth: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(179,136,255,0.14)' : 'rgba(98,0,234,0.10)'),
            color: 'primary.main',
          }}
        >
          <CalendarTodayIcon sx={{ fontSize: 16 }} />
        </Box>
        <Typography
          variant="caption"
          sx={{ textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary', fontWeight: 500 }}
        >
          {label}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography sx={{ fontSize: 36, fontWeight: 600, lineHeight: 1 }}>
          {formatHours(minutes, 1)}
        </Typography>
        <Typography variant="body2" color="text.secondary">hours</Typography>
      </Stack>
    </Paper>
  );
}

export function KpiTiles({ todayMinutes, weekMinutes, monthMinutes }: KpiTilesProps) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
      <Tile label="Today" minutes={todayMinutes} />
      <Tile label="This week" minutes={weekMinutes} />
      <Tile label="This month" minutes={monthMinutes} />
    </Stack>
  );
}
```

- [ ] **Step 7.2: Typecheck**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head
```

Expected: no new errors.

- [ ] **Step 7.3: Commit**

```bash
git add client/src/components/dashboard/KpiTiles.tsx
git commit -m "feat(dashboard): KpiTiles component (today / week / month)"
```

---

## Task 8: `WeekDayCell` component

**Files:**
- Create: `client/src/components/dashboard/WeekDayCell.tsx`

- [ ] **Step 8.1: Implement the cell**

Create the file:

```tsx
import { Box, Stack, Typography } from '@mui/material';
import type { DashboardWeekDayPayload } from '../../../../shared/ipcContract.js';
import { formatMinutes } from '../../util/format.js';

const CZECH_DOW_MON_FIRST = ['PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO', 'NE'];

export interface WeekDayCellProps {
  day: DashboardWeekDayPayload;
  /** Index 0–6 = Monday..Sunday. */
  index: number;
  /** True for today's column. */
  isToday: boolean;
}

function shortDate(iso: string): string {
  // iso "2026-05-25" → "25. 5."
  const [, m, d] = iso.split('-');
  return `${Number(d)}. ${Number(m)}.`;
}

export function WeekDayCell({ day, index, isToday }: WeekDayCellProps) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 200,
        p: 1.25,
        borderRadius: 1.25,
        border: 1,
        borderColor: isToday ? 'error.main' : 'divider',
        backgroundColor: isToday
          ? (t) => (t.palette.mode === 'dark' ? 'rgba(239,83,80,0.10)' : 'rgba(239,83,80,0.06)')
          : 'background.default',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography
          sx={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: isToday ? 'error.main' : 'text.secondary',
          }}
        >
          {CZECH_DOW_MON_FIRST[index]}
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{shortDate(day.date)}</Typography>
      </Stack>

      {day.worklogs.length === 0 ? (
        <Stack flex={1} alignItems="center" justifyContent="center">
          <Typography sx={{ color: 'text.disabled', fontSize: 14 }}>—</Typography>
        </Stack>
      ) : (
        <Stack spacing={0.75} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {day.worklogs.map((w) => (
            <Box
              key={w.id}
              sx={{
                pl: 1,
                py: 0.75,
                pr: 0.75,
                borderRadius: 0.75,
                backgroundColor: 'background.paper',
                borderLeft: 3,
                borderColor: w.projectColor ?? 'primary.main',
              }}
            >
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontFamily: 'Menlo, monospace',
                    fontSize: 10.5,
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {w.taskNumber ?? w.projectName}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>
                  {formatMinutes(w.minutes)}
                </Typography>
              </Stack>
              {w.note && (
                <Typography
                  sx={{
                    fontSize: 10.5,
                    color: 'text.disabled',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {w.note}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
```

- [ ] **Step 8.2: Typecheck + commit**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head
git add client/src/components/dashboard/WeekDayCell.tsx
git commit -m "feat(dashboard): WeekDayCell — single day cell with worklog rows"
```

---

## Task 9: `WeekStrip` component

**Files:**
- Create: `client/src/components/dashboard/WeekStrip.tsx`

- [ ] **Step 9.1: Implement the panel**

Create the file:

```tsx
import { useState } from 'react';
import { Box, Chip, IconButton, Paper, Popover, Stack, Tooltip, Typography } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import TodayIcon from '@mui/icons-material/Today';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import 'dayjs/locale/cs';
import type { DashboardWeekDayPayload } from '../../../../shared/ipcContract.js';
import { formatDateLongCz, formatMinutes } from '../../util/format.js';
import { WeekDayCell } from './WeekDayCell.js';

dayjs.extend(isoWeek);

export interface WeekStripProps {
  week: {
    fromDate: string;
    toDate: string;
    totalMinutes: number;
    days: DashboardWeekDayPayload[];
  };
  /** Today's ISO date (YYYY-MM-DD), used to highlight one column. */
  todayDate: string;
  /** Caller updates the week anchor; the strip never derives it itself. */
  onAnchorChange(nextAnchor: string): void;
}

function mondayOf(iso: string): string {
  return dayjs(iso).isoWeekday(1).format('YYYY-MM-DD');
}

export function WeekStrip({ week, todayDate, onAnchorChange }: WeekStripProps) {
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>This week</Typography>
            <Chip
              size="small"
              label={formatMinutes(week.totalMinutes)}
              sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
              color="primary"
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {formatDateLongCz(week.fromDate)} — {formatDateLongCz(week.toDate)}
          </Typography>
        </Box>

        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Jump to today">
            <IconButton size="small" onClick={() => onAnchorChange(todayDate)}>
              <TodayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Previous week">
            <IconButton
              size="small"
              onClick={() => onAnchorChange(dayjs(week.fromDate).subtract(7, 'day').format('YYYY-MM-DD'))}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Pick a week">
            <IconButton size="small" onClick={(e) => setPickerAnchor(e.currentTarget)}>
              <CalendarMonthIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Next week">
            <IconButton
              size="small"
              onClick={() => onAnchorChange(dayjs(week.fromDate).add(7, 'day').format('YYYY-MM-DD'))}
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Popover
        open={Boolean(pickerAnchor)}
        anchorEl={pickerAnchor}
        onClose={() => setPickerAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 1 }}>
          <DatePicker
            value={dayjs(week.fromDate)}
            onChange={(v: Dayjs | null) => {
              if (!v) return;
              onAnchorChange(mondayOf(v.format('YYYY-MM-DD')));
              setPickerAnchor(null);
            }}
          />
        </Box>
      </Popover>

      <Stack direction="row" spacing={1.25} sx={{ width: '100%' }}>
        {week.days.map((d, i) => (
          <WeekDayCell key={d.date} day={d} index={i} isToday={d.date === todayDate} />
        ))}
      </Stack>
    </Paper>
  );
}
```

- [ ] **Step 9.2: Typecheck + commit**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head
git add client/src/components/dashboard/WeekStrip.tsx
git commit -m "feat(dashboard): WeekStrip — 7-day strip with paging controls"
```

---

## Task 10: `SessionRow` component

**Files:**
- Create: `client/src/components/dashboard/SessionRow.tsx`

- [ ] **Step 10.1: Implement the row**

Create the file:

```tsx
import { Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import type { InstanceView } from '../../state/useInstances.js';

const LIVE_STATUSES = new Set([
  'spawning', 'working', 'waiting-permission', 'waiting-input', 'idle-notify', 'resuming',
]);

function chipColorFor(
  status: string,
): 'default' | 'primary' | 'warning' | 'error' | 'success' | 'info' {
  switch (status) {
    case 'waiting-permission':
    case 'crashed':
      return 'error';
    case 'waiting-input':
      return 'warning';
    case 'idle-notify':
      return 'default';
    case 'working':
    case 'spawning':
    case 'resuming':
      return 'primary';
    case 'finished':
      return 'success';
    default:
      return 'default';
  }
}

function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 5_000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)} s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} h ago`;
  return `${Math.floor(delta / 86_400_000)} d ago`;
}

export interface SessionRowProps {
  instance: InstanceView;
  onOpen(id: string): void;
  onKill(id: string): void;
}

export function SessionRow({ instance, onOpen, onKill }: SessionRowProps) {
  const live = LIVE_STATUSES.has(instance.status);
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{
        p: 1.25,
        backgroundColor: 'background.default',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.25,
      }}
    >
      <Chip
        size="small"
        label={instance.status}
        color={chipColorFor(instance.status)}
        sx={{ textTransform: 'lowercase', minWidth: 110, fontSize: 10.5, fontWeight: 600, justifyContent: 'center' }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontFamily: 'Menlo, monospace',
            fontSize: 12,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {instance.cwd}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          {relativeTime(instance.lastActivityAt)}
        </Typography>
      </Box>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Button size="small" variant={live ? 'contained' : 'outlined'} onClick={() => onOpen(instance.id)}>
          Open
        </Button>
        {live && (
          <Tooltip title="Kill">
            <IconButton size="small" onClick={() => onKill(instance.id)}>
              <StopIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}
```

- [ ] **Step 10.2: Typecheck + commit**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head
git add client/src/components/dashboard/SessionRow.tsx
git commit -m "feat(dashboard): SessionRow — single instance card"
```

---

## Task 11: `SessionsCard` component

**Files:**
- Create: `client/src/components/dashboard/SessionsCard.tsx`

- [ ] **Step 11.1: Implement the card**

Create the file:

```tsx
import { Box, Button, Grid, Paper, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import type { InstanceView } from '../../state/useInstances.js';
import { SessionRow } from './SessionRow.js';

const LIVE_STATUSES = new Set([
  'spawning', 'working', 'waiting-permission', 'waiting-input', 'idle-notify', 'resuming',
]);
const RECENT_STATUSES = new Set(['finished', 'crashed', 'suspended']);
const RECENT_CAP = 5;

export interface SessionsCardProps {
  instances: InstanceView[];
  onActivateInstance(id: string): void;
  onKill(id: string): void;
  onStartNewInstance(): void;
}

function ColumnHead({ label, count }: { label: string; count: number }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75, px: 0.25 }}>
      <Typography
        sx={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 11, fontWeight: 600, color: 'text.secondary' }}
      >
        {label}
      </Typography>
      <Box
        sx={{
          px: 1, py: 0.25, borderRadius: 999,
          backgroundColor: 'background.default',
          color: 'text.secondary',
          fontSize: 11,
        }}
      >
        {count}
      </Box>
    </Stack>
  );
}

function EmptyState({ label, onStartNewInstance }: { label: string; onStartNewInstance?: () => void }) {
  return (
    <Stack
      alignItems="center"
      spacing={1.5}
      sx={{
        py: 2.25,
        px: 1.5,
        border: 1,
        borderColor: 'divider',
        borderStyle: 'dashed',
        borderRadius: 1.25,
      }}
    >
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      {onStartNewInstance && (
        <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={onStartNewInstance}>
          Start a new instance
        </Button>
      )}
    </Stack>
  );
}

export function SessionsCard({
  instances,
  onActivateInstance,
  onKill,
  onStartNewInstance,
}: SessionsCardProps) {
  const live = instances.filter((i) => LIVE_STATUSES.has(i.status));
  const recent = instances
    .filter((i) => RECENT_STATUSES.has(i.status))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .slice(0, RECENT_CAP);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 1.5 }}>Sessions</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <ColumnHead label="Live" count={live.length} />
          {live.length === 0 ? (
            <EmptyState label="No live sessions" onStartNewInstance={onStartNewInstance} />
          ) : (
            <Stack spacing={1}>
              {live.map((i) => (
                <SessionRow key={i.id} instance={i} onOpen={onActivateInstance} onKill={onKill} />
              ))}
            </Stack>
          )}
        </Grid>

        <Grid item xs={12} md={6}>
          <ColumnHead label="Recent" count={recent.length} />
          {recent.length === 0 ? (
            <EmptyState label="No recent sessions" />
          ) : (
            <Stack spacing={1}>
              {recent.map((i) => (
                <SessionRow key={i.id} instance={i} onOpen={onActivateInstance} onKill={onKill} />
              ))}
            </Stack>
          )}
        </Grid>
      </Grid>
    </Paper>
  );
}
```

- [ ] **Step 11.2: Typecheck + commit**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head
git add client/src/components/dashboard/SessionsCard.tsx
git commit -m "feat(dashboard): SessionsCard — two-column Live | Recent"
```

---

## Task 12: `LastThirtyDays` component (heatmap + stats)

**Files:**
- Create: `client/src/components/dashboard/LastThirtyDays.tsx`

- [ ] **Step 12.1: Implement**

Create the file:

```tsx
import { Box, Grid, Paper, Stack, Typography } from '@mui/material';
import Heatmap from '../timetracker/charts/Heatmap.js';
import type { DashboardHeatmapStatsPayload } from '../../../../shared/ipcContract.js';
import { formatDateShortCz, formatHours } from '../../util/format.js';

export interface LastThirtyDaysProps {
  fromDate: string;
  toDate: string;
  days: { date: string; minutes: number }[];
  stats: DashboardHeatmapStatsPayload;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography sx={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    </Stack>
  );
}

export function LastThirtyDays({ fromDate, toDate, days, stats }: LastThirtyDaysProps) {
  const busiest = stats.busiestDay
    ? `${formatDateShortCz(stats.busiestDay.date)} (${formatHours(stats.busiestDay.minutes, 1)}h)`
    : '—';

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 1.5 }}>Last 30 days</Typography>
      <Grid container spacing={2} alignItems="flex-start">
        <Grid item xs={12} md={7}>
          <Box sx={{ minHeight: 140 }}>
            <Heatmap data={days} from={fromDate} to={toDate} showStats={false} />
          </Box>
        </Grid>
        <Grid item xs={12} md={5}>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Stat label="Current streak" value={`${stats.currentStreak}d`} />
            <Stat label="Longest streak" value={`${stats.longestStreak}d`} />
            <Stat label="Active days" value={String(stats.activeDays)} />
            <Stat label="Weekly avg" value={`${formatHours(stats.weeklyAvgMinutes, 1)}h`} />
            <Stat label="Busiest day" value={busiest} />
          </Stack>
        </Grid>
      </Grid>
    </Paper>
  );
}
```

- [ ] **Step 12.2: Typecheck + commit**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head
git add client/src/components/dashboard/LastThirtyDays.tsx
git commit -m "feat(dashboard): LastThirtyDays — heatmap + streak stats row"
```

---

## Task 13: `TopProjectsCard` component

**Files:**
- Create: `client/src/components/dashboard/TopProjectsCard.tsx`

- [ ] **Step 13.1: Implement**

Create the file:

```tsx
import { Box, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import type { DashboardTopProjectPayload } from '../../../../shared/ipcContract.js';
import { formatHours } from '../../util/format.js';

const ROW_CAP = 8;

export interface TopProjectsCardProps {
  projects: DashboardTopProjectPayload[];
}

export function TopProjectsCard({ projects }: TopProjectsCardProps) {
  const top = projects.slice(0, ROW_CAP);
  const max = top[0]?.minutes ?? 0;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 1.5 }}>Top projects this month</Typography>
      {top.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No projects with logged time this month.
        </Typography>
      ) : (
        <Stack spacing={1.25}>
          {top.map((p) => {
            const ratio = max > 0 ? (p.minutes / max) * 100 : 0;
            return (
              <Box key={p.projectId}>
                <Stack direction="row" alignItems="center" spacing={1.25}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: p.projectColor ?? 'primary.main' }} />
                  <Typography
                    sx={{
                      flex: 1, minWidth: 0,
                      fontSize: 13,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >
                    {p.projectName}
                  </Typography>
                  <Typography
                    sx={{ fontSize: 13, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatHours(p.minutes, 1)}h
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={ratio}
                  sx={{
                    mt: 0.5,
                    ml: '18px',
                    height: 4,
                    borderRadius: 1,
                    backgroundColor: 'background.default',
                    '& .MuiLinearProgress-bar': { backgroundColor: p.projectColor ?? 'primary.main' },
                  }}
                />
              </Box>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}
```

- [ ] **Step 13.2: Typecheck + commit**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head
git add client/src/components/dashboard/TopProjectsCard.tsx
git commit -m "feat(dashboard): TopProjectsCard — sorted top-projects list"
```

---

## Task 14: `DashboardHeader` component

**Files:**
- Create: `client/src/components/dashboard/DashboardHeader.tsx`

- [ ] **Step 14.1: Implement**

Create the file:

```tsx
import { Box, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { ProjectViewPayload } from '../../../../shared/ipcContract.js';
import { formatWeekdayDateLongCz } from '../../util/format.js';

export interface DashboardHeaderProps {
  projects: ProjectViewPayload[];
  projectId: number | null;
  onProjectChange(next: number | null): void;
  todayDate: string;
}

export function DashboardHeader({ projects, projectId, onProjectChange, todayDate }: DashboardHeaderProps) {
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
          label="Project"
          value={projectId ?? ''}
          onChange={(e) => onProjectChange(e.target.value === '' ? null : Number(e.target.value))}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">All projects</MenuItem>
          {projects.map((p) => (
            <MenuItem key={p.id} value={p.id}>
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

- [ ] **Step 14.2: Typecheck + commit**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head
git add client/src/components/dashboard/DashboardHeader.tsx
git commit -m "feat(dashboard): DashboardHeader — title + project filter + cs date"
```

---

## Task 15: `ModuleDashboard` composition root

**Files:**
- Create: `client/src/components/dashboard/ModuleDashboard.tsx`

- [ ] **Step 15.1: Implement the root**

Create the file:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Skeleton, Stack } from '@mui/material';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import { useDashboardOverview } from '../../state/useDashboardOverview.js';
import { useProjects } from '../../state/useProjects.js';
import { useToast } from '../../state/useToast.js';
import type { InstanceView } from '../../state/useInstances.js';
import { DashboardHeader } from './DashboardHeader.js';
import { KpiTiles } from './KpiTiles.js';
import { WeekStrip } from './WeekStrip.js';
import { SessionsCard } from './SessionsCard.js';
import { LastThirtyDays } from './LastThirtyDays.js';
import { TopProjectsCard } from './TopProjectsCard.js';

dayjs.extend(isoWeek);

const FILTER_KEY = 'watchtower.dashboard.projectId';

function todayIso(): string {
  return dayjs().format('YYYY-MM-DD');
}

function readPersistedProject(): number | null {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function persistProject(id: number | null) {
  try {
    if (id == null) localStorage.removeItem(FILTER_KEY);
    else localStorage.setItem(FILTER_KEY, String(id));
  } catch { /* best-effort */ }
}

export interface ModuleDashboardProps {
  instances: InstanceView[];
  onActivateInstance(id: string): void;
  onKillInstance(id: string): Promise<void>;
  onStartNewInstance(): void;
}

export function ModuleDashboard({
  instances,
  onActivateInstance,
  onKillInstance,
  onStartNewInstance,
}: ModuleDashboardProps) {
  const [today, setToday] = useState<string>(todayIso);
  const [weekAnchor, setWeekAnchor] = useState<string>(today);
  const [projectId, setProjectId] = useState<number | null>(readPersistedProject);
  const projectsState = useProjects();
  const { showError } = useToast();

  // Refresh today's date if the page outlives midnight.
  useEffect(() => {
    const t = setInterval(() => {
      const next = todayIso();
      setToday((curr) => (curr === next ? curr : next));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    persistProject(projectId);
  }, [projectId]);

  const overview = useDashboardOverview(projectId, weekAnchor, today);

  const projectList = useMemo(
    () => projectsState.projects.filter((p) => !p.archived),
    [projectsState.projects],
  );

  const handleKill = async (id: string) => {
    try {
      await onKillInstance(id);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'auto',
        px: 2.75,
        pb: 4,
        pt: 2.5,
      }}
    >
      <DashboardHeader
        projects={projectList}
        projectId={projectId}
        onProjectChange={setProjectId}
        todayDate={today}
      />

      {overview.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {overview.error}
        </Alert>
      )}

      <Stack spacing={2}>
        {overview.loading && !overview.data ? (
          <>
            <Skeleton variant="rounded" height={120} />
            <Skeleton variant="rounded" height={260} />
            <Skeleton variant="rounded" height={160} />
            <Skeleton variant="rounded" height={220} />
          </>
        ) : overview.data ? (
          <>
            <KpiTiles
              todayMinutes={overview.data.today.minutes}
              weekMinutes={overview.data.week.totalMinutes}
              monthMinutes={overview.data.month.minutes}
            />
            <WeekStrip
              week={overview.data.week}
              todayDate={today}
              onAnchorChange={setWeekAnchor}
            />
            <SessionsCard
              instances={instances}
              onActivateInstance={onActivateInstance}
              onKill={handleKill}
              onStartNewInstance={onStartNewInstance}
            />
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <Box sx={{ flex: 2, minWidth: 0 }}>
                <LastThirtyDays {...overview.data.heatmap30d} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <TopProjectsCard projects={overview.data.topProjects} />
              </Box>
            </Stack>
          </>
        ) : null}
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 15.2: Typecheck + commit**

```bash
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head
git add client/src/components/dashboard/ModuleDashboard.tsx
git commit -m "feat(dashboard): ModuleDashboard composition root"
```

---

## Task 16: Wire `ModuleDashboard` into `App.tsx`

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 16.1: Import the module**

Near the existing module imports in `App.tsx` (`ModuleTimeTracker`, `ModuleSettings`), add:

```ts
import { ModuleDashboard } from './components/dashboard/ModuleDashboard.js';
```

- [ ] **Step 16.2: Replace the placeholder render branch with the real module**

Find the placeholder added in Task 6 ("Dashboard module — wiring in progress") and replace the dashboard ternary branch with:

```tsx
{activeModule === 'dashboard' ? (
  <ModuleDashboard
    instances={instances}
    onActivateInstance={switchToInstance}
    onKillInstance={(id) => kill(id)}
    onStartNewInstance={() => setNewOpen(true)}
  />
) : activeModule === 'settings' ? (
```

The `instances`, `switchToInstance`, `kill`, and `setNewOpen` symbols already exist in `App.tsx` from earlier phases. Verify by searching for them — if any are missing, grep `client/src/App.tsx` for `useInstances` and `setNewOpen` to confirm they're already destructured.

- [ ] **Step 16.3: Run dev server, click through the dashboard**

```bash
npm run dev
```

Manual smoke checklist:
- Dashboard is the default landing module on first launch.
- KPIs show non-zero values if you have worklogs.
- Week strip shows the current ISO week; today's cell has a red border.
- Prev/Next chevrons shift the week 7 days; "Today" snaps back.
- Pick-a-week popover snaps to Monday of the picked week.
- Sessions card lists Live + Recent; Open jumps to Instances + focuses; Kill drops the instance.
- "Start a new instance" button (Live empty state) opens the new-instance modal.
- Last 30 days heatmap renders; stats show streaks etc.
- Top projects this month sorted desc.
- Project filter narrows KPIs / week / heatmap / top-projects but does NOT filter Sessions.
- Closing + relaunching the app remembers the last-active module.

- [ ] **Step 16.4: Final typecheck + full test suite**

```bash
npx tsc -p electron/tsconfig.json --noEmit
npx tsc -p orchestrator/tsconfig.json --noEmit
npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "TS6133\|TS5023\|rootDir\|slotProps\|useInstances.spawn" | head -30
npm test -- --run
```

Expected: electron + orchestrator typecheck clean; client typecheck shows only the pre-existing drift documented in `CLAUDE.md` (filtered by grep); vitest shows the previous count + 15 new dashboard tests (11 service + 4 hook).

- [ ] **Step 16.5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(dashboard): wire ModuleDashboard into App + finish module"
```

---

## Self-review checklist (mark done after completing)

- [ ] **Spec coverage** — every bullet in the spec's "In scope" list has a task that implements it (KPIs/week/sessions/heatmap/top-projects/header/project-filter/default-landing/persistence — all covered).
- [ ] **Placeholder scan** — no `TODO`, `TBD`, "fill in later", or "similar to" references inside steps; every code step has the full code body.
- [ ] **Type consistency** — `DashboardOverviewResponsePayload` / `DashboardWeekDayPayload` / `DashboardHeatmapStatsPayload` / `DashboardTopProjectPayload` names match between Task 1, Task 2, Task 4, Tasks 12–15.
- [ ] **Test count baseline** — `npm test -- --run` total ≥ existing baseline + 15.
- [ ] **No bypassed hooks** — every `git commit` uses the normal pre-commit hook (pre-commit runs typecheck per project convention; no `--no-verify`).
