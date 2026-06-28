# iPad Billing Module — R1 (Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only iPad billing module that reads Supabase directly, computes metrics on-device from the synced tables, works offline, and ships a Dashboard + month-earnings + project-detail behind a module-level login.

**Architecture:** New pure aggregation functions in `packages/shared` sum/bucket/rank the *already-derived* worklog fields (`earned_amount`, `effective_minutes`) plus `contracts`/`days_off`. The iPad app (`apps/ipad`, plain React + inline styles) reads via `@supabase/supabase-js` (PostgREST + Auth + anon key), caches the dataset (stale-while-revalidate), and renders three views. A module-level auth gate isolates the Supabase dependency to billing.

**Tech Stack:** TypeScript, React (apps/ipad, no MUI, no charting lib), `@supabase/supabase-js`, `@watchtower/shared` (composite build), vitest (logic-only, no DOM).

**Spec:** `docs/superpowers/specs/2026-06-27-ipad-billing-r1-dashboard-design.md`

## Global Constraints

- **Read-only.** No writes/mutations anywhere. Editing is sub-project #3.
- **CZK only.** Never sum across currencies; filter/group on `rate_currency = 'CZK'` for earnings (issue #108). Surface (don't silently merge) any non-CZK row.
- **Sum precomputed fields — do NOT recompute per-worklog earnings.** Worklog rows from Supabase carry `earned_amount`, `effective_minutes`, `resolved_rate`, `rate_currency`. Aggregations sum/bucket these.
- **Mirror the orchestrator's faithful quirks exactly:** dashboard "today" minutes and top-projects ranking use **raw `minutes`** (not effective/reported); earnings use the precomputed `earned_amount`.
- **MD conversion:** `minutes / 60 / hours_per_day` (contract `hours_per_day`, fallback `8.0` only where the source uses it — see Task 4).
- **`@watchtower/shared` is `packages/shared/`**, subpath imports by explicit filename (`@watchtower/shared/billing/<file>.js`), **no barrel**. Adding files requires `npx tsc -b packages/shared/tsconfig.json` before `apps/ipad` can import them.
- **apps/ipad:** plain React + inline styles, **no MUI**, no charting library (CSS/SVG only). Czech locale, cs-CZ formatting (NBSP thousands + `Kč`, dates `D. M. YYYY`), no i18n.
- **Supabase:** URL `https://xggihnrvsmbzbkhsnuky.supabase.co`; anon key is **public** (owner-supplied constant). Reads use PostgREST; auth uses GoTrue password grant; RLS `authenticated`-SELECT is already live (PR #106).
- **PostgREST embedding** for the join: `worklogs?select=...,tasks(epics(projects(...)))` (no denormalized project_id on worklogs).
- **Sprint window config** is not synced; use desktop defaults `startDate='2026-01-05'`, `lengthDays=14` as constants (Task 3). Syncing real settings is a follow-up.
- **iPad tests are logic-only** (no DOM/render). Testable logic lives in `packages/shared` and `apps/ipad/src/state`; UI components verify via typecheck + the mockup (`billing-mockup` artifact).
- Never edit `.env*`. Do not commit `dist/` or build output.
- Worktree: created at execution time via superpowers:using-git-worktrees (branch `feat/ipad-billing-r1`).

## File Structure

**`packages/shared/src/billing/`** (new):
- `types.ts` — shared row/result types (`WorklogRow`, `ContractRow`, `DayOffRow`, result shapes).
- `workdays.ts` — ported `czechHolidays(year)`, `countWorkdays(from,to,extraNonWorking?)`, `workdayDates(...)` from `orchestrator/db/workdays.ts`.
- `earnings.ts` — `aggregateMonthEarnings`, `trailingMonths`, `topProjects`.
- `dashboard.ts` — `dashboardKpis`, `sprintWindow`.
- `contracts.ts` — `contractBurn`.
- `heatmap.ts` — `activityHeatmap` (+ streak stats).

**`apps/ipad/src/`**:
- `lib/supabaseClient.ts` — supabase-js client (URL + anon key constants).
- `lib/czFormat.ts` — cs-CZ formatting helpers.
- `state/useSupabaseAuth.ts` — auth/session hook.
- `state/billingCache.ts` — Capacitor `Preferences`-backed cache read/write.
- `state/useBilling.ts` — SWR fetch + cache + derive.
- `components/billing/BillingModule.tsx` — auth gate + tab shell.
- `components/billing/BillingLogin.tsx` — login form.
- `components/billing/DashboardView.tsx`, `EarningsMonthView.tsx`, `ProjectDetailView.tsx`.
- Modify `components/Rail.tsx` (enable billing item, extend `RailModule`) and `App.tsx` (module switch).

**Tests** (`tests/ipad/` + `tests/shared/`): one file per shared function; `useBilling`/`useSupabaseAuth` cache+auth state machines.

---

## Task 1: Shared workdays + Czech holidays (port)

**Files:**
- Create: `packages/shared/src/billing/workdays.ts`
- Create: `packages/shared/src/billing/types.ts`
- Test: `tests/shared/billing/workdays.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PublicHoliday { date: string; name: string }`
  - `czechHolidays(year: number): Map<string, string>` — `'YYYY-MM-DD' → name`, 13 entries/year.
  - `countWorkdays(from: string, to: string, extraNonWorking?: Set<string>): number` — inclusive range, Mon–Fri minus holidays minus `extraNonWorking`.
  - `workdayDates(from: string, to: string, extraNonWorking?: Set<string>): string[]`
  - In `types.ts`: `WorklogRow`, `ContractRow`, `DayOffRow` (see below).

> **Implementer:** port the algorithm VERBATIM from `orchestrator/db/workdays.ts` (Anonymous Gregorian `easterSunday` at lines 25–41; the 11 fixed dates at 66–78; Good Friday = Easter−2 and Easter Monday = Easter+1 at 84–88; `countWorkdays`/`workdayDates` at 104–141 — weekend = `dow===0||dow===6`). Keep it pure (no Date.now). Use UTC date math to avoid TZ drift.

- [ ] **Step 1: Define shared types**

Create `packages/shared/src/billing/types.ts`:

```ts
// Denormalized worklog row as read from Supabase (worklog + derived billing
// fields + embedded project/task refs). Dates are 'YYYY-MM-DD' strings.
export interface WorklogRow {
  syncId: string;
  workDate: string;          // YYYY-MM-DD
  minutes: number;           // raw tracked minutes
  effectiveMinutes: number;  // derived: reported ?? minutes
  earnedAmount: number | null;
  rateCurrency: string | null;
  projectId: number;
  projectName: string;
  projectColor: string | null;
  projectKind: string;       // 'work' | 'personal' | 'time_off' (...)
  isBillable: boolean;
  taskNumber: string | null;
  taskTitle: string | null;
}

export interface ContractRow {
  projectId: number;
  effectiveFrom: string;     // YYYY-MM-DD
  endDate: string | null;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  currency: string;
  hoursPerDay: number;
  mdLimit: number | null;
}

export interface DayOffRow { date: string; kind: string }
```

- [ ] **Step 2: Write the failing test**

Create `tests/shared/billing/workdays.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { czechHolidays, countWorkdays } from '../../../packages/shared/src/billing/workdays.js';

describe('czechHolidays', () => {
  it('has 13 holidays and includes fixed + Easter-relative dates for 2026', () => {
    const h = czechHolidays(2026);
    expect(h.size).toBe(13);
    expect(h.has('2026-01-01')).toBe(true);  // New Year
    expect(h.has('2026-07-05')).toBe(true);  // Cyril & Methodius
    expect(h.has('2026-12-25')).toBe(true);  // Christmas
    expect(h.has('2026-04-03')).toBe(true);  // Good Friday 2026 (Easter Sun 2026-04-05)
    expect(h.has('2026-04-06')).toBe(true);  // Easter Monday 2026
  });
});

describe('countWorkdays', () => {
  it('counts Mon-Fri minus holidays minus extra non-working', () => {
    // 2026-06-01 (Mon) .. 2026-06-07 (Sun): Mon-Fri = 5 workdays, no holidays
    expect(countWorkdays('2026-06-01', '2026-06-07')).toBe(5);
    // Remove one via extraNonWorking (a booked day off)
    expect(countWorkdays('2026-06-01', '2026-06-07', new Set(['2026-06-03']))).toBe(4);
  });

  it('excludes a public holiday inside the range', () => {
    // 2026-07-05 (Cyril&Methodius) and 2026-07-06 (Hus) are holidays; both fall in this week
    // Week 2026-07-06 (Mon) .. 2026-07-10 (Fri): Mon 07-06 is a holiday → 4 workdays
    expect(countWorkdays('2026-07-06', '2026-07-10')).toBe(4);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/jan/Projects/Watchtower && npx vitest run tests/shared/billing/workdays.test.ts`
Expected: FAIL — cannot resolve `workdays.js` (not built yet) / module missing.

- [ ] **Step 4: Implement `workdays.ts` (port from orchestrator)**

Create `packages/shared/src/billing/workdays.ts` porting `orchestrator/db/workdays.ts` verbatim (Easter algorithm, 11 fixed dates, Good Friday/Easter Monday, `czechHolidays` with per-year memo, `countWorkdays`, `workdayDates`). Verify the 2026 expected dates above match the real algorithm output; if Good Friday differs, fix the test's expected date to the algorithm's true output (do not bend the algorithm).

- [ ] **Step 5: Build shared + run test**

Run: `cd /Users/jan/Projects/Watchtower && npx tsc -b packages/shared/tsconfig.json && npx vitest run tests/shared/billing/workdays.test.ts`
Expected: build clean; PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/billing/types.ts packages/shared/src/billing/workdays.ts tests/shared/billing/workdays.test.ts
git commit -m "feat(shared): port Czech holidays + workday counting for billing aggregations"
```

---

## Task 2: Month earnings, trailing trend, top projects

**Files:**
- Create: `packages/shared/src/billing/earnings.ts`
- Test: `tests/shared/billing/earnings.test.ts`

**Interfaces:**
- Consumes: `WorklogRow` (Task 1).
- Produces:
  - `interface ProjectEarning { projectId: number; name: string; color: string | null; minutes: number; earnedCzk: number }`
  - `aggregateMonthEarnings(rows: WorklogRow[], month: string /* 'YYYY-MM' */): { totalCzk: number; perProject: ProjectEarning[] }` — sums `earnedAmount` of CZK rows whose `workDate` is in `month`, grouped by project, `perProject` sorted by `earnedCzk` desc.
  - `trailingMonths(rows: WorklogRow[], endMonth: string, n: number): { month: string; earnedCzk: number }[]` — n months ending at `endMonth` inclusive, oldest first.
  - `topProjects(rows: WorklogRow[], month: string, limit: number): { projectId: number; name: string; color: string | null; minutes: number; earnedCzk: number }[]` — ranked by **raw `minutes`** desc then name asc, `minutes > 0` only.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/billing/earnings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateMonthEarnings, trailingMonths, topProjects } from '../../../packages/shared/src/billing/earnings.js';
import type { WorklogRow } from '../../../packages/shared/src/billing/types.js';

const wl = (o: Partial<WorklogRow>): WorklogRow => ({
  syncId: Math.random().toString(36).slice(2), workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
  earnedAmount: 1500, rateCurrency: 'CZK', projectId: 1, projectName: 'A', projectColor: null,
  projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null, ...o,
});

describe('aggregateMonthEarnings', () => {
  it('sums CZK earned per project within the month, sorted desc', () => {
    const rows = [
      wl({ projectId: 1, projectName: 'A', workDate: '2026-06-02', earnedAmount: 1000, minutes: 60 }),
      wl({ projectId: 1, projectName: 'A', workDate: '2026-06-10', earnedAmount: 2000, minutes: 120 }),
      wl({ projectId: 2, projectName: 'B', workDate: '2026-06-05', earnedAmount: 500, minutes: 30 }),
      wl({ projectId: 2, projectName: 'B', workDate: '2026-05-31', earnedAmount: 9999, minutes: 600 }), // other month
    ];
    const r = aggregateMonthEarnings(rows, '2026-06');
    expect(r.totalCzk).toBe(3500);
    expect(r.perProject.map(p => [p.name, p.earnedCzk])).toEqual([['A', 3000], ['B', 500]]);
  });

  it('ignores non-CZK and null earned rows', () => {
    const rows = [
      wl({ earnedAmount: 1000, rateCurrency: 'CZK' }),
      wl({ earnedAmount: 50, rateCurrency: 'EUR' }),
      wl({ earnedAmount: null, rateCurrency: null }),
    ];
    expect(aggregateMonthEarnings(rows, '2026-06').totalCzk).toBe(1000);
  });
});

describe('trailingMonths', () => {
  it('returns n months ending inclusive, oldest first, zero-filled', () => {
    const rows = [wl({ workDate: '2026-06-01', earnedAmount: 100 }), wl({ workDate: '2026-04-01', earnedAmount: 50 })];
    const r = trailingMonths(rows, '2026-06', 3);
    expect(r).toEqual([
      { month: '2026-04', earnedCzk: 50 },
      { month: '2026-05', earnedCzk: 0 },
      { month: '2026-06', earnedCzk: 100 },
    ]);
  });
});

describe('topProjects', () => {
  it('ranks by raw minutes desc then name, excludes zero-minute', () => {
    const rows = [
      wl({ projectId: 1, projectName: 'A', minutes: 60, earnedAmount: 1000 }),
      wl({ projectId: 2, projectName: 'B', minutes: 120, earnedAmount: 500 }),
      wl({ projectId: 3, projectName: 'C', minutes: 0, earnedAmount: 0 }),
    ];
    const r = topProjects(rows, '2026-06', 5);
    expect(r.map(p => p.name)).toEqual(['B', 'A']); // B has more minutes
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jan/Projects/Watchtower && npx vitest run tests/shared/billing/earnings.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `earnings.ts`**

Create `packages/shared/src/billing/earnings.ts`:

```ts
import type { WorklogRow, ProjectEarning } from './types.js';
export type { ProjectEarning } from './types.js';

const inMonth = (workDate: string, month: string) => workDate.slice(0, 7) === month;
const isCzkEarned = (r: WorklogRow) => r.rateCurrency === 'CZK' && r.earnedAmount != null;

export function aggregateMonthEarnings(rows: WorklogRow[], month: string) {
  const byProject = new Map<number, ProjectEarning>();
  let totalCzk = 0;
  for (const r of rows) {
    if (!inMonth(r.workDate, month) || !isCzkEarned(r)) continue;
    totalCzk += r.earnedAmount!;
    const cur = byProject.get(r.projectId) ?? { projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0 };
    cur.minutes += r.minutes;
    cur.earnedCzk += r.earnedAmount!;
    byProject.set(r.projectId, cur);
  }
  const perProject = [...byProject.values()].sort((a, b) => b.earnedCzk - a.earnedCzk);
  return { totalCzk, perProject };
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function trailingMonths(rows: WorklogRow[], endMonth: string, n: number) {
  const months = Array.from({ length: n }, (_, i) => addMonths(endMonth, -(n - 1 - i)));
  const totals = new Map(months.map((m) => [m, 0]));
  for (const r of rows) {
    if (!isCzkEarned(r)) continue;
    const m = r.workDate.slice(0, 7);
    if (totals.has(m)) totals.set(m, totals.get(m)! + r.earnedAmount!);
  }
  return months.map((month) => ({ month, earnedCzk: totals.get(month)! }));
}

export function topProjects(rows: WorklogRow[], month: string, limit: number) {
  const by = new Map<number, { projectId: number; name: string; color: string | null; minutes: number; earnedCzk: number }>();
  for (const r of rows) {
    if (!inMonth(r.workDate, month)) continue;
    const cur = by.get(r.projectId) ?? { projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0 };
    cur.minutes += r.minutes;
    if (isCzkEarned(r)) cur.earnedCzk += r.earnedAmount!;
    by.set(r.projectId, cur);
  }
  return [...by.values()]
    .filter((p) => p.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
    .slice(0, limit);
}
```

Add `ProjectEarning` to `types.ts` (export the interface declared in the Interfaces block above).

- [ ] **Step 4: Build + run test**

Run: `cd /Users/jan/Projects/Watchtower && npx tsc -b packages/shared/tsconfig.json && npx vitest run tests/shared/billing/earnings.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/billing/earnings.ts packages/shared/src/billing/types.ts tests/shared/billing/earnings.test.ts
git commit -m "feat(shared): month earnings, trailing trend, top projects aggregations"
```

---

## Task 3: Dashboard KPIs + sprint window

**Files:**
- Create: `packages/shared/src/billing/dashboard.ts`
- Test: `tests/shared/billing/dashboard.test.ts`

**Interfaces:**
- Consumes: `WorklogRow` (Task 1).
- Produces:
  - `sprintWindow(anchor: string, startDate?: string, lengthDays?: number): { from: string; to: string }` — mirrors `orchestrator/db/dashboardOverview.ts:277–289`. Defaults `startDate='2026-01-05'`, `lengthDays=14` (clamp 1–56).
  - `interface WindowAgg { minutes: number; earnedCzk: number }`
  - `dashboardKpis(rows: WorklogRow[], opts: { today: string; sprint?: { startDate?: string; lengthDays?: number } }): { today: WindowAgg; sprint: WindowAgg & { from: string; to: string }; month: WindowAgg }` — **today/sprint/month minutes use raw `minutes`**; earned sums CZK `earnedAmount`. Month = `today.slice(0,7)`.

> **Implementer:** sprint math (mirror exactly): `days = floor((anchor - startDate)/dayMs)`, `idx = floor(days/len)`, `from = startDate + idx*len days`, `to = from + (len-1) days`. Use UTC date math.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/billing/dashboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sprintWindow, dashboardKpis } from '../../../packages/shared/src/billing/dashboard.js';
import type { WorklogRow } from '../../../packages/shared/src/billing/types.js';

const wl = (workDate: string, minutes: number, earnedAmount: number | null = minutes * 25): WorklogRow => ({
  syncId: workDate + minutes, workDate, minutes, effectiveMinutes: minutes, earnedAmount, rateCurrency: 'CZK',
  projectId: 1, projectName: 'A', projectColor: null, projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null,
});

describe('sprintWindow', () => {
  it('computes the 14-day window containing the anchor (defaults)', () => {
    // start 2026-01-05, len 14, anchor 2026-06-27 → from 2026-06-22, to 2026-07-05
    expect(sprintWindow('2026-06-27')).toEqual({ from: '2026-06-22', to: '2026-07-05' });
  });
});

describe('dashboardKpis', () => {
  it('sums raw minutes + CZK earned for today, sprint, month', () => {
    const rows = [
      wl('2026-06-27', 120, 3000), // today (= anchor)
      wl('2026-06-23', 60, 1500),  // in sprint, in month, not today
      wl('2026-06-02', 30, 750),   // in month, not sprint
      wl('2026-05-31', 600, 9999), // other month
    ];
    const r = dashboardKpis(rows, { today: '2026-06-27' });
    expect(r.today).toEqual({ minutes: 120, earnedCzk: 3000 });
    expect(r.sprint.from).toBe('2026-06-22');
    expect(r.sprint.minutes).toBe(180);   // 120 + 60
    expect(r.month.minutes).toBe(210);     // 120 + 60 + 30
    expect(r.month.earnedCzk).toBe(5250);  // 3000 + 1500 + 750
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jan/Projects/Watchtower && npx vitest run tests/shared/billing/dashboard.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `dashboard.ts`**

Create `packages/shared/src/billing/dashboard.ts`:

```ts
import type { WorklogRow } from './types.js';

const DAY = 86_400_000;
const toUTC = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fmt = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };

export function sprintWindow(anchor: string, startDate = '2026-01-05', lengthDays = 14) {
  const len = Math.min(56, Math.max(1, lengthDays));
  const days = Math.floor((toUTC(anchor) - toUTC(startDate)) / DAY);
  const idx = Math.floor(days / len);
  const from = toUTC(startDate) + idx * len * DAY;
  return { from: fmt(from), to: fmt(from + (len - 1) * DAY) };
}

const isCzk = (r: WorklogRow) => r.rateCurrency === 'CZK' && r.earnedAmount != null;
function agg(rows: WorklogRow[], pred: (r: WorklogRow) => boolean) {
  let minutes = 0, earnedCzk = 0;
  for (const r of rows) { if (!pred(r)) continue; minutes += r.minutes; if (isCzk(r)) earnedCzk += r.earnedAmount!; }
  return { minutes, earnedCzk };
}

export function dashboardKpis(rows: WorklogRow[], opts: { today: string; sprint?: { startDate?: string; lengthDays?: number } }) {
  const month = opts.today.slice(0, 7);
  const sw = sprintWindow(opts.today, opts.sprint?.startDate, opts.sprint?.lengthDays);
  return {
    today: agg(rows, (r) => r.workDate === opts.today),
    sprint: { ...agg(rows, (r) => r.workDate >= sw.from && r.workDate <= sw.to), from: sw.from, to: sw.to },
    month: agg(rows, (r) => r.workDate.slice(0, 7) === month),
  };
}
```

- [ ] **Step 4: Build + run test**

Run: `cd /Users/jan/Projects/Watchtower && npx tsc -b packages/shared/tsconfig.json && npx vitest run tests/shared/billing/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/billing/dashboard.ts tests/shared/billing/dashboard.test.ts
git commit -m "feat(shared): dashboard KPIs (today/sprint/month) + sprint window"
```

---

## Task 4: Contract burn / projection

**Files:**
- Create: `packages/shared/src/billing/contracts.ts`
- Test: `tests/shared/billing/contracts.test.ts`

**Interfaces:**
- Consumes: `WorklogRow`, `ContractRow`, `DayOffRow` (Task 1); `countWorkdays` (Task 1).
- Produces:
  - `interface ContractBurn { projectId: number; projectName: string; mdsUsed: number; mdLimit: number | null; mdsRemaining: number | null; projectedMds: number | null; workdaysRemaining: number | null; totalWorkdays: number | null; endDate: string | null }`
  - `contractBurn(contracts: ContractRow[], rows: WorklogRow[], daysOff: DayOffRow[], opts: { today: string }): ContractBurn[]` — one entry per **active** contract (window contains `today`; active = `effectiveFrom <= today` and (`endDate` null or `>= today`)).

> **Implementer:** mirror `orchestrator/db/contractStatus.ts:72–132` exactly:
> - `minutesLogged` = sum of `min(reported, minutes)`→ here use `effectiveMinutes` of rows for that project within `[effectiveFrom, effectiveTo]`.
> - `mdsUsed = round2(minutesLogged / 60 / hoursPerDay)`.
> - `extraNonWorking` = Set of `daysOff[].date` (all kinds).
> - `totalWorkdays = countWorkdays(effectiveFrom, effectiveTo, extra)` (null if open-ended `endDate`).
> - `elapsedWorkdays = countWorkdays(effectiveFrom, today, extra)`.
> - `workdaysRemaining = countWorkdays(tomorrow, effectiveTo, extra)` (0 if `today > effectiveTo`; null if open-ended).
> - `projectedMds = elapsedWorkdays > 0 ? round2((mdsUsed / elapsedWorkdays) * totalWorkdays) : null` (null if `totalWorkdays` null).
> - `mdsRemaining = mdLimit != null ? round2(mdLimit - mdsUsed) : null`.
> `round2(x) = Math.round(x * 100) / 100`.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/billing/contracts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { contractBurn } from '../../../packages/shared/src/billing/contracts.js';
import type { WorklogRow, ContractRow } from '../../../packages/shared/src/billing/types.js';

const contract = (o: Partial<ContractRow> = {}): ContractRow => ({
  projectId: 1, effectiveFrom: '2026-06-01', endDate: '2026-06-30', rateType: 'hourly',
  rateAmount: 1500, currency: 'CZK', hoursPerDay: 8, mdLimit: 20, ...o,
});
const wl = (workDate: string, effectiveMinutes: number): WorklogRow => ({
  syncId: workDate, workDate, minutes: effectiveMinutes, effectiveMinutes, earnedAmount: 0, rateCurrency: 'CZK',
  projectId: 1, projectName: 'A', projectColor: null, projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null,
});

describe('contractBurn', () => {
  it('computes mdsUsed and projection for an active fixed-window contract', () => {
    // June 2026: workdays Mon-Fri minus holidays. 8h/day.
    // Log 5 full days (480 min each) across the first week.
    const rows = [wl('2026-06-01', 480), wl('2026-06-02', 480), wl('2026-06-03', 480), wl('2026-06-04', 480), wl('2026-06-05', 480)];
    const [b] = contractBurn([contract()], rows, [], { today: '2026-06-05' });
    expect(b.mdsUsed).toBe(5);        // 5 * 480 / 60 / 8
    expect(b.mdLimit).toBe(20);
    expect(b.mdsRemaining).toBe(15);
    // elapsed workdays 06-01..06-05 = 5; projected = (5/5) * totalWorkdays
    expect(b.totalWorkdays).toBeGreaterThan(0);
    expect(b.projectedMds).toBe(b.totalWorkdays);
  });

  it('skips contracts whose window does not contain today', () => {
    expect(contractBurn([contract({ endDate: '2026-05-31' })], [], [], { today: '2026-06-15' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jan/Projects/Watchtower && npx vitest run tests/shared/billing/contracts.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `contracts.ts`** (port from `contractStatus.ts`, using `countWorkdays` from Task 1; signatures per Interfaces above).

- [ ] **Step 4: Build + run test**

Run: `cd /Users/jan/Projects/Watchtower && npx tsc -b packages/shared/tsconfig.json && npx vitest run tests/shared/billing/contracts.test.ts`
Expected: PASS. If `totalWorkdays` for June 2026 differs from your hand-count, assert the actual value the ported `countWorkdays` returns (don't bend the port).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/billing/contracts.ts tests/shared/billing/contracts.test.ts
git commit -m "feat(shared): contract burn + MD projection (mirror contractStatus)"
```

---

## Task 5: Activity heatmap + streak stats

**Files:**
- Create: `packages/shared/src/billing/heatmap.ts`
- Test: `tests/shared/billing/heatmap.test.ts`

**Interfaces:**
- Consumes: `WorklogRow`.
- Produces:
  - `interface HeatmapResult { days: { date: string; minutes: number }[]; stats: { currentStreak: number; longestStreak: number; activeDays: number; weeklyAvgMinutes: number; busiestDay: string | null } }`
  - `activityHeatmap(rows: WorklogRow[], opts: { today: string; windowDays?: number }): HeatmapResult` — window `[today-(windowDays-1), today]`, default `windowDays=30`. Mirrors `dashboardOverview.ts:216–353`: `days` for every date in window (zero-filled, raw `minutes`); `activeDays` = days with minutes>0; `weeklyAvgMinutes = round(totalMinutes/windowDays*7)`; `currentStreak` = consecutive minutes>0 walking back from `today` (cap = windowDays); `longestStreak` = longest run (cap); `busiestDay` = max-minutes date, first wins ties, null if none.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/billing/heatmap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { activityHeatmap } from '../../../packages/shared/src/billing/heatmap.js';
import type { WorklogRow } from '../../../packages/shared/src/billing/types.js';
const wl = (workDate: string, minutes: number): WorklogRow => ({
  syncId: workDate, workDate, minutes, effectiveMinutes: minutes, earnedAmount: 0, rateCurrency: 'CZK',
  projectId: 1, projectName: 'A', projectColor: null, projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null,
});

describe('activityHeatmap', () => {
  it('zero-fills the window and computes streak stats', () => {
    // window 7 days ending 2026-06-07; active: 06-05,06-06,06-07 (streak to today=3), plus 06-01
    const rows = [wl('2026-06-01', 60), wl('2026-06-05', 120), wl('2026-06-06', 30), wl('2026-06-07', 90)];
    const r = activityHeatmap(rows, { today: '2026-06-07', windowDays: 7 });
    expect(r.days).toHaveLength(7);
    expect(r.days[0]).toEqual({ date: '2026-06-01', minutes: 60 });
    expect(r.stats.activeDays).toBe(4);
    expect(r.stats.currentStreak).toBe(3);   // 06-05,06,07
    expect(r.stats.longestStreak).toBe(3);
    expect(r.stats.busiestDay).toBe('2026-06-05'); // 120 min
    expect(r.stats.weeklyAvgMinutes).toBe(Math.round((300 / 7) * 7)); // total 300
  });
});
```

- [ ] **Step 2–4:** run-fail → implement (mirror `dashboardOverview.computeStats`) → build + run-pass.
Run: `cd /Users/jan/Projects/Watchtower && npx tsc -b packages/shared/tsconfig.json && npx vitest run tests/shared/billing/heatmap.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/billing/heatmap.ts tests/shared/billing/heatmap.test.ts
git commit -m "feat(shared): activity heatmap + streak stats (mirror dashboardOverview)"
```

---

## Task 6: Supabase client + auth gate hook

**Files:**
- Modify: `apps/ipad/package.json` (add `@supabase/supabase-js`)
- Create: `apps/ipad/src/lib/supabaseClient.ts`
- Create: `apps/ipad/src/state/useSupabaseAuth.ts`
- Test: `tests/ipad/useSupabaseAuth.test.ts`

**Interfaces:**
- Produces:
  - `supabase` — configured client (URL + anon key constants; session persisted via Capacitor Preferences-backed storage or localStorage).
  - `useSupabaseAuth(): { session: Session | null; status: 'loading' | 'in' | 'out'; signIn(email, password): Promise<{ error?: string }>; signOut(): Promise<void> }`

- [ ] **Step 1: Add the dependency**

Run: `cd /Users/jan/Projects/Watchtower && npm install @supabase/supabase-js -w apps/ipad`
Expected: added to `apps/ipad/package.json` dependencies.

- [ ] **Step 2: Create the client**

Create `apps/ipad/src/lib/supabaseClient.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

// Public values (anon key is safe to ship per the data-plane runbook).
const SUPABASE_URL = 'https://xggihnrvsmbzbkhsnuky.supabase.co';
const SUPABASE_ANON_KEY = '<ANON_KEY>'; // owner-supplied public anon key

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
```

> **Implementer:** replace `<ANON_KEY>` with the project's anon key from the Supabase dashboard (Settings → API). It is public; committing it is acceptable for this single-user app. Do NOT use the service_role key.

- [ ] **Step 3: Write the failing test for the auth hook**

Create `tests/ipad/useSupabaseAuth.test.ts` — test the pure state-reduction logic of the hook by mocking `supabase.auth` (signIn success sets status 'in'; bad credentials returns `{ error }` and stays 'out'; existing session → 'in'). Follow the mock style in existing `tests/ipad/*.test.ts`. (Extract any non-trivial mapping — e.g. mapping a Supabase error to a Czech message — into a pure helper and assert it directly.)

- [ ] **Step 4: Implement `useSupabaseAuth.ts`** (wrap `supabase.auth.getSession`, `onAuthStateChange`, `signInWithPassword`, `signOut`; map errors to Czech strings via the pure helper).

- [ ] **Step 5: Run tests + typecheck**

Run: `cd /Users/jan/Projects/Watchtower && npx vitest run tests/ipad/useSupabaseAuth.test.ts && npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: PASS; iPad typecheck clean (ignore pre-existing drift noted in CLAUDE.md).

- [ ] **Step 6: Commit**

```bash
git add apps/ipad/package.json apps/ipad/package-lock.json apps/ipad/src/lib/supabaseClient.ts apps/ipad/src/state/useSupabaseAuth.ts tests/ipad/useSupabaseAuth.test.ts
git commit -m "feat(ipad): supabase client + module-level auth hook"
```

---

## Task 7: Billing data fetch + offline cache (stale-while-revalidate)

**Files:**
- Create: `apps/ipad/src/state/billingCache.ts`
- Create: `apps/ipad/src/state/useBilling.ts`
- Test: `tests/ipad/billingCache.test.ts`, `tests/ipad/useBilling.test.ts`

**Interfaces:**
- Consumes: `supabase` (Task 6); shared types (Task 1).
- Produces:
  - `interface BillingDataset { worklogs: WorklogRow[]; contracts: ContractRow[]; daysOff: DayOffRow[]; fetchedAt: string }`
  - `loadCache(): Promise<BillingDataset | null>`, `saveCache(d: BillingDataset): Promise<void>`
  - `mapWorklogRow(raw): WorklogRow` — pure mapper from the PostgREST embedded shape to `WorklogRow`.
  - `useBilling(): { data: BillingDataset | null; state: 'loading' | 'fresh' | 'cached' | 'offline'; lastUpdated: string | null; refresh(): void }`

- [ ] **Step 1: Write the failing test for the pure mapper + cache**

Create `tests/ipad/billingCache.test.ts`: assert `mapWorklogRow` turns a PostgREST row (`{ sync_id, work_date, minutes, effective_minutes, earned_amount, rate_currency, tasks: { number, title, epics: { projects: { id, name, color, kind, is_billable } } } }`) into a flat `WorklogRow`, including null task (no task) and non-CZK passthrough. Assert `saveCache`/`loadCache` round-trip via a mocked storage.

- [ ] **Step 2: run-fail.** Run: `cd /Users/jan/Projects/Watchtower && npx vitest run tests/ipad/billingCache.test.ts` → FAIL.

- [ ] **Step 3: Implement `billingCache.ts`** — the mapper + Capacitor `Preferences` (key `watchtower.ipad.billing.cache`) read/write (JSON). Mirror the storage style of `apps/ipad/src/state/vncCreds.ts`.

- [ ] **Step 4: Implement `useBilling.ts`** — on mount: `loadCache()` → set `data` + state `cached`; then fetch fresh:
  - `supabase.from('worklogs').select('sync_id,work_date,minutes,effective_minutes,earned_amount,rate_currency,tasks(number,title,epics(projects(id,name,color,kind,is_billable)))').is('deleted_at', null)`
  - `supabase.from('contracts').select('...').is('deleted_at', null)`, `supabase.from('days_off').select('date,kind')`
  - map → `BillingDataset` → `saveCache` → set `data` + state `fresh`. On fetch error with a cache → keep `cached`; with no cache → `offline`. `refresh()` re-runs the fetch.

- [ ] **Step 5: Write `useBilling` state-machine test** — mock the supabase calls + cache; assert: cache-then-fresh transition; fetch-error-with-cache → stays `cached`; fetch-error-no-cache → `offline`. Test the reducer/state logic (extract it as a pure function if needed for testability).

- [ ] **Step 6: Run tests + typecheck**

Run: `cd /Users/jan/Projects/Watchtower && npx vitest run tests/ipad/billingCache.test.ts tests/ipad/useBilling.test.ts && npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/ipad/src/state/billingCache.ts apps/ipad/src/state/useBilling.ts tests/ipad/billingCache.test.ts tests/ipad/useBilling.test.ts
git commit -m "feat(ipad): billing dataset fetch + offline SWR cache"
```

---

## Task 8: Module gate, login, Rail wiring, cs-CZ format

**Files:**
- Create: `apps/ipad/src/lib/czFormat.ts`
- Create: `apps/ipad/src/components/billing/BillingModule.tsx`
- Create: `apps/ipad/src/components/billing/BillingLogin.tsx`
- Modify: `apps/ipad/src/components/Rail.tsx` (`RailModule` type at line 9; enable the `billing` item at line 75)
- Modify: `apps/ipad/src/App.tsx` (module render switch at lines 234–238)
- Test: `tests/ipad/czFormat.test.ts`

**Interfaces:**
- Produces: `formatCzk(n)`, `formatHours(min)`, `formatDateCz(iso)` (cs-CZ, NBSP thousands, `Kč`, `D. M. YYYY`).

- [ ] **Step 1: Write the failing test for `czFormat`**

Create `tests/ipad/czFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatCzk, formatHours, formatDateCz } from '../../apps/ipad/src/lib/czFormat.js';
const NBSP = ' ';
describe('czFormat', () => {
  it('formats CZK with NBSP thousands and Kč suffix', () => {
    expect(formatCzk(142500)).toBe(`142${NBSP}500${NBSP}Kč`);
    expect(formatCzk(0)).toBe(`0${NBSP}Kč`);
  });
  it('formats minutes as Czech hours', () => {
    expect(formatHours(90)).toBe(`1,5${NBSP}h`);
  });
  it('formats ISO date as D. M. YYYY', () => {
    expect(formatDateCz('2026-06-07')).toBe('7. 6. 2026');
  });
});
```

- [ ] **Step 2: run-fail → Step 3: implement `czFormat.ts`** (use `Intl.NumberFormat('cs-CZ')` or manual NBSP grouping to match exactly) → Step 4: run-pass.

- [ ] **Step 5: Enable the billing module shell** (no unit test — UI; verify by typecheck + the mockup):
  - `Rail.tsx:9` — extend `RailModule` to `'instances' | 'remote' | 'billing'`.
  - `Rail.tsx:75` — set the billing item `enabled: true`.
  - `App.tsx:234–238` — extend the module render switch to render `<BillingModule/>` when `activeModule === 'billing'`.
  - `BillingModule.tsx` — calls `useSupabaseAuth()`; `status==='out'` → `<BillingLogin/>`; else the tab shell (Přehled / Výdělky) rendering `DashboardView` (Task 9) / `EarningsMonthView` (Task 10). Internal `useState` for the active tab + selected project (for drill-down to Task 11).
  - `BillingLogin.tsx` — email/password inputs + "Přihlásit" button → `signIn`; inline Czech error; matches the mockup's login card.

- [ ] **Step 6: Typecheck + run all iPad/shared tests**

Run: `cd /Users/jan/Projects/Watchtower && npx vitest run tests/ipad/ tests/shared/ && npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: all PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/ipad/src/lib/czFormat.ts apps/ipad/src/components/billing/BillingModule.tsx apps/ipad/src/components/billing/BillingLogin.tsx apps/ipad/src/components/Rail.tsx apps/ipad/src/App.tsx tests/ipad/czFormat.test.ts
git commit -m "feat(ipad): billing module gate + login + Rail wiring + cs-CZ format"
```

---

## Task 9: DashboardView

**Files:**
- Create: `apps/ipad/src/components/billing/DashboardView.tsx`

**Interfaces:**
- Consumes: `useBilling` (Task 7); `dashboardKpis`, `contractBurn`, `activityHeatmap`, `topProjects` (Tasks 2–5); `czFormat` (Task 8).

- [ ] **Step 1: Implement the view** (UI — verified by typecheck + mockup parity, no unit test). From `useBilling().data`, compute via the shared functions with `today = new Date().toISOString().slice(0,10)` and render, matching the mockup screen 01:
  - KPI tiles (Dnes / Sprint / Tento měsíc): `formatHours(minutes)` + `formatCzk(earnedCzk)`.
  - Active-contract cards: burn bar (used/limit), projected-overrun cyan tick, `workdaysRemaining`.
  - 30-day heatmap (CSS grid cells, 4 intensity levels) + stat strip.
  - Top projects (ranked bars).
  - Header: "aktualizováno před X" from `lastUpdated` + pull-to-refresh → `refresh()`; offline badge when `state==='cached'|'offline'`; empty state when no data.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/jan/Projects/Watchtower && npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/components/billing/DashboardView.tsx
git commit -m "feat(ipad): billing dashboard view (KPIs, contracts, heatmap, top projects)"
```

---

## Task 10: EarningsMonthView

**Files:**
- Create: `apps/ipad/src/components/billing/EarningsMonthView.tsx`

**Interfaces:**
- Consumes: `useBilling`; `aggregateMonthEarnings`, `trailingMonths` (Task 2); `czFormat`.

- [ ] **Step 1: Implement** (UI — typecheck + mockup parity). Month picker (state `selectedMonth`, defaults to current `YYYY-MM`), hero `formatCzk(totalCzk)`, trailing-8-months CSS bar chart (current month highlighted), per-project rows (name, minutes/rate, `formatCzk`, chevron). Tapping a project calls a prop callback `onOpenProject(projectId)` (BillingModule routes to Task 11). Czech month label via a small helper (e.g. "Červen 2026").

- [ ] **Step 2: Typecheck** → **Step 3: Commit**

```bash
git add apps/ipad/src/components/billing/EarningsMonthView.tsx
git commit -m "feat(ipad): month earnings view (hero total, trend, per-project)"
```

---

## Task 11: ProjectDetailView

**Files:**
- Create: `apps/ipad/src/components/billing/ProjectDetailView.tsx`

**Interfaces:**
- Consumes: `useBilling`; the worklog rows + contracts filtered to the project; `czFormat`. (Rate-history rows computed inline from `contracts` + summed CZK `earnedAmount` per rate window; the month ledger is the project's worklogs for `selectedMonth` sorted by date desc.)

- [ ] **Step 1: Implement** (UI — typecheck + mockup parity). Header (project name, month, hours, active rate); rate-history table (contract periods with summed earnings); worklog ledger (date · task · hours · `formatCzk` earned) + footer total. Back button calls `onBack()`.

- [ ] **Step 2: Typecheck** → **Step 3: Commit**

```bash
git add apps/ipad/src/components/billing/ProjectDetailView.tsx
git commit -m "feat(ipad): project detail view (rate history + worklog ledger)"
```

---

## Final verification (after all tasks)

- [ ] `cd /Users/jan/Projects/Watchtower && npx tsc -b packages/shared/tsconfig.json` — shared builds clean.
- [ ] `npx vitest run tests/shared/ tests/ipad/` — all new logic tests pass; full suite still green (`npx vitest run`).
- [ ] `npx tsc -p apps/ipad/tsconfig.json --noEmit` — iPad typecheck clean (modulo pre-existing drift per CLAUDE.md).
- [ ] Manual: run the iPad app (`npm run dev` desktop host + the iPad client), open the **Výdělky** module, log in, confirm Dashboard / Earnings / Project-detail render against live Supabase data and match the mockup; verify offline (airplane mode) serves the cache with the offline badge.

## Notes / follow-ups (not in R1)

- Sync the sprint settings (`dashboard.sprint.startDate`/`lengthDays`) so the iPad sprint window matches a customized desktop (R1 uses constants).
- Converge the orchestrator/desktop report code onto the `packages/shared/billing` functions (dedupe).
- R2 (Reports tab) and R3 (Records) — separate plans.
