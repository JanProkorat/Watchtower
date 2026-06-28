# iPad Billing R2 (Reports) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Reports (Reporty) tab to the iPad billing module — trend chart, earnings summary, by-project SVG donut, activity heatmap — computed on-device from the already-cached `BillingDataset`.

**Architecture:** New pure aggregation functions in `packages/shared/src/billing/reports/` mirror the bucketing/grouping/output of `orchestrator/db/reports.ts`, but compute by summing the precomputed per-worklog fields (`effectiveMinutes`, `earnedAmount`) — never re-resolving contracts. The iPad app (`apps/ipad`, plain React + inline styles) adds a `useReportsFilters` hook + five view components, reading the existing `useBilling` dataset. No new Supabase/sync/data-plane work.

**Tech Stack:** TypeScript, React (apps/ipad, no MUI, no charting lib — CSS + hand-rolled SVG), `@watchtower/shared` (composite build), vitest (logic-only).

**Spec:** `docs/superpowers/specs/2026-06-28-ipad-billing-r2-reports-design.md`

## Global Constraints

- **Read-only.** No writes/mutations anywhere.
- **No new data fetch.** Read the in-memory `BillingDataset` from `useBilling` (`worklogs`, `contracts`, `daysOff`, `projects`). No PostgREST/sync/migration changes.
- **Sum precomputed fields — do NOT re-resolve contracts per worklog.** Sum `effectiveMinutes` for hours and `earnedAmount` (CZK only) for earnings. Mirror the orchestrator's *shape*, not its rate-period SQL.
- **CZK only.** Earnings sum only rows where `rateCurrency === 'CZK' && earnedAmount != null` (issue #108). Never sum across currencies.
- **Hours + CZK earnings only — no man-days (MD).** MD is not synced onto worklog rows; computing it would re-resolve contracts. MD lives on the Dashboard contract cards (R1).
- **`@watchtower/shared` is `packages/shared/`**, subpath imports by explicit filename (`@watchtower/shared/billing/reports/<file>.js`), **no barrel**. After adding shared files, run `npx tsc -b packages/shared/tsconfig.json` before `apps/ipad` can import them.
- **apps/ipad:** plain React + inline styles, **no MUI**, no charting library (CSS/SVG only). cs-CZ formatting via `apps/ipad/src/lib/czFormat.ts` (`formatCzk`, `formatHours`, `formatDateCz`), no i18n.
- **No `Date.now()` / `new Date()` inside pure shared fns.** `today` is always passed in by the caller (matches R1).
- **iPad tests are logic-only** (no DOM/render). Shared fns + `useReportsFilters` pure helpers get vitest coverage; UI verifies via typecheck.
- Never edit `.env*`. Do not commit `dist/`/build output.
- Worktree: branch `feat/ipad-billing-r2` (the R2 spec is already committed there).

## File Structure

**`packages/shared/src/billing/reports/`** (new):
- `buckets.ts` — `Granularity` type, `bucketKey(date, g)`, `enumerateBuckets(from, to, g)`.
- `trend.ts` — `trendSeries(...)`, `rateChangeMarkers(...)` + `TrendBucket`, `RateMarker`.
- `earnings-summary.ts` — `earningsSummary(...)` + `EarningsSummaryResult`.
- `breakdown.ts` — `projectBreakdown(...)` + `ProjectBreakdownSlice`.

**`packages/shared/src/billing/heatmap.ts`** (modify): extract `buildHeatmap` core; add `activityHeatmapRange(...)`.

**`apps/ipad/src/`**:
- `state/useReportsFilters.ts` — filter state hook + pure helpers (`resolvePreset`, `defaultGranularity`, `clampGranularity`).
- `components/billing/reports/tokens.ts` — shared `C` palette for reports components.
- `components/billing/reports/ReportsFilterBar.tsx`
- `components/billing/reports/TrendChart.tsx`
- `components/billing/reports/EarningsSummaryPanel.tsx`
- `components/billing/reports/ProjectDonut.tsx`
- `components/billing/reports/ActivityHeatmapPanel.tsx`
- `components/billing/ReportsView.tsx` — composes the panels under the filter bar.
- `components/billing/BillingModule.tsx` (modify) — wire the Reporty tab.

**Tests:**
- `tests/shared/billing/reports/buckets.test.ts`, `trend.test.ts`, `earnings-summary.test.ts`, `breakdown.test.ts`
- `tests/shared/billing/heatmap-range.test.ts`
- `tests/ipad/useReportsFilters.test.ts`

---

## Task 1: Shared bucketing helpers (`buckets.ts`)

**Files:**
- Create: `packages/shared/src/billing/reports/buckets.ts`
- Test: `tests/shared/billing/reports/buckets.test.ts`

**Interfaces:**
- Produces: `type Granularity = 'day' | 'week' | 'month'`; `bucketKey(date: string, g: Granularity): string`; `enumerateBuckets(from: string, to: string, g: Granularity): string[]`.

`bucketKey` mirrors `orchestrator/db/reports.ts` `BUCKET_EXPR`: day → `YYYY-MM-DD`, month → `YYYY-MM`, week → `YYYY-W%W` where `%W` is SQLite/C `strftime('%W')` (Monday-first, range 00–53, week 00 = days before the year's first Monday).

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/billing/reports/buckets.test.ts
import { describe, it, expect } from 'vitest';
import { bucketKey, enumerateBuckets } from '../../../../packages/shared/src/billing/reports/buckets.js';

describe('bucketKey', () => {
  it('day granularity returns the date unchanged', () => {
    expect(bucketKey('2026-06-07', 'day')).toBe('2026-06-07');
  });

  it('month granularity returns YYYY-MM', () => {
    expect(bucketKey('2026-06-07', 'month')).toBe('2026-06');
  });

  it('week: days before the first Monday are week 00 (mirrors strftime %W)', () => {
    // 2026-01-01 is a Thursday -> before the first Monday (2026-01-05).
    expect(bucketKey('2026-01-01', 'week')).toBe('2026-W00');
    expect(bucketKey('2026-01-04', 'week')).toBe('2026-W00'); // Sunday, still week 00
  });

  it('week: the first Monday starts week 01', () => {
    expect(bucketKey('2026-01-05', 'week')).toBe('2026-W01'); // Monday
    expect(bucketKey('2026-01-11', 'week')).toBe('2026-W01'); // following Sunday
    expect(bucketKey('2026-01-12', 'week')).toBe('2026-W02');
  });

  it('week: uses the date own calendar year at a year boundary', () => {
    // 2025-12-31 is a Wednesday; 2026-01-01 is a Thursday -> different keys/years.
    expect(bucketKey('2025-12-31', 'week')).toBe('2025-W52');
    expect(bucketKey('2026-01-01', 'week')).toBe('2026-W00');
  });
});

describe('enumerateBuckets', () => {
  it('lists distinct day buckets in order, inclusive', () => {
    expect(enumerateBuckets('2026-06-06', '2026-06-08', 'day')).toEqual([
      '2026-06-06', '2026-06-07', '2026-06-08',
    ]);
  });

  it('collapses a range into its week buckets in order', () => {
    expect(enumerateBuckets('2026-01-04', '2026-01-12', 'week')).toEqual([
      '2026-W00', '2026-W01', '2026-W02',
    ]);
  });

  it('collapses a range into month buckets in order', () => {
    expect(enumerateBuckets('2026-05-20', '2026-07-02', 'month')).toEqual([
      '2026-05', '2026-06', '2026-07',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/billing/reports/buckets.test.ts`
Expected: FAIL — cannot find module `buckets.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/billing/reports/buckets.ts

export type Granularity = 'day' | 'week' | 'month';

function addDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

export function bucketKey(date: string, granularity: Granularity): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return date.slice(0, 7);
  // week: mirror SQLite strftime('%Y-W%W') — Monday-first, week 00 before first Monday.
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const yday = Math.floor((dt.getTime() - jan1.getTime()) / 86_400_000); // 0-based day of year
  const daysSinceMonday = (dt.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const week = Math.floor((yday - daysSinceMonday + 7) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

export function enumerateBuckets(from: string, to: string, granularity: Granularity): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cursor = from;
  while (cursor <= to) {
    const key = bucketKey(cursor, granularity);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
    cursor = addDay(cursor);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/billing/reports/buckets.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Build the shared package + commit**

```bash
npx tsc -b packages/shared/tsconfig.json
git add packages/shared/src/billing/reports/buckets.ts tests/shared/billing/reports/buckets.test.ts
git commit -m "feat(ipad-r2): shared bucketKey + enumerateBuckets (strftime %W mirror)"
```

---

## Task 2: Trend series + rate-change markers (`trend.ts`)

**Files:**
- Create: `packages/shared/src/billing/reports/trend.ts`
- Test: `tests/shared/billing/reports/trend.test.ts`

**Interfaces:**
- Consumes: `bucketKey`, `Granularity` from `./buckets.js`; `WorklogRow`, `ContractRow` from `../types.js`.
- Produces:
  - `interface TrendBucket { bucket: string; minutes: number; earnedCzk: number }`
  - `trendSeries(rows: WorklogRow[], opts: { from: string; to: string; granularity: Granularity; projectId?: number }): TrendBucket[]`
  - `interface RateMarker { effectiveFrom: string; rateType: 'hourly' | 'daily'; rateAmount: number; currency: string }`
  - `rateChangeMarkers(contracts: ContractRow[], opts: { from: string; to: string; projectId?: number }): RateMarker[]`

`trendSeries` mirrors `ReportsService.trend`: bucket by granularity, sum `effectiveMinutes`, sum CZK `earnedAmount`, sort ascending, omit empty buckets. `rateChangeMarkers` mirrors `ReportsService.rateChanges`: per project order by `effectiveFrom`, take rank > 1 (skip the earliest), keep those in range; **returns `[]` unless `projectId` is set**.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/billing/reports/trend.test.ts
import { describe, it, expect } from 'vitest';
import { trendSeries, rateChangeMarkers } from '../../../../packages/shared/src/billing/reports/trend.js';
import type { WorklogRow, ContractRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, rateCurrency: 'CZK', projectId: 1, projectName: 'P1',
    projectColor: '#fff', projectKind: 'work', isBillable: true,
    taskNumber: null, taskTitle: null, ...over,
  };
}
function ct(over: Partial<ContractRow>): ContractRow {
  return {
    projectId: 1, effectiveFrom: '2026-01-01', endDate: null, rateType: 'hourly',
    rateAmount: 1000, currency: 'CZK', hoursPerDay: 8, mdLimit: null, ...over,
  };
}

describe('trendSeries', () => {
  it('buckets by day, summing effective minutes and CZK earnings', () => {
    const rows = [
      wl({ workDate: '2026-06-01', effectiveMinutes: 60, earnedAmount: 1000 }),
      wl({ workDate: '2026-06-01', effectiveMinutes: 30, earnedAmount: 500 }),
      wl({ workDate: '2026-06-02', effectiveMinutes: 90, earnedAmount: 1500 }),
    ];
    expect(trendSeries(rows, { from: '2026-06-01', to: '2026-06-02', granularity: 'day' })).toEqual([
      { bucket: '2026-06-01', minutes: 90, earnedCzk: 1500 },
      { bucket: '2026-06-02', minutes: 90, earnedCzk: 1500 },
    ]);
  });

  it('excludes rows outside the range and non-matching projects', () => {
    const rows = [
      wl({ workDate: '2026-05-31', effectiveMinutes: 60 }),
      wl({ workDate: '2026-06-01', projectId: 2, effectiveMinutes: 60 }),
      wl({ workDate: '2026-06-01', projectId: 1, effectiveMinutes: 45 }),
    ];
    expect(trendSeries(rows, { from: '2026-06-01', to: '2026-06-30', granularity: 'month', projectId: 1 })).toEqual([
      { bucket: '2026-06', minutes: 45, earnedCzk: 1000 },
    ]);
  });

  it('counts minutes but not earnings for non-CZK rows', () => {
    const rows = [wl({ rateCurrency: 'EUR', earnedAmount: 200, effectiveMinutes: 60 })];
    expect(trendSeries(rows, { from: '2026-06-01', to: '2026-06-30', granularity: 'month' })).toEqual([
      { bucket: '2026-06', minutes: 60, earnedCzk: 0 },
    ]);
  });
});

describe('rateChangeMarkers', () => {
  it('returns [] when no project is selected', () => {
    const contracts = [ct({ effectiveFrom: '2026-01-01' }), ct({ effectiveFrom: '2026-03-01' })];
    expect(rateChangeMarkers(contracts, { from: '2026-01-01', to: '2026-12-31' })).toEqual([]);
  });

  it('emits only changes (rank > 1) within range for the selected project', () => {
    const contracts = [
      ct({ projectId: 1, effectiveFrom: '2026-01-01', rateAmount: 1000 }),
      ct({ projectId: 1, effectiveFrom: '2026-03-01', rateAmount: 1200 }),
      ct({ projectId: 1, effectiveFrom: '2026-09-01', rateAmount: 1500 }),
      ct({ projectId: 2, effectiveFrom: '2026-02-01', rateAmount: 999 }),
    ];
    expect(rateChangeMarkers(contracts, { from: '2026-01-01', to: '2026-06-30', projectId: 1 })).toEqual([
      { effectiveFrom: '2026-03-01', rateType: 'hourly', rateAmount: 1200, currency: 'CZK' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/billing/reports/trend.test.ts`
Expected: FAIL — cannot find module `trend.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/billing/reports/trend.ts
import type { WorklogRow, ContractRow } from '../types.js';
import { bucketKey, type Granularity } from './buckets.js';

const isCzkEarned = (r: WorklogRow) => r.rateCurrency === 'CZK' && r.earnedAmount != null;
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface TrendBucket {
  bucket: string;
  minutes: number;
  earnedCzk: number;
}

export function trendSeries(
  rows: WorklogRow[],
  opts: { from: string; to: string; granularity: Granularity; projectId?: number },
): TrendBucket[] {
  const { from, to, granularity, projectId } = opts;
  const map = new Map<string, TrendBucket>();
  for (const r of rows) {
    if (r.workDate < from || r.workDate > to) continue;
    if (projectId !== undefined && r.projectId !== projectId) continue;
    const key = bucketKey(r.workDate, granularity);
    const cur = map.get(key) ?? { bucket: key, minutes: 0, earnedCzk: 0 };
    cur.minutes += r.effectiveMinutes;
    if (isCzkEarned(r)) cur.earnedCzk += r.earnedAmount!;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => cmpStr(a.bucket, b.bucket));
}

export interface RateMarker {
  effectiveFrom: string;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  currency: string;
}

export function rateChangeMarkers(
  contracts: ContractRow[],
  opts: { from: string; to: string; projectId?: number },
): RateMarker[] {
  const { from, to, projectId } = opts;
  if (projectId === undefined) return [];
  const ordered = contracts
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => cmpStr(a.effectiveFrom, b.effectiveFrom));
  return ordered
    .slice(1) // rank > 1 — skip the earliest contract (not a "change")
    .filter((c) => c.effectiveFrom >= from && c.effectiveFrom <= to)
    .map((c) => ({
      effectiveFrom: c.effectiveFrom,
      rateType: c.rateType,
      rateAmount: c.rateAmount,
      currency: c.currency,
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/billing/reports/trend.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
npx tsc -b packages/shared/tsconfig.json
git add packages/shared/src/billing/reports/trend.ts tests/shared/billing/reports/trend.test.ts
git commit -m "feat(ipad-r2): trendSeries + rateChangeMarkers shared fns"
```

---

## Task 3: Earnings summary (`earnings-summary.ts`)

**Files:**
- Create: `packages/shared/src/billing/reports/earnings-summary.ts`
- Test: `tests/shared/billing/reports/earnings-summary.test.ts`

**Interfaces:**
- Consumes: `WorklogRow`, `ProjectEarning` from `../types.js`.
- Produces:
  - `interface EarningsSummaryResult { totalCzk: number; billableMinutes: number; unbillableMinutes: number; avgEffectiveHourlyRateCzk: number | null; perProject: ProjectEarning[] }`
  - `earningsSummary(rows: WorklogRow[], opts: { from: string; to: string; projectId?: number }): EarningsSummaryResult`

Mirrors `ReportsService.earnings` (CZK projection): billable/unbillable split over `kind === 'work'`; `totalCzk` + `czkBillableMinutes` over CZK-earned rows; `avgEffectiveHourlyRateCzk = totalCzk / (czkBillableMinutes / 60)` or `null` at zero; `perProject` sorted by `earnedCzk` desc.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/billing/reports/earnings-summary.test.ts
import { describe, it, expect } from 'vitest';
import { earningsSummary } from '../../../../packages/shared/src/billing/reports/earnings-summary.js';
import type { WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, rateCurrency: 'CZK', projectId: 1, projectName: 'P1',
    projectColor: '#fff', projectKind: 'work', isBillable: true,
    taskNumber: null, taskTitle: null, ...over,
  };
}

describe('earningsSummary', () => {
  it('splits billable/unbillable minutes and sums CZK earnings', () => {
    const rows = [
      wl({ projectId: 1, isBillable: true, effectiveMinutes: 120, earnedAmount: 2000 }),
      wl({ projectId: 2, isBillable: false, effectiveMinutes: 60, earnedAmount: null, projectName: 'P2' }),
    ];
    const r = earningsSummary(rows, { from: '2026-06-01', to: '2026-06-30' });
    expect(r.billableMinutes).toBe(120);
    expect(r.unbillableMinutes).toBe(60);
    expect(r.totalCzk).toBe(2000);
    expect(r.avgEffectiveHourlyRateCzk).toBe(1000); // 2000 / (120/60)
    expect(r.perProject).toEqual([
      { projectId: 1, name: 'P1', color: '#fff', minutes: 120, earnedCzk: 2000 },
    ]);
  });

  it('avg rate is null when there are no CZK-billable minutes', () => {
    const rows = [wl({ isBillable: false, earnedAmount: null })];
    expect(earningsSummary(rows, { from: '2026-06-01', to: '2026-06-30' }).avgEffectiveHourlyRateCzk).toBeNull();
  });

  it('excludes time_off from billable/unbillable and non-CZK from earnings', () => {
    const rows = [
      wl({ projectKind: 'time_off', isBillable: false, effectiveMinutes: 480 }),
      wl({ rateCurrency: 'EUR', earnedAmount: 300, effectiveMinutes: 60 }),
    ];
    const r = earningsSummary(rows, { from: '2026-06-01', to: '2026-06-30' });
    expect(r.unbillableMinutes).toBe(0);
    expect(r.totalCzk).toBe(0);
    expect(r.perProject).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/billing/reports/earnings-summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/billing/reports/earnings-summary.ts
import type { WorklogRow, ProjectEarning } from '../types.js';

const isCzkEarned = (r: WorklogRow) => r.rateCurrency === 'CZK' && r.earnedAmount != null;

export interface EarningsSummaryResult {
  totalCzk: number;
  billableMinutes: number;
  unbillableMinutes: number;
  avgEffectiveHourlyRateCzk: number | null;
  perProject: ProjectEarning[];
}

export function earningsSummary(
  rows: WorklogRow[],
  opts: { from: string; to: string; projectId?: number },
): EarningsSummaryResult {
  const { from, to, projectId } = opts;
  let totalCzk = 0;
  let czkBillableMinutes = 0;
  let billableMinutes = 0;
  let unbillableMinutes = 0;
  const byProject = new Map<number, ProjectEarning>();

  for (const r of rows) {
    if (r.workDate < from || r.workDate > to) continue;
    if (projectId !== undefined && r.projectId !== projectId) continue;

    if (r.projectKind === 'work' && r.isBillable) billableMinutes += r.effectiveMinutes;
    if (r.projectKind === 'work' && !r.isBillable) unbillableMinutes += r.effectiveMinutes;

    if (r.isBillable && isCzkEarned(r)) {
      totalCzk += r.earnedAmount!;
      czkBillableMinutes += r.effectiveMinutes;
      const cur =
        byProject.get(r.projectId) ??
        { projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0 };
      cur.minutes += r.effectiveMinutes;
      cur.earnedCzk += r.earnedAmount!;
      byProject.set(r.projectId, cur);
    }
  }

  const avgEffectiveHourlyRateCzk = czkBillableMinutes > 0 ? totalCzk / (czkBillableMinutes / 60) : null;
  const perProject = [...byProject.values()].sort((a, b) => b.earnedCzk - a.earnedCzk);
  return { totalCzk, billableMinutes, unbillableMinutes, avgEffectiveHourlyRateCzk, perProject };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/billing/reports/earnings-summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
npx tsc -b packages/shared/tsconfig.json
git add packages/shared/src/billing/reports/earnings-summary.ts tests/shared/billing/reports/earnings-summary.test.ts
git commit -m "feat(ipad-r2): earningsSummary shared fn"
```

---

## Task 4: Project breakdown (`breakdown.ts`)

**Files:**
- Create: `packages/shared/src/billing/reports/breakdown.ts`
- Test: `tests/shared/billing/reports/breakdown.test.ts`

**Interfaces:**
- Consumes: `WorklogRow` from `../types.js`.
- Produces:
  - `interface ProjectBreakdownSlice { projectId: number; name: string; color: string | null; minutes: number; earnedCzk: number; share: number }`
  - `projectBreakdown(rows: WorklogRow[], opts: { from: string; to: string }): ProjectBreakdownSlice[]`

Mirrors `ReportsService.byProject` shape: group in-range worklogs by project, sum `effectiveMinutes` + CZK earnings, keep `minutes > 0`, `share = minutes / totalMinutes`, sort by minutes desc.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/billing/reports/breakdown.test.ts
import { describe, it, expect } from 'vitest';
import { projectBreakdown } from '../../../../packages/shared/src/billing/reports/breakdown.js';
import type { WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, rateCurrency: 'CZK', projectId: 1, projectName: 'P1',
    projectColor: '#fff', projectKind: 'work', isBillable: true,
    taskNumber: null, taskTitle: null, ...over,
  };
}

describe('projectBreakdown', () => {
  it('groups by project with minutes, CZK earnings, and share; sorted desc', () => {
    const rows = [
      wl({ projectId: 1, projectName: 'A', effectiveMinutes: 180, earnedAmount: 3000 }),
      wl({ projectId: 2, projectName: 'B', effectiveMinutes: 60, earnedAmount: 1000 }),
    ];
    const out = projectBreakdown(rows, { from: '2026-06-01', to: '2026-06-30' });
    expect(out).toEqual([
      { projectId: 1, name: 'A', color: '#fff', minutes: 180, earnedCzk: 3000, share: 0.75 },
      { projectId: 2, name: 'B', color: '#fff', minutes: 60, earnedCzk: 1000, share: 0.25 },
    ]);
  });

  it('drops projects with zero minutes and ignores out-of-range rows', () => {
    const rows = [
      wl({ projectId: 1, effectiveMinutes: 60, workDate: '2026-05-31' }),
      wl({ projectId: 2, effectiveMinutes: 120, workDate: '2026-06-10' }),
    ];
    const out = projectBreakdown(rows, { from: '2026-06-01', to: '2026-06-30' });
    expect(out.map((s) => s.projectId)).toEqual([2]);
    expect(out[0].share).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/billing/reports/breakdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/billing/reports/breakdown.ts
import type { WorklogRow } from '../types.js';

export interface ProjectBreakdownSlice {
  projectId: number;
  name: string;
  color: string | null;
  minutes: number;
  earnedCzk: number;
  share: number;
}

export function projectBreakdown(
  rows: WorklogRow[],
  opts: { from: string; to: string },
): ProjectBreakdownSlice[] {
  const { from, to } = opts;
  const map = new Map<number, Omit<ProjectBreakdownSlice, 'share'>>();
  for (const r of rows) {
    if (r.workDate < from || r.workDate > to) continue;
    const cur =
      map.get(r.projectId) ??
      { projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0 };
    cur.minutes += r.effectiveMinutes;
    if (r.rateCurrency === 'CZK' && r.earnedAmount != null) cur.earnedCzk += r.earnedAmount;
    map.set(r.projectId, cur);
  }
  const slices = [...map.values()].filter((s) => s.minutes > 0);
  const total = slices.reduce((acc, s) => acc + s.minutes, 0);
  return slices
    .map((s) => ({ ...s, share: total > 0 ? s.minutes / total : 0 }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/billing/reports/breakdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
npx tsc -b packages/shared/tsconfig.json
git add packages/shared/src/billing/reports/breakdown.ts tests/shared/billing/reports/breakdown.test.ts
git commit -m "feat(ipad-r2): projectBreakdown shared fn"
```

---

## Task 5: Range-scoped heatmap (`heatmap.ts` extend)

**Files:**
- Modify: `packages/shared/src/billing/heatmap.ts`
- Test: `tests/shared/billing/heatmap-range.test.ts`

**Interfaces:**
- Produces (new): `activityHeatmapRange(rows: WorklogRow[], opts: { from: string; to: string }): HeatmapResult`.
- Unchanged: `activityHeatmap(rows, { today, windowDays? }): HeatmapResult` must keep identical behavior.

Refactor the existing window logic into a private `buildHeatmap(rows, fromDate, toDate)` used by both entry points. Range mode zero-fills `[from, to]`, computes `currentStreak` walking back from `to`, and `weeklyAvgMinutes` over the range's day count.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/billing/heatmap-range.test.ts
import { describe, it, expect } from 'vitest';
import { activityHeatmap, activityHeatmapRange } from '../../../packages/shared/src/billing/heatmap.js';
import type { WorklogRow } from '../../../packages/shared/src/billing/types.js';

function wl(date: string, minutes: number): WorklogRow {
  return {
    syncId: date, workDate: date, minutes, effectiveMinutes: minutes,
    earnedAmount: null, rateCurrency: null, projectId: 1, projectName: 'P',
    projectColor: null, projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null,
  };
}

describe('activityHeatmapRange', () => {
  it('zero-fills the inclusive range and uses raw minutes per day', () => {
    const rows = [wl('2026-06-01', 60), wl('2026-06-03', 120)];
    const r = activityHeatmapRange(rows, { from: '2026-06-01', to: '2026-06-03' });
    expect(r.days).toEqual([
      { date: '2026-06-01', minutes: 60 },
      { date: '2026-06-02', minutes: 0 },
      { date: '2026-06-03', minutes: 120 },
    ]);
    expect(r.stats.activeDays).toBe(2);
    expect(r.stats.busiestDay).toBe('2026-06-03');
  });

  it('currentStreak counts consecutive active days ending at `to`', () => {
    const rows = [wl('2026-06-02', 30), wl('2026-06-03', 30)];
    const r = activityHeatmapRange(rows, { from: '2026-06-01', to: '2026-06-03' });
    expect(r.stats.currentStreak).toBe(2);
  });
});

describe('activityHeatmap (unchanged)', () => {
  it('still produces a windowDays-length series ending at today', () => {
    const rows = [wl('2026-06-10', 60)];
    const r = activityHeatmap(rows, { today: '2026-06-10', windowDays: 7 });
    expect(r.days).toHaveLength(7);
    expect(r.days[6]).toEqual({ date: '2026-06-10', minutes: 60 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/billing/heatmap-range.test.ts`
Expected: FAIL — `activityHeatmapRange` is not exported.

- [ ] **Step 3: Refactor + add the range entry point**

Replace the body of `packages/shared/src/billing/heatmap.ts` below the `HeatmapResult` interface and `addDays` helper with:

```ts
function buildHeatmap(rows: WorklogRow[], fromDate: string, toDate: string): HeatmapResult {
  // Aggregate raw minutes per date (mirrors SQL SUM(w.minutes) GROUP BY work_date).
  const grouped = new Map<string, number>();
  for (const row of rows) {
    if (row.workDate >= fromDate && row.workDate <= toDate) {
      grouped.set(row.workDate, (grouped.get(row.workDate) ?? 0) + row.minutes);
    }
  }

  // Zero-fill the inclusive [fromDate, toDate] window.
  const days: { date: string; minutes: number }[] = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    days.push({ date: cursor, minutes: grouped.get(cursor) ?? 0 });
    cursor = addDays(cursor, 1);
  }
  const windowDays = days.length;
  const map = new Map(days.map((d) => [d.date, d.minutes]));

  const activeDays = days.filter((d) => d.minutes > 0).length;
  const totalMinutes = days.reduce((acc, d) => acc + d.minutes, 0);
  const weeklyAvgMinutes = windowDays > 0 ? Math.round((totalMinutes / windowDays) * 7) : 0;

  // currentStreak: walk backward from toDate while minutes > 0.
  let streakCursor = toDate;
  let currentStreak = 0;
  while (map.has(streakCursor) && (map.get(streakCursor) ?? 0) > 0) {
    currentStreak++;
    streakCursor = addDays(streakCursor, -1);
  }

  // longestStreak: longest run of minutes > 0 in the window.
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

  // busiestDay: first date with max minutes > 0; null if none.
  let busiestDay: string | null = null;
  let busiestMinutes = 0;
  for (const d of days) {
    if (d.minutes > 0 && (busiestDay === null || d.minutes > busiestMinutes)) {
      busiestDay = d.date;
      busiestMinutes = d.minutes;
    }
  }

  return {
    days,
    stats: { currentStreak, longestStreak, activeDays, weeklyAvgMinutes, busiestDay },
  };
}

/**
 * Mirrors dashboardOverview.ts:heatmap30d + computeStats.
 * window = [today-(windowDays-1), today] inclusive.
 */
export function activityHeatmap(
  rows: WorklogRow[],
  opts: { today: string; windowDays?: number },
): HeatmapResult {
  const windowDays = opts.windowDays ?? 30;
  const fromDate = addDays(opts.today, -(windowDays - 1));
  return buildHeatmap(rows, fromDate, opts.today);
}

/** Range-scoped variant for the Reports tab: window = [from, to] inclusive. */
export function activityHeatmapRange(
  rows: WorklogRow[],
  opts: { from: string; to: string },
): HeatmapResult {
  return buildHeatmap(rows, opts.from, opts.to);
}
```

Keep the existing `import type { WorklogRow }`, the `HeatmapResult` interface, and the `addDays` helper at the top of the file.

- [ ] **Step 4: Run the new test AND the existing heatmap test**

Run: `npx vitest run tests/shared/billing/heatmap-range.test.ts tests/shared/billing/heatmap.test.ts`
Expected: PASS (range cases + the pre-existing `activityHeatmap` suite unchanged).

- [ ] **Step 5: Build + commit**

```bash
npx tsc -b packages/shared/tsconfig.json
git add packages/shared/src/billing/heatmap.ts tests/shared/billing/heatmap-range.test.ts
git commit -m "feat(ipad-r2): activityHeatmapRange (shared buildHeatmap core)"
```

---

## Task 6: Reports filter hook (`useReportsFilters.ts`)

**Files:**
- Create: `apps/ipad/src/state/useReportsFilters.ts`
- Test: `tests/ipad/useReportsFilters.test.ts`

**Interfaces:**
- Consumes: `Granularity` from `@watchtower/shared/billing/reports/buckets.js`.
- Produces (pure, exported for tests):
  - `type Preset = '7d' | '30d' | 'month' | 'year' | 'all'`
  - `resolvePreset(preset: Preset, today: string, earliest?: string): { from: string; to: string }`
  - `defaultGranularity(preset: Preset): Granularity`
  - `clampGranularity(g: Granularity, from: string, to: string): Granularity`
- Produces (hook): `useReportsFilters(today: string, earliest?: string)` → `{ preset, granularity, projectId, from, to, setPreset, setGranularity, setProjectId }`.

Clamp thresholds (from spec): span > 92 days bumps `day`→`week`; span > 1100 days bumps `week`→`month`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ipad/useReportsFilters.test.ts
import { describe, it, expect } from 'vitest';
import {
  resolvePreset, defaultGranularity, clampGranularity,
} from '../../apps/ipad/src/state/useReportsFilters.js';

describe('resolvePreset', () => {
  const today = '2026-06-15';
  it('7d → last 7 days inclusive', () => {
    expect(resolvePreset('7d', today)).toEqual({ from: '2026-06-09', to: '2026-06-15' });
  });
  it('30d → last 30 days inclusive', () => {
    expect(resolvePreset('30d', today)).toEqual({ from: '2026-05-17', to: '2026-06-15' });
  });
  it('month → first of month to today', () => {
    expect(resolvePreset('month', today)).toEqual({ from: '2026-06-01', to: '2026-06-15' });
  });
  it('year → Jan 1 to today', () => {
    expect(resolvePreset('year', today)).toEqual({ from: '2026-01-01', to: '2026-06-15' });
  });
  it('all → earliest (or today) to today', () => {
    expect(resolvePreset('all', today, '2023-09-01')).toEqual({ from: '2023-09-01', to: '2026-06-15' });
    expect(resolvePreset('all', today)).toEqual({ from: '2026-06-15', to: '2026-06-15' });
  });
});

describe('defaultGranularity', () => {
  it('maps presets to a sensible default', () => {
    expect(defaultGranularity('7d')).toBe('day');
    expect(defaultGranularity('30d')).toBe('day');
    expect(defaultGranularity('month')).toBe('day');
    expect(defaultGranularity('year')).toBe('month');
    expect(defaultGranularity('all')).toBe('month');
  });
});

describe('clampGranularity', () => {
  it('bumps day→week beyond 92 days', () => {
    expect(clampGranularity('day', '2026-01-01', '2026-03-01')).toBe('day');   // 59 days
    expect(clampGranularity('day', '2026-01-01', '2026-06-01')).toBe('week');  // 151 days
  });
  it('bumps week→month beyond 1100 days', () => {
    expect(clampGranularity('week', '2023-01-01', '2026-06-01')).toBe('month'); // >1100 days
  });
  it('never downgrades an explicit month choice', () => {
    expect(clampGranularity('month', '2026-06-01', '2026-06-07')).toBe('month');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipad/useReportsFilters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/ipad/src/state/useReportsFilters.ts
import { useState, useCallback } from 'react';
import type { Granularity } from '@watchtower/shared/billing/reports/buckets.js';

export type Preset = '7d' | '30d' | 'month' | 'year' | 'all';

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function spanDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000) + 1; // inclusive
}

export function resolvePreset(preset: Preset, today: string, earliest?: string): { from: string; to: string } {
  switch (preset) {
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'month': return { from: today.slice(0, 7) + '-01', to: today };
    case 'year': return { from: today.slice(0, 4) + '-01-01', to: today };
    case 'all': return { from: earliest ?? today, to: today };
  }
}

export function defaultGranularity(preset: Preset): Granularity {
  if (preset === 'year' || preset === 'all') return 'month';
  return 'day';
}

export function clampGranularity(g: Granularity, from: string, to: string): Granularity {
  const span = spanDays(from, to);
  if (g === 'day' && span > 92) return 'week';
  if (g === 'week' && span > 1100) return 'month';
  return g;
}

export interface ReportsFilters {
  preset: Preset;
  granularity: Granularity;
  projectId: number | undefined;
  from: string;
  to: string;
  setPreset(p: Preset): void;
  setGranularity(g: Granularity): void;
  setProjectId(id: number | undefined): void;
}

export function useReportsFilters(today: string, earliest?: string): ReportsFilters {
  const [preset, setPresetState] = useState<Preset>('30d');
  const [granularityChoice, setGranularityChoice] = useState<Granularity | null>(null);
  const [projectId, setProjectId] = useState<number | undefined>(undefined);

  const { from, to } = resolvePreset(preset, today, earliest);
  const base = granularityChoice ?? defaultGranularity(preset);
  const granularity = clampGranularity(base, from, to);

  const setPreset = useCallback((p: Preset) => {
    setPresetState(p);
    setGranularityChoice(null); // revert to auto-default for the new preset
  }, []);

  const setGranularity = useCallback((g: Granularity) => setGranularityChoice(g), []);

  return { preset, granularity, projectId, from, to, setPreset, setGranularity, setProjectId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ipad/useReportsFilters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/useReportsFilters.ts tests/ipad/useReportsFilters.test.ts
git commit -m "feat(ipad-r2): useReportsFilters hook + preset/granularity helpers"
```

---

## Task 7: Reports color tokens (`reports/tokens.ts`)

**Files:**
- Create: `apps/ipad/src/components/billing/reports/tokens.ts`

**Interfaces:**
- Produces: `export const C` — the same dark palette used by `DashboardView` (re-declared locally to avoid refactoring R1 components).

This is a tiny shared-constant module; no test. Fold its verification into Task 8's typecheck.

- [ ] **Step 1: Create the tokens module**

```ts
// apps/ipad/src/components/billing/reports/tokens.ts
// Shared dark palette for the Reports panels. Mirrors DashboardView's tokens.
export const C = {
  ground: '#0F0F17',
  surface: '#16161F',
  border: '#2a2a3c',
  muted: '#8B88A6',
  text: '#e2e1f0',
  violet: '#A78BFA',
  violetDim: '#6d5fbb',
  violetBg: '#2d2857',
  cyan: '#22D3EE',
  amber: '#fbbf24',
  red: '#f87171',
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add apps/ipad/src/components/billing/reports/tokens.ts
git commit -m "feat(ipad-r2): reports color tokens"
```

---

## Task 8: Filter bar component (`ReportsFilterBar.tsx`)

**Files:**
- Create: `apps/ipad/src/components/billing/reports/ReportsFilterBar.tsx`

**Interfaces:**
- Consumes: `C` from `./tokens.js`; `Preset` from `../../../state/useReportsFilters.js`; `Granularity` from `@watchtower/shared/billing/reports/buckets.js`; `ProjectRow` from `@watchtower/shared/billing/types.js`.
- Produces: `ReportsFilterBar` component.

```tsx
interface ReportsFilterBarProps {
  preset: Preset;
  granularity: Granularity;
  projectId: number | undefined;
  projects: ProjectRow[];
  from: string;
  to: string;
  onPreset(p: Preset): void;
  onGranularity(g: Granularity): void;
  onProject(id: number | undefined): void;
}
```

- [ ] **Step 1: Implement the component**

```tsx
// apps/ipad/src/components/billing/reports/ReportsFilterBar.tsx
import { C } from './tokens.js';
import type { Preset } from '../../../state/useReportsFilters.js';
import { clampGranularity } from '../../../state/useReportsFilters.js';
import type { Granularity } from '@watchtower/shared/billing/reports/buckets.js';
import type { ProjectRow } from '@watchtower/shared/billing/types.js';

const PRESETS: { key: Preset; label: string }[] = [
  { key: '7d', label: '7 dní' },
  { key: '30d', label: '30 dní' },
  { key: 'month', label: 'Tento měsíc' },
  { key: 'year', label: 'Tento rok' },
  { key: 'all', label: 'Vše' },
];

const GRANS: { key: Granularity; label: string }[] = [
  { key: 'day', label: 'Den' },
  { key: 'week', label: 'Týden' },
  { key: 'month', label: 'Měsíc' },
];

interface ReportsFilterBarProps {
  preset: Preset;
  granularity: Granularity;
  projectId: number | undefined;
  projects: ProjectRow[];
  from: string;
  to: string;
  onPreset(p: Preset): void;
  onGranularity(g: Granularity): void;
  onProject(id: number | undefined): void;
}

function pill(active: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '5px 12px',
    borderRadius: 7,
    border: 'none',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    background: active ? C.violetBg : 'transparent',
    color: active ? C.violet : C.muted,
  };
}

export function ReportsFilterBar(props: ReportsFilterBarProps): JSX.Element {
  const { preset, granularity, projectId, projects, from, to } = props;
  // A granularity option is unavailable if the clamp would bump it for this range.
  const granDisabled = (g: Granularity) => clampGranularity(g, from, to) !== g;

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: C.ground,
        borderBottom: `1px solid ${C.border}`,
        padding: '10px 16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 12px',
      }}
    >
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <button key={p.key} style={pill(preset === p.key)} onClick={() => props.onPreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 18, background: C.border }} />

      <div style={{ display: 'flex', gap: 4 }}>
        {GRANS.map((g) => {
          const disabled = granDisabled(g.key);
          return (
            <button
              key={g.key}
              disabled={disabled}
              style={pill(granularity === g.key, disabled)}
              onClick={() => !disabled && props.onGranularity(g.key)}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <select
        value={projectId ?? ''}
        onChange={(e) => props.onProject(e.target.value === '' ? undefined : Number(e.target.value))}
        style={{
          background: C.surface,
          color: C.text,
          border: `1px solid ${C.border}`,
          borderRadius: 7,
          padding: '5px 10px',
          fontSize: 13,
          fontFamily: 'inherit',
        }}
      >
        <option value="">Všechny projekty</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name || '(bez názvu)'}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b packages/shared/tsconfig.json && npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: no new errors in `reports/`.

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/components/billing/reports/ReportsFilterBar.tsx
git commit -m "feat(ipad-r2): ReportsFilterBar (presets + granularity + project)"
```

---

## Task 9: Trend chart component (`TrendChart.tsx`)

**Files:**
- Create: `apps/ipad/src/components/billing/reports/TrendChart.tsx`

**Interfaces:**
- Consumes: `C` from `./tokens.js`; `TrendBucket` from `@watchtower/shared/billing/reports/trend.js`; `RateMarker` from same; `enumerateBuckets`, `Granularity` from `@watchtower/shared/billing/reports/buckets.js`; `formatCzk`, `formatHours` from `../../../lib/czFormat.js`.
- Produces: `TrendChart` component.

```tsx
interface TrendChartProps {
  series: TrendBucket[];     // sparse (empty buckets omitted)
  markers: RateMarker[];     // rate-change markers (empty unless single project)
  from: string;
  to: string;
  granularity: Granularity;
}
```

Gap-fills via `enumerateBuckets(from, to, granularity)` so empty buckets render as zero-height bars. Bar height encodes hours; tap/hover shows hours + CZK. Rate markers drawn as dashed vertical lines at the bucket matching `effectiveFrom`.

- [ ] **Step 1: Implement the component**

```tsx
// apps/ipad/src/components/billing/reports/TrendChart.tsx
import { useState } from 'react';
import { C } from './tokens.js';
import type { TrendBucket, RateMarker } from '@watchtower/shared/billing/reports/trend.js';
import { bucketKey, enumerateBuckets, type Granularity } from '@watchtower/shared/billing/reports/buckets.js';
import { formatCzk, formatHours } from '../../../lib/czFormat.js';

interface TrendChartProps {
  series: TrendBucket[];
  markers: RateMarker[];
  from: string;
  to: string;
  granularity: Granularity;
}

function bucketLabel(bucket: string, g: Granularity): string {
  if (g === 'month') return bucket.replace('-', '/');      // 2026-06 → 2026/06
  if (g === 'week') return bucket.split('-W')[1] ?? bucket; // 2026-W23 → 23
  return bucket.slice(8);                                   // 2026-06-07 → 07
}

export function TrendChart({ series, markers, from, to, granularity }: TrendChartProps): JSX.Element {
  const [active, setActive] = useState<string | null>(null);

  const order = enumerateBuckets(from, to, granularity);
  const byBucket = new Map(series.map((s) => [s.bucket, s]));
  const filled = order.map((b) => byBucket.get(b) ?? { bucket: b, minutes: 0, earnedCzk: 0 });
  const maxMinutes = Math.max(...filled.map((b) => b.minutes), 1);
  const markerBuckets = new Set(markers.map((m) => bucketKey(m.effectiveFrom, granularity)));

  if (filled.length === 0) {
    return <div style={{ fontSize: 13, color: C.muted, padding: '8px 0' }}>žádná data</div>;
  }

  const shown = active != null ? byBucket.get(active) ?? { bucket: active, minutes: 0, earnedCzk: 0 } : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ height: 18, fontSize: 12, color: C.muted }}>
        {shown
          ? `${bucketLabel(shown.bucket, granularity)}: ${formatHours(shown.minutes)} · ${formatCzk(shown.earnedCzk)}`
          : 'klepnutím zobrazíte detail'}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 2,
          height: 140,
          overflowX: 'auto',
          paddingBottom: 2,
        }}
      >
        {filled.map((b) => {
          const isMarker = markerBuckets.has(b.bucket);
          return (
            <div
              key={b.bucket}
              onClick={() => setActive(b.bucket)}
              style={{
                flex: '1 0 10px',
                minWidth: 6,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                height: '100%',
                position: 'relative',
                cursor: 'pointer',
                // dashed rate-change marker overlay
                borderLeft: isMarker ? `1px dashed ${C.cyan}` : 'none',
              }}
            >
              <div
                style={{
                  height: `${(b.minutes / maxMinutes) * 100}%`,
                  background: active === b.bucket ? C.violet : C.violetDim,
                  borderRadius: '3px 3px 0 0',
                  minHeight: b.minutes > 0 ? 2 : 0,
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted }}>
        <span>{bucketLabel(filled[0].bucket, granularity)}</span>
        <span>{bucketLabel(filled[filled.length - 1].bucket, granularity)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/components/billing/reports/TrendChart.tsx
git commit -m "feat(ipad-r2): TrendChart (gap-filled bars + rate markers)"
```

---

## Task 10: Earnings summary panel (`EarningsSummaryPanel.tsx`)

**Files:**
- Create: `apps/ipad/src/components/billing/reports/EarningsSummaryPanel.tsx`

**Interfaces:**
- Consumes: `C` from `./tokens.js`; `EarningsSummaryResult` from `@watchtower/shared/billing/reports/earnings-summary.js`; `formatCzk`, `formatHours` from `../../../lib/czFormat.js`.
- Produces: `EarningsSummaryPanel` component.

```tsx
interface EarningsSummaryPanelProps {
  summary: EarningsSummaryResult;
  onOpenProject(id: number): void;
}
```

- [ ] **Step 1: Implement the component**

```tsx
// apps/ipad/src/components/billing/reports/EarningsSummaryPanel.tsx
import { C } from './tokens.js';
import type { EarningsSummaryResult } from '@watchtower/shared/billing/reports/earnings-summary.js';
import { formatCzk, formatHours } from '../../../lib/czFormat.js';

interface EarningsSummaryPanelProps {
  summary: EarningsSummaryResult;
  onOpenProject(id: number): void;
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ? C.violet : C.text, lineHeight: 1.2 }}>
        {value}
      </div>
    </div>
  );
}

export function EarningsSummaryPanel({ summary, onOpenProject }: EarningsSummaryPanelProps): JSX.Element {
  const maxEarned = Math.max(...summary.perProject.map((p) => p.earnedCzk), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Tile label="Celkem vyděláno" value={formatCzk(summary.totalCzk)} accent />
        <Tile label="Účtovatelné" value={formatHours(summary.billableMinutes)} />
        <Tile label="Neúčtovatelné" value={formatHours(summary.unbillableMinutes)} />
        <Tile
          label="Prům. sazba"
          value={summary.avgEffectiveHourlyRateCzk != null ? `${formatCzk(summary.avgEffectiveHourlyRateCzk)}/h` : '–'}
        />
      </div>

      {summary.perProject.length > 0 && (
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {summary.perProject.map((p) => (
            <div
              key={p.projectId}
              onClick={() => onOpenProject(p.projectId)}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {p.color && (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, fontSize: 13, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name || '(bez názvu)'}
                </div>
                <div style={{ fontSize: 12, color: C.violet, flexShrink: 0 }}>{formatCzk(p.earnedCzk)}</div>
              </div>
              <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(p.earnedCzk / maxEarned) * 100}%`, height: '100%', background: p.color ?? C.violet, borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/components/billing/reports/EarningsSummaryPanel.tsx
git commit -m "feat(ipad-r2): EarningsSummaryPanel (tiles + per-project bars)"
```

---

## Task 11: Project donut (`ProjectDonut.tsx`)

**Files:**
- Create: `apps/ipad/src/components/billing/reports/ProjectDonut.tsx`

**Interfaces:**
- Consumes: `C` from `./tokens.js`; `ProjectBreakdownSlice` from `@watchtower/shared/billing/reports/breakdown.js`; `formatHours` from `../../../lib/czFormat.js`.
- Produces: `ProjectDonut` component.

```tsx
interface ProjectDonutProps {
  slices: ProjectBreakdownSlice[];
  onOpenProject(id: number): void;
}
```

SVG donut via stroke-dasharray arcs on concentric circles; center label = total hours; legend rows tappable. Fallback palette for slices with no project color.

- [ ] **Step 1: Implement the component**

```tsx
// apps/ipad/src/components/billing/reports/ProjectDonut.tsx
import { C } from './tokens.js';
import type { ProjectBreakdownSlice } from '@watchtower/shared/billing/reports/breakdown.js';
import { formatHours } from '../../../lib/czFormat.js';

interface ProjectDonutProps {
  slices: ProjectBreakdownSlice[];
  onOpenProject(id: number): void;
}

const FALLBACK = ['#A78BFA', '#22D3EE', '#fbbf24', '#f87171', '#34d399', '#f472b6', '#60a5fa', '#a3e635'];

export function ProjectDonut({ slices, onOpenProject }: ProjectDonutProps): JSX.Element {
  if (slices.length === 0) {
    return <div style={{ fontSize: 13, color: C.muted, padding: '8px 0' }}>žádná data</div>;
  }

  const totalMinutes = slices.reduce((acc, s) => acc + s.minutes, 0);
  const R = 60;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;

  const colored = slices.map((s, i) => ({ ...s, drawColor: s.color ?? FALLBACK[i % FALLBACK.length] }));

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div style={{ position: 'relative', width: 150, height: 150, flexShrink: 0 }}>
        <svg width={150} height={150} viewBox="0 0 150 150">
          <g transform="rotate(-90 75 75)">
            {colored.map((s) => {
              const len = s.share * CIRC;
              const dash = `${len} ${CIRC - len}`;
              const circle = (
                <circle
                  key={s.projectId}
                  cx={75}
                  cy={75}
                  r={R}
                  fill="none"
                  stroke={s.drawColor}
                  strokeWidth={22}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return circle;
            })}
          </g>
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{formatHours(totalMinutes)}</div>
          <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>celkem</div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {colored.map((s) => (
          <div
            key={s.projectId}
            onClick={() => onOpenProject(s.projectId)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          >
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.drawColor, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 13, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.name || '(bez názvu)'}
            </div>
            <div style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{formatHours(s.minutes)}</div>
            <div style={{ fontSize: 12, color: C.muted, width: 38, textAlign: 'right', flexShrink: 0 }}>
              {Math.round(s.share * 100)} %
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/components/billing/reports/ProjectDonut.tsx
git commit -m "feat(ipad-r2): ProjectDonut (SVG arcs + tappable legend)"
```

---

## Task 12: Activity heatmap panel (`ActivityHeatmapPanel.tsx`)

**Files:**
- Create: `apps/ipad/src/components/billing/reports/ActivityHeatmapPanel.tsx`

**Interfaces:**
- Consumes: `C` from `./tokens.js`; `HeatmapResult` from `@watchtower/shared/billing/heatmap.js`; `formatHours`, `formatDateCz` from `../../../lib/czFormat.js`.
- Produces: `ActivityHeatmapPanel` component.

```tsx
interface ActivityHeatmapPanelProps {
  heatmap: HeatmapResult;
}
```

Renders the zero-filled days as a wrap-flow grid of intensity cells + a stat strip (mirrors the Dashboard heatmap visual, but range-driven and width-flexible).

- [ ] **Step 1: Implement the component**

```tsx
// apps/ipad/src/components/billing/reports/ActivityHeatmapPanel.tsx
import { C } from './tokens.js';
import type { HeatmapResult } from '@watchtower/shared/billing/heatmap.js';
import { formatHours, formatDateCz } from '../../../lib/czFormat.js';

interface ActivityHeatmapPanelProps {
  heatmap: HeatmapResult;
}

function cellColor(minutes: number, max: number): string {
  if (minutes === 0 || max === 0) return C.border;
  const ratio = minutes / max;
  if (ratio < 0.25) return C.violetDim + '55';
  if (ratio < 0.5) return C.violetDim;
  if (ratio < 0.75) return C.violet + 'cc';
  return C.violet;
}

export function ActivityHeatmapPanel({ heatmap }: ActivityHeatmapPanelProps): JSX.Element {
  const { days, stats } = heatmap;
  const max = Math.max(...days.map((d) => d.minutes), 1);

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {days.map((d) => (
          <div
            key={d.date}
            title={`${formatDateCz(d.date)}: ${d.minutes > 0 ? formatHours(d.minutes) : '–'}`}
            style={{ width: 13, height: 13, borderRadius: 3, background: cellColor(d.minutes, max) }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: 12, color: C.muted }}>
        <span><strong style={{ color: C.violet }}>{stats.currentStreak}</strong> dní v řadě</span>
        <span>nejdelší série: <strong style={{ color: C.text }}>{stats.longestStreak}</strong></span>
        <span>aktivní dny: <strong style={{ color: C.text }}>{stats.activeDays}</strong></span>
        <span>průměr/týden: <strong style={{ color: C.text }}>{formatHours(stats.weeklyAvgMinutes)}</strong></span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/components/billing/reports/ActivityHeatmapPanel.tsx
git commit -m "feat(ipad-r2): ActivityHeatmapPanel (range heatmap + stats)"
```

---

## Task 13: Compose ReportsView + wire the Reporty tab

**Files:**
- Create: `apps/ipad/src/components/billing/ReportsView.tsx`
- Modify: `apps/ipad/src/components/billing/BillingModule.tsx`

**Interfaces:**
- Consumes: `useBilling` (`../../state/useBilling.js`), `useReportsFilters` (`../../state/useReportsFilters.js`), all four panels + filter bar, and the shared report fns.
- Produces: `ReportsView` component (props: `{ onOpenProject(id: number): void }`).

`ReportsView` reads the cached dataset, derives the earliest worklog date for the "Vše" preset, computes each panel's data with the shared fns memoized on `{ data, filters }`, and lays the panels out under the sticky filter bar. `BillingModule` gains a `'reports'` tab between Výdělky and the future Záznamy.

- [ ] **Step 1: Implement `ReportsView`**

```tsx
// apps/ipad/src/components/billing/ReportsView.tsx
import { useMemo } from 'react';
import { useBilling } from '../../state/useBilling.js';
import { useReportsFilters } from '../../state/useReportsFilters.js';
import { trendSeries, rateChangeMarkers } from '@watchtower/shared/billing/reports/trend.js';
import { earningsSummary } from '@watchtower/shared/billing/reports/earnings-summary.js';
import { projectBreakdown } from '@watchtower/shared/billing/reports/breakdown.js';
import { activityHeatmapRange } from '@watchtower/shared/billing/heatmap.js';
import { ReportsFilterBar } from './reports/ReportsFilterBar.js';
import { TrendChart } from './reports/TrendChart.js';
import { EarningsSummaryPanel } from './reports/EarningsSummaryPanel.js';
import { ProjectDonut } from './reports/ProjectDonut.js';
import { ActivityHeatmapPanel } from './reports/ActivityHeatmapPanel.js';
import { C } from './reports/tokens.js';

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function ReportsView({ onOpenProject }: { onOpenProject(id: number): void }): JSX.Element {
  const { data, state } = useBilling();
  const today = new Date().toISOString().slice(0, 10);

  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];
  const contracts = data?.contracts ?? [];

  const earliest = useMemo(
    () => (worklogs.length ? worklogs.reduce((min, r) => (r.workDate < min ? r.workDate : min), worklogs[0].workDate) : undefined),
    [worklogs],
  );

  const f = useReportsFilters(today, earliest);

  const trend = useMemo(
    () => trendSeries(worklogs, { from: f.from, to: f.to, granularity: f.granularity, projectId: f.projectId }),
    [worklogs, f.from, f.to, f.granularity, f.projectId],
  );
  const markers = useMemo(
    () => rateChangeMarkers(contracts, { from: f.from, to: f.to, projectId: f.projectId }),
    [contracts, f.from, f.to, f.projectId],
  );
  const earnings = useMemo(
    () => earningsSummary(worklogs, { from: f.from, to: f.to, projectId: f.projectId }),
    [worklogs, f.from, f.to, f.projectId],
  );
  const breakdown = useMemo(
    () => projectBreakdown(worklogs, { from: f.from, to: f.to }),
    [worklogs, f.from, f.to],
  );
  const heatmap = useMemo(
    () => activityHeatmapRange(worklogs, { from: f.from, to: f.to }),
    [worklogs, f.from, f.to],
  );

  if (state === 'loading' && data == null) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 15, fontFamily: 'system-ui, sans-serif' }}>
        Načítání…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', background: C.ground, minHeight: '100%', color: C.text }}>
      <ReportsFilterBar
        preset={f.preset}
        granularity={f.granularity}
        projectId={f.projectId}
        projects={projects}
        from={f.from}
        to={f.to}
        onPreset={f.setPreset}
        onGranularity={f.setGranularity}
        onProject={f.setProjectId}
      />
      <div style={{ padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Section title="Trend">
          <TrendChart series={trend} markers={markers} from={f.from} to={f.to} granularity={f.granularity} />
        </Section>
        <Section title="Výdělky">
          <EarningsSummaryPanel summary={earnings} onOpenProject={onOpenProject} />
        </Section>
        <Section title="Podle projektů">
          <ProjectDonut slices={breakdown} onOpenProject={onOpenProject} />
        </Section>
        <Section title="Aktivita">
          <ActivityHeatmapPanel heatmap={heatmap} />
        </Section>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the Reporty tab into `BillingModule.tsx`**

Make these edits to `apps/ipad/src/components/billing/BillingModule.tsx`:

1. Add the import:
```tsx
import { ReportsView } from './ReportsView.js';
```

2. Widen the tab union:
```tsx
type BillingTab = 'dashboard' | 'earnings' | 'reports';
```

3. Add the tab button after the Výdělky button (before the spacer `<div style={{ flex: 1 }} />`):
```tsx
        <button
          style={{
            ...TAB_STYLE_BASE,
            backgroundColor: activeTab === 'reports' ? '#2d2857' : 'transparent',
            color: activeTab === 'reports' ? '#a89cf0' : '#9ca3af',
          }}
          onClick={() => { setActiveTab('reports'); setSelectedProject(null); }}
        >
          Reporty
        </button>
```

4. Replace the tab-content ternary with a switch on `activeTab`:
```tsx
      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'earnings' && <EarningsMonthView onOpenProject={(id) => setSelectedProject(id)} />}
        {activeTab === 'reports' && <ReportsView onOpenProject={(id) => setSelectedProject(id)} />}
      </div>
```

- [ ] **Step 3: Typecheck both projects**

Run: `npx tsc -b packages/shared/tsconfig.json && npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: PASS — all prior tests plus the new `tests/shared/billing/reports/*` and `tests/ipad/useReportsFilters.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/components/billing/ReportsView.tsx apps/ipad/src/components/billing/BillingModule.tsx
git commit -m "feat(ipad-r2): ReportsView + wire Reporty tab"
```

---

## Final verification

- [ ] **Build shared + typecheck both projects:**
  `npx tsc -b packages/shared/tsconfig.json && npx tsc -p apps/ipad/tsconfig.json --noEmit`
- [ ] **Full suite green:** `npm test` (must be ≥ prior count + the new R2 tests).
- [ ] **Device/web smoke (manual, post-merge):** `npm run build:dev` for the iPad bundle, open the Reporty tab, sanity-check each panel and the preset/granularity/project filters against the desktop Reports for the same range.

## Self-review notes (for the executor)
- The single highest-risk port is `bucketKey` week mode — keep the `strftime('%W')` semantics exactly as tested (Monday-first, week 00).
- Every shared task must run `npx tsc -b packages/shared/tsconfig.json` before the iPad app can import the new files — the `@watchtower/shared` package is consumed as built JS.
- UI tasks have no DOM tests by design; their gate is `tsc --noEmit`. Don't add render tests.
</content>
</invoke>
