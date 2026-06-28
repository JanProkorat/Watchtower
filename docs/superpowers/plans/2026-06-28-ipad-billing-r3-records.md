# iPad Billing R3 (Records) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the read-only iPad billing module with a **Záznamy** (Records) section — worklog list, monthly task grid, time-off calendar — and refactor billing navigation from top tabs to a left section sidebar.

**Architecture:** New pure aggregation in `packages/shared/src/billing/records/` + an iPad time-off model; three plain-React views; a `BillingNav` sidebar replacing `BillingModule`'s top-tab bar. One additive data field (`source`) on the synced worklog rows. All views read the already-cached `BillingDataset` — no orchestrator/sync changes beyond the `source` column.

**Tech Stack:** TypeScript, React (apps/ipad, no MUI, no charting/calendar lib), `@watchtower/shared` (composite build), vitest (logic-only).

**Spec:** `docs/superpowers/specs/2026-06-28-ipad-billing-r3-records-design.md`

> **Note:** The R2→CZK-only reconciliation (commit `fa95fca`) already landed on this branch; `tsc -b packages/shared` is green. Build R3 on top.

## Global Constraints

- **Read-only.** No writes/mutations/edit affordances (no popovers, drawers, or day-marking).
- **Reads the cached `BillingDataset` only.** The only data-plane change is adding `source` to the worklog `select` + `RawWorklogRow` + `mapWorklogRow` + `WorklogRow` (the column already exists in Supabase).
- **CZK-only (post-#108):** no currency field; every `earnedAmount` is CZK; earnings sum `earnedAmount != null`.
- **Tracked minutes (`minutes`) are the primary number;** grid earnings use `earnedAmount`. No tracked/reported toggle.
- **Task Grid = logged-time grid:** only tasks with logs in the month (row identity `(projectId, taskNumber)`; null taskNumber → one "(bez úkolu)" row per project); no estimates/status/capacity.
- **apps/ipad:** plain React + inline styles, no MUI, no charting/calendar lib; cs-CZ via `czFormat` + `monthHelpers` (`czechMonthLabel`, `addMonths`, `czechHolidays`); no i18n.
- **`@watchtower/shared` is `packages/shared/`**, subpath `.js` imports, no barrel; run `npx tsc -b packages/shared/tsconfig.json` after adding shared files.
- **No `Date.now()`/implicit-`new Date()` inside pure fns** — `today`/`month` passed in.
- **iPad tests are logic-only** (no DOM). UI verifies via typecheck.
- Never edit `.env*`; don't commit build output. Branch `feat/ipad-billing-r3`. Commit with explicit `git add <paths>` — never `git add -A`/`.` (unrelated untracked files exist).

## File Structure

**`packages/shared/src/billing/`:**
- `types.ts` (modify) — add `source` to `WorklogRow`.
- `records/worklog-list.ts` (new) — `groupWorklogsByDay`.
- `records/task-grid.ts` (new) — `buildTaskGrid`.

**`apps/ipad/src/`:**
- `state/billingCache.ts` (modify) — `RawWorklogRow.source` + map it.
- `state/useBilling.ts` (modify) — add `source` to the worklog `select`.
- `state/timeOffModel.ts` (new) — `buildTimeOffModel`.
- `components/billing/BillingNav.tsx` (new) — left section sidebar.
- `components/billing/BillingModule.tsx` (modify) — section state + content switch.
- `components/billing/records/{WorklogListView,TaskGridView,TimeOffView}.tsx` (new).

**Tests:** `tests/shared/billing/records/{worklog-list,task-grid}.test.ts`; `tests/ipad/timeOffModel.test.ts`; extend `tests/ipad/billingCache.test.ts`.

---

## Task 1: Add `source` to worklog rows

**Files:**
- Modify: `packages/shared/src/billing/types.ts`
- Modify: `apps/ipad/src/state/billingCache.ts`
- Modify: `apps/ipad/src/state/useBilling.ts`
- Test: `tests/ipad/billingCache.test.ts` (extend)

**Interfaces:**
- Produces: `WorklogRow.source: string | null`.

- [ ] **Step 1: Write the failing test** (append to `tests/ipad/billingCache.test.ts`)

```ts
import { mapWorklogRow } from '../../apps/ipad/src/state/billingCache.js';

describe('mapWorklogRow source', () => {
  const base = {
    sync_id: 's1', work_date: '2026-06-01', minutes: 60, effective_minutes: 60,
    earned_amount: 1000,
    tasks: { number: 'X-1', title: 'T', epics: { projects: { id: 1, name: 'P', color: '#fff', kind: 'work', is_billable: true } } },
  };

  it('maps the source field', () => {
    expect(mapWorklogRow({ ...base, source: 'jira-sync' } as never).source).toBe('jira-sync');
  });

  it('defaults a missing source to null', () => {
    expect(mapWorklogRow(base as never).source).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npx vitest run tests/ipad/billingCache.test.ts`
Expected: FAIL — `source` missing on the mapped row (type/runtime).

- [ ] **Step 3: Implement**

In `packages/shared/src/billing/types.ts`, add to `WorklogRow` (after `taskTitle`):
```ts
  source: string | null;     // 'manual' | 'watchtower-auto' | 'jira-sync' | null
```

In `apps/ipad/src/state/billingCache.ts`: add `source: string | null;` to `RawWorklogRow`, and in `mapWorklogRow`'s returned object add:
```ts
    source: raw.source ?? null,
```
Also update the embedded-select comment to include `source`.

In `apps/ipad/src/state/useBilling.ts`, change the worklog `.select(...)` string to include `source`:
```ts
        .select(
          'sync_id,work_date,minutes,effective_minutes,earned_amount,source,' +
            'tasks(number,title,epics(projects(id,name,color,kind,is_billable)))',
        )
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npx vitest run tests/ipad/billingCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Build shared + commit**

```bash
npx tsc -b packages/shared/tsconfig.json
git add packages/shared/src/billing/types.ts apps/ipad/src/state/billingCache.ts apps/ipad/src/state/useBilling.ts tests/ipad/billingCache.test.ts
git commit -m "feat(ipad-r3): sync worklog source field"
```

---

## Task 2: `groupWorklogsByDay` (shared)

**Files:**
- Create: `packages/shared/src/billing/records/worklog-list.ts`
- Test: `tests/shared/billing/records/worklog-list.test.ts`

**Interfaces:**
- Consumes: `WorklogRow` from `../types.js`.
- Produces: `interface WorklogDay { date: string; totalMinutes: number; entries: WorklogRow[] }`; `groupWorklogsByDay(rows: WorklogRow[], opts: { month: string; projectId?: number }): WorklogDay[]` (days **descending**; `totalMinutes` = Σ tracked `minutes`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/billing/records/worklog-list.test.ts
import { describe, it, expect } from 'vitest';
import { groupWorklogsByDay } from '../../../../packages/shared/src/billing/records/worklog-list.js';
import type { WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, projectId: 1, projectName: 'P1', projectColor: '#fff',
    projectKind: 'work', isBillable: true, taskNumber: 'X-1', taskTitle: 'T',
    source: 'manual', ...over,
  };
}

describe('groupWorklogsByDay', () => {
  it('groups by day descending with tracked-minute totals', () => {
    const rows = [
      wl({ workDate: '2026-06-01', minutes: 60 }),
      wl({ workDate: '2026-06-01', minutes: 30 }),
      wl({ workDate: '2026-06-03', minutes: 45 }),
    ];
    const out = groupWorklogsByDay(rows, { month: '2026-06' });
    expect(out.map((d) => d.date)).toEqual(['2026-06-03', '2026-06-01']);
    expect(out[0].totalMinutes).toBe(45);
    expect(out[1].totalMinutes).toBe(90);
    expect(out[1].entries).toHaveLength(2);
  });

  it('filters by month and project', () => {
    const rows = [
      wl({ workDate: '2026-05-31', minutes: 60 }),
      wl({ workDate: '2026-06-02', projectId: 2, minutes: 60 }),
      wl({ workDate: '2026-06-02', projectId: 1, minutes: 15 }),
    ];
    const out = groupWorklogsByDay(rows, { month: '2026-06', projectId: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].totalMinutes).toBe(15);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/shared/billing/records/worklog-list.test.ts` (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/billing/records/worklog-list.ts
import type { WorklogRow } from '../types.js';

export interface WorklogDay {
  date: string;
  totalMinutes: number;
  entries: WorklogRow[];
}

export function groupWorklogsByDay(
  rows: WorklogRow[],
  opts: { month: string; projectId?: number },
): WorklogDay[] {
  const { month, projectId } = opts;
  const byDate = new Map<string, WorklogDay>();
  for (const r of rows) {
    if (r.workDate.slice(0, 7) !== month) continue;
    if (projectId !== undefined && r.projectId !== projectId) continue;
    const day = byDate.get(r.workDate) ?? { date: r.workDate, totalMinutes: 0, entries: [] };
    day.totalMinutes += r.minutes;
    day.entries.push(r);
    byDate.set(r.workDate, day);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Build + commit**

```bash
npx tsc -b packages/shared/tsconfig.json
git add packages/shared/src/billing/records/worklog-list.ts tests/shared/billing/records/worklog-list.test.ts
git commit -m "feat(ipad-r3): groupWorklogsByDay shared fn"
```

---

## Task 3: `buildTaskGrid` (shared)

**Files:**
- Create: `packages/shared/src/billing/records/task-grid.ts`
- Test: `tests/shared/billing/records/task-grid.test.ts`

**Interfaces:**
- Consumes: `WorklogRow` from `../types.js`.
- Produces:
  - `interface TaskGridRow { key: string; projectId: number; taskNumber: string | null; taskTitle: string | null; projectColor: string | null; perDay: number[] }` (`perDay` length = daysInMonth, minutes)
  - `interface TaskGridResult { tasks: TaskGridRow[]; dailyTotals: number[]; dailyEarnings: number[]; monthTotalMinutes: number; monthTotalCzk: number; daysInMonth: number }`
  - `buildTaskGrid(rows: WorklogRow[], opts: { month: string; projectId?: number }): TaskGridResult`

Row identity `(projectId, taskNumber)` (null taskNumber → key `${projectId}:`); rows sorted by projectId then `taskNumber` natural-numeric. Cells/totals in minutes; earnings sum `earnedAmount`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/billing/records/task-grid.test.ts
import { describe, it, expect } from 'vitest';
import { buildTaskGrid } from '../../../../packages/shared/src/billing/records/task-grid.js';
import type { WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, projectId: 1, projectName: 'P1', projectColor: '#fff',
    projectKind: 'work', isBillable: true, taskNumber: 'X-1', taskTitle: 'T',
    source: 'manual', ...over,
  };
}

describe('buildTaskGrid', () => {
  it('builds tasks×days with per-day minutes, totals, and CZK earnings', () => {
    const rows = [
      wl({ taskNumber: 'X-2', workDate: '2026-06-01', minutes: 60, earnedAmount: 1000 }),
      wl({ taskNumber: 'X-2', workDate: '2026-06-02', minutes: 30, earnedAmount: 500 }),
      wl({ taskNumber: 'X-10', workDate: '2026-06-01', minutes: 45, earnedAmount: 750 }),
    ];
    const g = buildTaskGrid(rows, { month: '2026-06' });
    expect(g.daysInMonth).toBe(30);
    // natural-numeric sort: X-2 before X-10
    expect(g.tasks.map((t) => t.taskNumber)).toEqual(['X-2', 'X-10']);
    expect(g.tasks[0].perDay[0]).toBe(60); // X-2, June 1
    expect(g.tasks[0].perDay[1]).toBe(30); // X-2, June 2
    expect(g.dailyTotals[0]).toBe(105);    // 60 + 45
    expect(g.dailyEarnings[0]).toBe(1750); // 1000 + 750
    expect(g.monthTotalMinutes).toBe(135);
    expect(g.monthTotalCzk).toBe(2250);
  });

  it('buckets null taskNumber into one row per project and filters month/project', () => {
    const rows = [
      wl({ projectId: 1, taskNumber: null, workDate: '2026-06-05', minutes: 20 }),
      wl({ projectId: 2, taskNumber: 'Y-1', workDate: '2026-06-05', minutes: 60 }),
      wl({ taskNumber: 'X-1', workDate: '2026-05-30', minutes: 99 }),
    ];
    const g = buildTaskGrid(rows, { month: '2026-06', projectId: 1 });
    expect(g.tasks).toHaveLength(1);
    expect(g.tasks[0].taskNumber).toBeNull();
    expect(g.tasks[0].perDay[4]).toBe(20); // June 5
    expect(g.monthTotalMinutes).toBe(20);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/billing/records/task-grid.ts
import type { WorklogRow } from '../types.js';

export interface TaskGridRow {
  key: string;
  projectId: number;
  taskNumber: string | null;
  taskTitle: string | null;
  projectColor: string | null;
  perDay: number[];
}

export interface TaskGridResult {
  tasks: TaskGridRow[];
  dailyTotals: number[];
  dailyEarnings: number[];
  monthTotalMinutes: number;
  monthTotalCzk: number;
  daysInMonth: number;
}

export function buildTaskGrid(
  rows: WorklogRow[],
  opts: { month: string; projectId?: number },
): TaskGridResult {
  const { month, projectId } = opts;
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of m

  const byTask = new Map<string, TaskGridRow>();
  const dailyTotals = new Array<number>(daysInMonth).fill(0);
  const dailyEarnings = new Array<number>(daysInMonth).fill(0);
  let monthTotalMinutes = 0;
  let monthTotalCzk = 0;

  for (const r of rows) {
    if (r.workDate.slice(0, 7) !== month) continue;
    if (projectId !== undefined && r.projectId !== projectId) continue;
    const dayIdx = Number(r.workDate.slice(8, 10)) - 1;
    const key = `${r.projectId}:${r.taskNumber ?? ''}`;
    const row =
      byTask.get(key) ??
      {
        key,
        projectId: r.projectId,
        taskNumber: r.taskNumber,
        taskTitle: r.taskTitle,
        projectColor: r.projectColor,
        perDay: new Array<number>(daysInMonth).fill(0),
      };
    row.perDay[dayIdx] += r.minutes;
    byTask.set(key, row);

    dailyTotals[dayIdx] += r.minutes;
    monthTotalMinutes += r.minutes;
    if (r.earnedAmount != null) {
      dailyEarnings[dayIdx] += r.earnedAmount;
      monthTotalCzk += r.earnedAmount;
    }
  }

  const tasks = [...byTask.values()].sort((a, b) =>
    a.projectId !== b.projectId
      ? a.projectId - b.projectId
      : (a.taskNumber ?? '').localeCompare(b.taskNumber ?? '', undefined, { numeric: true }),
  );

  return { tasks, dailyTotals, dailyEarnings, monthTotalMinutes, monthTotalCzk, daysInMonth };
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Build + commit**

```bash
npx tsc -b packages/shared/tsconfig.json
git add packages/shared/src/billing/records/task-grid.ts tests/shared/billing/records/task-grid.test.ts
git commit -m "feat(ipad-r3): buildTaskGrid shared fn"
```

---

## Task 4: `buildTimeOffModel` (iPad state)

**Files:**
- Create: `apps/ipad/src/state/timeOffModel.ts`
- Test: `tests/ipad/timeOffModel.test.ts`

**Interfaces:**
- Consumes: `DayOffRow` from `@watchtower/shared/billing/types.js`; `czechHolidays`, `czechMonthLabel`, `addMonths` from `../lib/monthHelpers.js`.
- Produces:
  - `type TimeOffKind = 'vacation' | 'sick' | 'other' | 'holiday'`
  - `interface CalDay { date: string | null; kind: TimeOffKind | null; isWeekend: boolean }` (`date: null` = padding cell)
  - `interface MonthCal { month: string; label: string; weeks: CalDay[][] }` (Monday-first, 7 columns)
  - `interface UpcomingItem { date: string; kind: TimeOffKind; note: string | null }`
  - `interface TimeOffModel { months: MonthCal[]; upcoming: UpcomingItem[] }`
  - `buildTimeOffModel(focusMonth: string, daysOff: DayOffRow[], today: string): TimeOffModel`

3-month window (`focusMonth-1 … focusMonth+1`); user `days_off` win over holidays; upcoming = future (≥ today) days_off ∪ holidays for the focus year and next year, deduped by date (user wins), sorted ascending, capped at 30.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ipad/timeOffModel.test.ts
import { describe, it, expect } from 'vitest';
import { buildTimeOffModel } from '../../apps/ipad/src/state/timeOffModel.js';
import type { DayOffRow } from '@watchtower/shared/billing/types.js';

describe('buildTimeOffModel', () => {
  it('produces a 3-month window centered on focus', () => {
    const m = buildTimeOffModel('2026-06', [], '2026-06-15');
    expect(m.months.map((x) => x.month)).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(m.months[1].weeks[0]).toHaveLength(7); // 7 columns
  });

  it('marks a user day off, and user wins over a holiday on the same date', () => {
    const daysOff: DayOffRow[] = [
      { date: '2026-07-06', kind: 'vacation' }, // 2026-07-06 is a Czech holiday (Cyril & Methodius)
    ];
    const m = buildTimeOffModel('2026-07', daysOff, '2026-07-01');
    const julCells = m.months.find((x) => x.month === '2026-07')!.weeks.flat();
    const cell = julCells.find((c) => c.date === '2026-07-06')!;
    expect(cell.kind).toBe('vacation'); // user wins
  });

  it('builds an upcoming list of future items, user-wins dedupe, ascending', () => {
    const daysOff: DayOffRow[] = [{ date: '2026-07-06', kind: 'sick' }];
    const m = buildTimeOffModel('2026-06', daysOff, '2026-06-15');
    // first upcoming holiday after 2026-06-15 is 2026-07-05 (holiday), then 2026-07-06 (user 'sick', not 'holiday')
    const item0706 = m.upcoming.find((u) => u.date === '2026-07-06')!;
    expect(item0706.kind).toBe('sick');
    // sorted ascending
    const dates = m.upcoming.map((u) => u.date);
    expect([...dates]).toEqual([...dates].sort());
    // all future
    expect(m.upcoming.every((u) => u.date >= '2026-06-15')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/ipad/src/state/timeOffModel.ts
import type { DayOffRow } from '@watchtower/shared/billing/types.js';
import { czechHolidays, czechMonthLabel, addMonths } from '../lib/monthHelpers.js';

export type TimeOffKind = 'vacation' | 'sick' | 'other' | 'holiday';
export interface CalDay { date: string | null; kind: TimeOffKind | null; isWeekend: boolean }
export interface MonthCal { month: string; label: string; weeks: CalDay[][] }
export interface UpcomingItem { date: string; kind: TimeOffKind; note: string | null }
export interface TimeOffModel { months: MonthCal[]; upcoming: UpcomingItem[] }

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function normalizeKind(k: string): TimeOffKind {
  return k === 'vacation' || k === 'sick' || k === 'other' ? k : 'other';
}

function buildMonth(month: string, daysOff: Map<string, TimeOffKind>, holidays: Map<string, string>): MonthCal {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Monday-first leading pad: JS getUTCDay() Sun=0..Sat=6 → Mon=0..Sun=6
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

  const cells: CalDay[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ date: null, kind: null, isWeekend: false });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${y}-${pad2(m)}-${pad2(d)}`;
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const kind: TimeOffKind | null = daysOff.get(date) ?? (holidays.has(date) ? 'holiday' : null);
    cells.push({ date, kind, isWeekend });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, kind: null, isWeekend: false });

  const weeks: CalDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { month, label: czechMonthLabel(month), weeks };
}

export function buildTimeOffModel(focusMonth: string, daysOff: DayOffRow[], today: string): TimeOffModel {
  const userByDate = new Map<string, TimeOffKind>();
  for (const d of daysOff) userByDate.set(d.date, normalizeKind(d.kind));

  const focusYear = Number(focusMonth.slice(0, 4));
  const holidays = new Map<string, string>();
  for (const yr of [focusYear - 1, focusYear, focusYear + 1]) {
    for (const [date, name] of czechHolidays(yr)) holidays.set(date, name);
  }

  const months = [addMonths(focusMonth, -1), focusMonth, addMonths(focusMonth, 1)].map((mm) =>
    buildMonth(mm, userByDate, holidays),
  );

  // Upcoming: future user days_off ∪ holidays (focus year + next), user wins, asc, cap 30.
  const upcomingByDate = new Map<string, UpcomingItem>();
  for (const yr of [focusYear, focusYear + 1]) {
    for (const [date, name] of czechHolidays(yr)) {
      if (date >= today) upcomingByDate.set(date, { date, kind: 'holiday', note: name });
    }
  }
  for (const [date, kind] of userByDate) {
    if (date >= today) upcomingByDate.set(date, { date, kind, note: null }); // user wins
  }
  const upcoming = [...upcomingByDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, 30);

  return { months, upcoming };
}
```

- [ ] **Step 4: Run it, expect PASS.** `npx vitest run tests/ipad/timeOffModel.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/timeOffModel.ts tests/ipad/timeOffModel.test.ts
git commit -m "feat(ipad-r3): buildTimeOffModel (3-month calendar + upcoming)"
```

---

## Task 5: `BillingNav` sidebar + `BillingModule` refactor

**Files:**
- Create: `apps/ipad/src/components/billing/BillingNav.tsx`
- Modify: `apps/ipad/src/components/billing/BillingModule.tsx`

**Interfaces:**
- Produces: `type BillingSection = 'dashboard' | 'earnings' | 'reports' | 'records-list' | 'records-grid' | 'records-timeoff'`; `BillingNav` component.

`BillingModule` swaps its `activeTab` tab-bar for a left `BillingNav` sidebar (sections + Records sub-items) beside the content. R1/R2 views render unchanged for their sections; the three `records-*` sections render placeholders in THIS task (the views arrive in Tasks 6–8, wired in Task 9). Sign-out moves into the sidebar footer. `selectedProject` drill-in unchanged; selecting any section clears it.

- [ ] **Step 1: Implement `BillingNav.tsx`**

```tsx
// apps/ipad/src/components/billing/BillingNav.tsx
import { useState } from 'react';
import { C } from './reports/tokens.js';

export type BillingSection =
  | 'dashboard' | 'earnings' | 'reports'
  | 'records-list' | 'records-grid' | 'records-timeoff';

const STORAGE_KEY = 'watchtower.ipad.billing.nav.expanded';

interface Props {
  active: BillingSection;
  onSelect(s: BillingSection): void;
  onSignOut(): void;
}

const TOP: { id: BillingSection; label: string }[] = [
  { id: 'dashboard', label: 'Přehled' },
  { id: 'earnings', label: 'Výdělky' },
  { id: 'reports', label: 'Reporty' },
];
const RECORDS: { id: BillingSection; label: string }[] = [
  { id: 'records-list', label: 'Seznam' },
  { id: 'records-grid', label: 'Mřížka' },
  { id: 'records-timeoff', label: 'Volno' },
];

function readExpanded(): boolean {
  try { const v = localStorage.getItem(STORAGE_KEY); return v === null ? true : v === '1'; } catch { return true; }
}

function itemStyle(active: boolean, indent = false): React.CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left',
    padding: indent ? '7px 14px 7px 28px' : '8px 14px',
    border: 'none', borderRadius: 8, cursor: 'pointer',
    fontFamily: 'system-ui, sans-serif', fontSize: indent ? 13 : 14, fontWeight: 600,
    background: active ? '#2d2857' : 'transparent',
    color: active ? '#a89cf0' : '#9ca3af',
  };
}

export function BillingNav({ active, onSelect, onSignOut }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(readExpanded);
  const toggle = () => setExpanded((e) => { const n = !e; try { localStorage.setItem(STORAGE_KEY, n ? '1' : '0'); } catch { /* ignore */ } return n; });

  if (!expanded) {
    return (
      <div style={{ flexShrink: 0, width: 44, borderRight: `1px solid ${C.border}`, background: '#13141a', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0' }}>
        <button onClick={toggle} title="Rozbalit" style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18 }}>›</button>
      </div>
    );
  }

  return (
    <div style={{ flexShrink: 0, width: 184, borderRight: `1px solid ${C.border}`, background: '#13141a', display: 'flex', flexDirection: 'column', padding: '10px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 8px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase' }}>Billing</span>
        <button onClick={toggle} title="Sbalit" style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}>‹</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {TOP.map((s) => (
          <button key={s.id} style={itemStyle(active === s.id)} onClick={() => onSelect(s.id)}>{s.label}</button>
        ))}
        <div style={{ ...itemStyle(false), color: C.muted, cursor: 'default', fontSize: 12 }}>Záznamy</div>
        {RECORDS.map((s) => (
          <button key={s.id} style={itemStyle(active === s.id, true)} onClick={() => onSelect(s.id)}>{s.label}</button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <button onClick={onSignOut} style={{ ...itemStyle(false), color: '#6b7280', fontSize: 12 }}>Odhlásit</button>
    </div>
  );
}
```

- [ ] **Step 2: Refactor `BillingModule.tsx`**

Replace the whole file body with the sidebar layout (keep `loading`/`out`/`selectedProject` handling):

```tsx
import { useState } from 'react';
import { useSupabaseAuth } from '../../state/useSupabaseAuth.js';
import { BillingLogin } from './BillingLogin.js';
import { DashboardView } from './DashboardView.js';
import { EarningsMonthView } from './EarningsMonthView.js';
import { ProjectDetailView } from './ProjectDetailView.js';
import { ReportsView } from './ReportsView.js';
import { BillingNav, type BillingSection } from './BillingNav.js';

export function BillingModule(): JSX.Element {
  const { status, signIn, signOut } = useSupabaseAuth();
  const [section, setSection] = useState<BillingSection>('dashboard');
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  if (status === 'loading') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 15, fontFamily: 'system-ui, sans-serif' }}>
        Načítání…
      </div>
    );
  }
  if (status === 'out') return <BillingLogin signIn={signIn} />;

  if (selectedProject !== null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        <ProjectDetailView projectId={selectedProject} onBack={() => setSelectedProject(null)} />
      </div>
    );
  }

  const openProject = (id: number) => setSelectedProject(id);
  const select = (s: BillingSection) => { setSection(s); setSelectedProject(null); };

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <BillingNav active={section} onSelect={select} onSignOut={() => void signOut()} />
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {section === 'dashboard' && <DashboardView />}
        {section === 'earnings' && <EarningsMonthView onOpenProject={openProject} />}
        {section === 'reports' && <ReportsView onOpenProject={openProject} />}
        {section === 'records-list' && <Placeholder label="Seznam (Task 6)" />}
        {section === 'records-grid' && <Placeholder label="Mřížka (Task 7)" />}
        {section === 'records-timeoff' && <Placeholder label="Volno (Task 8)" />}
      </div>
    </div>
  );
}

function Placeholder({ label }: { label: string }): JSX.Element {
  return <div style={{ padding: 24, color: '#8B88A6', fontFamily: 'system-ui, sans-serif' }}>{label}</div>;
}
```

- [ ] **Step 3: Typecheck both projects**

Run: `npx tsc -b packages/shared/tsconfig.json && npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: no new errors referencing `BillingNav.tsx`/`BillingModule.tsx`.

- [ ] **Step 4: Verify R1/R2 still render** — confirm `dashboard`/`earnings`/`reports` sections mount their existing views and `onOpenProject` still drills into `ProjectDetailView` (read the switch; the three prior views and the project-detail overlay are unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/components/billing/BillingNav.tsx apps/ipad/src/components/billing/BillingModule.tsx
git commit -m "feat(ipad-r3): billing left section sidebar (replaces top tabs)"
```

---

## Task 6: `WorklogListView` (UI)

**Files:**
- Create: `apps/ipad/src/components/billing/records/WorklogListView.tsx`

**Interfaces:**
- Consumes: `useBilling`; `groupWorklogsByDay` from `@watchtower/shared/billing/records/worklog-list.js`; `addMonths`, `czechMonthLabel` from `../../../lib/monthHelpers.js`; `formatHours`, `formatDateCz` from `../../../lib/czFormat.js`; `C` from `../reports/tokens.js`.
- Produces: `WorklogListView` (no props).

```tsx
// apps/ipad/src/components/billing/records/WorklogListView.tsx
import { useState } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { groupWorklogsByDay } from '@watchtower/shared/billing/records/worklog-list.js';
import { addMonths, czechMonthLabel } from '../../../lib/monthHelpers.js';
import { formatHours, formatDateCz } from '../../../lib/czFormat.js';
import { C } from '../reports/tokens.js';

const SOURCE_LABEL: Record<string, string> = { manual: 'manual', 'watchtower-auto': 'watchtower', 'jira-sync': 'jira' };

export function WorklogListView(): JSX.Element {
  const { data } = useBilling();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];
  const [projectId, setProjectId] = useState<number | undefined>(undefined);

  const days = groupWorklogsByDay(worklogs, { month, projectId });

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: C.ground, minHeight: '100%', color: C.text }}>
      <MonthBar month={month} onPrev={() => setMonth(addMonths(month, -1))} onNext={() => setMonth(addMonths(month, 1))} onToday={() => setMonth(new Date().toISOString().slice(0, 7))} projects={projects} projectId={projectId} onProject={setProjectId} />
      <div style={{ padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {days.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>žádné záznamy</div>}
        {days.map((d) => (
          <div key={d.date}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{formatDateCz(d.date)}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{formatHours(d.totalMinutes)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {d.entries.map((w) => (
                <div key={w.syncId} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px' }}>
                  {w.projectColor && <div style={{ width: 8, height: 8, borderRadius: '50%', background: w.projectColor, flexShrink: 0 }} />}
                  {w.taskNumber && <div style={{ fontFamily: 'monospace', fontSize: 12, color: C.muted, flexShrink: 0 }}>{w.taskNumber}</div>}
                  <div style={{ flex: 1, fontSize: 13, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.taskTitle || w.projectName}</div>
                  {w.source && <div style={{ fontSize: 10, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase', flexShrink: 0 }}>{SOURCE_LABEL[w.source] ?? w.source}</div>}
                  <div style={{ fontSize: 12, color: C.text, flexShrink: 0 }}>
                    {formatHours(w.minutes)}
                    {w.effectiveMinutes !== w.minutes && <span style={{ color: C.muted }}> → {formatHours(w.effectiveMinutes)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthBar({ month, onPrev, onNext, onToday, projects, projectId, onProject }: {
  month: string; onPrev(): void; onNext(): void; onToday(): void;
  projects: { id: number; name: string }[]; projectId: number | undefined; onProject(id: number | undefined): void;
}): JSX.Element {
  const btn: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '4px 10px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.ground, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button style={btn} onClick={onPrev}>‹</button>
      <div style={{ fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{czechMonthLabel(month)}</div>
      <button style={btn} onClick={onNext}>›</button>
      <button style={btn} onClick={onToday}>Dnes</button>
      <div style={{ flex: 1 }} />
      <select value={projectId ?? ''} onChange={(e) => onProject(e.target.value === '' ? undefined : Number(e.target.value))} style={{ ...btn }}>
        <option value="">Všechny projekty</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name || '(bez názvu)'}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** — `npx tsc -p apps/ipad/tsconfig.json --noEmit` (no new errors in `WorklogListView.tsx`).
- [ ] **Step 3: Commit** — `git add apps/ipad/src/components/billing/records/WorklogListView.tsx && git commit -m "feat(ipad-r3): WorklogListView (Seznam)"`

---

## Task 7: `TaskGridView` (UI)

**Files:**
- Create: `apps/ipad/src/components/billing/records/TaskGridView.tsx`

**Interfaces:**
- Consumes: `useBilling`; `buildTaskGrid` from `@watchtower/shared/billing/records/task-grid.js`; `addMonths`, `czechMonthLabel` from `../../../lib/monthHelpers.js`; `formatHours`, `formatCzk` from `../../../lib/czFormat.js`; `C` from `../reports/tokens.js`.
- Produces: `TaskGridView` (no props).

```tsx
// apps/ipad/src/components/billing/records/TaskGridView.tsx
import { useState } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { buildTaskGrid } from '@watchtower/shared/billing/records/task-grid.js';
import { addMonths, czechMonthLabel } from '../../../lib/monthHelpers.js';
import { formatHours, formatCzk } from '../../../lib/czFormat.js';
import { C } from '../reports/tokens.js';

const CELL = 34; // px per day column

export function TaskGridView(): JSX.Element {
  const { data } = useBilling();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];

  const g = buildTaskGrid(worklogs, { month, projectId });
  const dayHeaders = Array.from({ length: g.daysInMonth }, (_, i) => i + 1);
  const hrs = (min: number) => (min === 0 ? '' : (min / 60).toFixed(1).replace('.', ','));

  const btn: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '4px 10px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
  const cellBase: React.CSSProperties = { width: CELL, minWidth: CELL, textAlign: 'center', fontSize: 11, borderLeft: `1px solid ${C.border}` };
  const nameCol: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: C.ground, minWidth: 180, maxWidth: 180, paddingRight: 8 };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: C.ground, minHeight: '100%', color: C.text, display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 11, background: C.ground, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button style={btn} onClick={() => setMonth(addMonths(month, -1))}>‹</button>
        <div style={{ fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{czechMonthLabel(month)}</div>
        <button style={btn} onClick={() => setMonth(addMonths(month, 1))}>›</button>
        <button style={btn} onClick={() => setMonth(new Date().toISOString().slice(0, 7))}>Dnes</button>
        <div style={{ flex: 1 }} />
        <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value === '' ? undefined : Number(e.target.value))} style={btn}>
          <option value="">Všechny projekty</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name || '(bez názvu)'}</option>)}
        </select>
      </div>

      {g.tasks.length === 0 ? (
        <div style={{ padding: 24, color: C.muted, fontSize: 14 }}>žádné záznamy pro tento měsíc</div>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, color: C.text }}>
            <thead>
              <tr>
                <th style={{ ...nameCol, textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600 }}>Úkol</th>
                {dayHeaders.map((d) => <th key={d} style={{ ...cellBase, color: C.muted, fontWeight: 600, padding: '6px 0' }}>{d}</th>)}
                <th style={{ ...cellBase, minWidth: 56, width: 56, color: C.muted, fontWeight: 600 }}>Σ</th>
              </tr>
            </thead>
            <tbody>
              {g.tasks.map((t) => {
                const rowTotal = t.perDay.reduce((a, b) => a + b, 0);
                return (
                  <tr key={t.key}>
                    <td style={{ ...nameCol, padding: '6px 8px 6px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {t.projectColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.projectColor, flexShrink: 0 }} />}
                        <span style={{ fontFamily: 'monospace', color: C.muted, flexShrink: 0 }}>{t.taskNumber ?? '(bez úkolu)'}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}>{t.taskTitle ?? ''}</span>
                      </div>
                    </td>
                    {t.perDay.map((min, i) => <td key={i} style={{ ...cellBase, padding: '5px 0', color: min ? C.text : C.border }}>{hrs(min)}</td>)}
                    <td style={{ ...cellBase, minWidth: 56, width: 56, fontWeight: 700 }}>{hrs(rowTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ position: 'sticky', bottom: 22 }}>
                <td style={{ ...nameCol, fontSize: 11, color: C.muted, fontWeight: 700, paddingTop: 8 }}>Celkem (h)</td>
                {g.dailyTotals.map((min, i) => <td key={i} style={{ ...cellBase, paddingTop: 8, color: C.violet, fontWeight: 600 }}>{hrs(min)}</td>)}
                <td style={{ ...cellBase, minWidth: 56, width: 56, paddingTop: 8, color: C.violet, fontWeight: 700 }}>{formatHours(g.monthTotalMinutes)}</td>
              </tr>
              <tr style={{ position: 'sticky', bottom: 0, background: C.ground }}>
                <td style={{ ...nameCol, fontSize: 11, color: C.muted, fontWeight: 700 }}>Výdělek</td>
                {g.dailyEarnings.map((czk, i) => <td key={i} style={{ ...cellBase, color: czk ? C.text : C.border }}>{czk ? Math.round(czk) : ''}</td>)}
                <td style={{ ...cellBase, minWidth: 56, width: 56, color: C.violet, fontWeight: 700 }}>{formatCzk(g.monthTotalCzk)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** — no new errors in `TaskGridView.tsx`.
- [ ] **Step 3: Commit** — `git add apps/ipad/src/components/billing/records/TaskGridView.tsx && git commit -m "feat(ipad-r3): TaskGridView (Mřížka)"`

---

## Task 8: `TimeOffView` (UI)

**Files:**
- Create: `apps/ipad/src/components/billing/records/TimeOffView.tsx`

**Interfaces:**
- Consumes: `useBilling`; `buildTimeOffModel`, types from `../../../state/timeOffModel.js`; `addMonths` from `../../../lib/monthHelpers.js`; `formatDateCz` from `../../../lib/czFormat.js`; `C` from `../reports/tokens.js`.
- Produces: `TimeOffView` (no props).

```tsx
// apps/ipad/src/components/billing/records/TimeOffView.tsx
import { useState } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { buildTimeOffModel, type TimeOffKind } from '../../../state/timeOffModel.js';
import { addMonths } from '../../../lib/monthHelpers.js';
import { formatDateCz } from '../../../lib/czFormat.js';
import { C } from '../reports/tokens.js';

const KIND_COLOR: Record<TimeOffKind, string> = { vacation: '#22D3EE', sick: '#f87171', other: '#fbbf24', holiday: '#6d5fbb' };
const KIND_LABEL: Record<TimeOffKind, string> = { vacation: 'Dovolená', sick: 'Nemoc', other: 'Jiné', holiday: 'Svátek' };
const DOW = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

export function TimeOffView(): JSX.Element {
  const { data } = useBilling();
  const [focus, setFocus] = useState(() => new Date().toISOString().slice(0, 7));
  const today = new Date().toISOString().slice(0, 10);
  const model = buildTimeOffModel(focus, data?.daysOff ?? [], today);

  const btn: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '4px 10px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: C.ground, minHeight: '100%', color: C.text }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.ground, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button style={btn} onClick={() => setFocus(addMonths(focus, -1))}>‹</button>
        <button style={btn} onClick={() => setFocus(new Date().toISOString().slice(0, 7))}>Dnes</button>
        <button style={btn} onClick={() => setFocus(addMonths(focus, 1))}>›</button>
        <div style={{ flex: 1 }} />
        {(['vacation', 'sick', 'other', 'holiday'] as TimeOffKind[]).map((k) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[k] }} />{KIND_LABEL[k]}
          </span>
        ))}
      </div>

      <div style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {model.months.map((mc) => (
          <div key={mc.month} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, minWidth: 230 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{mc.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
              {DOW.map((d) => <div key={d} style={{ fontSize: 10, color: C.muted, textAlign: 'center' }}>{d}</div>)}
              {mc.weeks.flat().map((c, i) => (
                <div key={i} title={c.date ? formatDateCz(c.date) : ''} style={{
                  aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, borderRadius: 5,
                  color: c.date ? (c.kind ? '#0F0F17' : c.isWeekend ? C.muted : C.text) : 'transparent',
                  background: c.kind ? KIND_COLOR[c.kind] : 'transparent',
                  border: c.kind === 'holiday' ? `1px dashed ${KIND_COLOR.holiday}` : 'none',
                  fontWeight: c.kind ? 700 : 400,
                }}>
                  {c.date ? Number(c.date.slice(8, 10)) : ''}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '0 16px 32px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>Nadcházející</div>
        {model.upcoming.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 14 }}>nic nadcházejícího</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {model.upcoming.map((u) => (
              <div key={u.date} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[u.kind], flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: C.text, minWidth: 90 }}>{formatDateCz(u.date)}</span>
                <span style={{ fontSize: 12, color: C.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.note ?? KIND_LABEL[u.kind]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** — no new errors in `TimeOffView.tsx`.
- [ ] **Step 3: Commit** — `git add apps/ipad/src/components/billing/records/TimeOffView.tsx && git commit -m "feat(ipad-r3): TimeOffView (Volno)"`

---

## Task 9: Wire Records views + final verification

**Files:**
- Modify: `apps/ipad/src/components/billing/BillingModule.tsx`

- [ ] **Step 1: Replace the placeholders** in `BillingModule.tsx`:

Add imports:
```tsx
import { WorklogListView } from './records/WorklogListView.js';
import { TaskGridView } from './records/TaskGridView.js';
import { TimeOffView } from './records/TimeOffView.js';
```
Replace the three `<Placeholder .../>` lines with:
```tsx
        {section === 'records-list' && <WorklogListView />}
        {section === 'records-grid' && <TaskGridView />}
        {section === 'records-timeoff' && <TimeOffView />}
```
Remove the now-unused `Placeholder` function.

- [ ] **Step 2: Typecheck both projects**

Run: `npx tsc -b packages/shared/tsconfig.json && npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: no new errors referencing R3 files.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: PASS — prior tests + new `tests/shared/billing/records/*` + `tests/ipad/timeOffModel.test.ts` + the extended `billingCache.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/ipad/src/components/billing/BillingModule.tsx
git commit -m "feat(ipad-r3): wire Records views into billing nav"
```

---

## Final verification
- [ ] `npx tsc -b packages/shared/tsconfig.json && npx tsc -p apps/ipad/tsconfig.json --noEmit` — clean (no R3-referencing errors).
- [ ] `npm test` — green, ≥ prior count + new R3 tests.
- [ ] Manual smoke (post-merge): each billing section reachable from the sidebar; Seznam/Mřížka filter by month+project; Volno shows 3 months + holidays + upcoming; R1/R2 sections + project drill-in still work.

## Self-review notes (for the executor)
- `buildTaskGrid` daysInMonth via `new Date(Date.UTC(y, m, 0)).getUTCDate()` (m is 1-based → day 0 of month m = last day of month m). Verify with the June (30) test.
- `buildTimeOffModel` Monday-first leading pad = `(getUTCDay()+6)%7`; user days_off win over holidays in both the calendar and the upcoming dedupe.
- UI tasks have no DOM tests by design — gate is `tsc --noEmit`.
- Reuse `reports/tokens.ts` `C`; do not re-declare a palette.
