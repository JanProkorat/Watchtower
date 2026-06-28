# iPad Billing Module — R2 (Reports) Design

**Roadmap:** Sub-project #2 of the iPad billing module (read module). This is **R2 of 3** — R1 (Dashboard) shipped (PR #109); R3 (Records) follows as its own spec → plan → build cycle.
**Depends on:** R1 (PR #109) — the Supabase-direct data plane, `useBilling` SWR cache, `BillingModule` tab shell, the `packages/shared/src/billing/` aggregation layer, and `apps/ipad/src/lib/czFormat.ts` are all in place and reused verbatim.
**Spec for R1:** `docs/superpowers/specs/2026-06-27-ipad-billing-r1-dashboard-design.md`
**Orchestrator source mirrored:** `orchestrator/db/reports.ts` (`ReportsService.trend / byProject / earnings / heatmap / rateChanges`).

## Overview

A **read-only** Reports (Reporty) tab on the iPad billing module. It adds a fourth tab alongside Přehled (Dashboard) and Výdělky (Earnings), computing four report panels **entirely on-device from the already-cached `BillingDataset`** that `useBilling` fetches. No new Supabase queries, no sync/schema/data-plane changes, no new fetch path — Reports is a pure new *consumer* of existing cached data plus new pure aggregation functions in `@watchtower/shared`.

The four panels, top to bottom, under a shared sticky filter bar:

1. **Trend chart** — bars of hours + CZK earnings per time bucket (day/week/month), with vertical dashed rate-change markers.
2. **Earnings summary** — metric tiles (total earned CZK, billable hours, unbillable hours, avg effective hourly rate) + a per-project earnings bar.
3. **By-project breakdown** — an SVG donut + legend (center = total hours), split by project over the range.
4. **Activity heatmap** — calendar-grid heatmap of minutes/day + streak stats.

(Contract-burn cards are intentionally **not** in Reports — they already ship on the R1 Dashboard.)

## Global Constraints

- **Read-only.** No writes/mutations. Editing is sub-project #3.
- **No new data fetch.** All panels read the in-memory `BillingDataset` from `useBilling` (`worklogs`, `contracts`, `daysOff`, `projects`). Filters re-run pure aggregations against that array — instant and offline. Reports requires **no** PostgREST/sync/migration changes.
- **Sum precomputed fields — do NOT re-resolve contracts per worklog.** Worklog rows carry derived `earnedAmount`, `effectiveMinutes`, `rateCurrency`. The new shared functions mirror the orchestrator's **bucketing / grouping / output shape**, but compute by summing these precomputed fields — they do **not** replicate the orchestrator's `PROJECT_RATE_PERIODS_CTE` / `SUM_EARNED` rate-period SQL. This is the same discipline R1 used for `aggregateMonthEarnings` / `topProjects`.
- **CZK only.** Earnings sum only `rateCurrency = 'CZK'` rows (issue #108). Never sum across currencies; surface (don't silently merge) any non-CZK row. R2 displays a single CZK figure; non-CZK billable minutes still count toward *hours* totals but contribute no earnings.
- **Hours + CZK earnings only — no man-days (MD) in R2.** The desktop reports show MD alongside hours, derived from each worklog's contract `hours_per_day`. That value is **not** synced onto worklog rows, so computing it on iPad would require re-resolving contracts per worklog — exactly what the "sum precomputed fields" rule forbids. R2 therefore reports **hours** (from `effectiveMinutes`) and **CZK earnings** (from `earnedAmount`). MD-centric information already lives on the Dashboard's contract-burn cards (R1). *(Deliberate simplification vs. desktop; revisit only if dogfooding demands MD here.)*
- **`@watchtower/shared` is `packages/shared/`**, subpath imports by explicit filename (`@watchtower/shared/billing/reports/<file>.js`), **no barrel**. Adding files requires `npx tsc -b packages/shared/tsconfig.json` before `apps/ipad` can import them.
- **apps/ipad:** plain React + inline styles, **no MUI**, no charting library (CSS + hand-rolled SVG only). Czech locale, cs-CZ formatting via existing `czFormat.ts`, no i18n.
- **iPad tests are logic-only** (no DOM/render). Testable logic lives in `packages/shared` and `apps/ipad/src/state`; UI components verify via typecheck + the mockup.
- Never edit `.env*`. Do not commit `dist/` / build output.
- Worktree: created at execution time (branch `feat/ipad-billing-r2`).

## Architecture & Data Flow

```
useBilling()  ──►  BillingDataset { worklogs, contracts, daysOff, projects, fetchedAt }
                        │  (already cached, SWR; unchanged by R2)
                        ▼
ReportsView ── useReportsFilters() ──► { from, to, granularity, projectId }
   │                                        │
   │   (filter state, component-local)      ▼
   └─► for each panel: pure shared fn(dataset rows, resolved filter) ──► panel props
          trendSeries / rateChangeMarkers / earningsSummary / projectBreakdown / activityHeatmap(range)
```

- **Filter state** lives in a `useReportsFilters` hook (component-local React state; not persisted to the cache). It holds `{ preset, granularity, projectId }` and exposes the resolved `{ from, to }` plus the effective granularity (after auto-default + clamp).
- Changing any filter re-derives all four panels synchronously from the in-memory dataset. No I/O, works offline.
- The dataset's `worklogs` are pre-filtered to nothing extra; each shared fn applies its own `from`/`to`/`projectId`/CZK filtering over the full array.

## New shared functions (`packages/shared/src/billing/reports/`)

All pure, plain-array in / plain-object out, no I/O. Each mirrors the named `ReportsService` method's bucketing/grouping/output semantics, computing from precomputed per-worklog fields. One vitest file each.

### `reports/buckets.ts`
- `bucketKey(date: string, granularity: Granularity): string` — mirrors `BUCKET_EXPR`:
  - `day` → `YYYY-MM-DD`
  - `week` → `YYYY-W%W` where `%W` matches **SQLite `strftime('%W')`** (week of year, Monday as first day, `00`–`53`, week `00` = days before the year's first Monday). Ported precisely; unit-tested against known SQLite outputs including the week-00 edge and year boundaries.
  - `month` → `YYYY-MM`
- `type Granularity = 'day' | 'week' | 'month'` (re-exported from a shared location; matches `orchestrator/db/reports.ts`).

### `reports/trend.ts`
- `trendSeries(rows, { from, to, granularity, projectId? }): TrendBucket[]`
  - `TrendBucket = { bucket: string; minutes: number; earnedCzk: number }`
  - Mirrors `ReportsService.trend`: filter `workDate ∈ [from,to]` (and `projectId` if set), group by `bucketKey`, **sum `effectiveMinutes`** for `minutes`, **sum `earnedAmount` where `rateCurrency = 'CZK'`** for `earnedCzk`. Sorted by bucket ascending. Buckets with no worklogs are omitted (matches the orchestrator's `GROUP BY` — gap-fill is a UI concern, see Trend chart panel).
- `rateChangeMarkers(contracts, { from, to, projectId }): RateMarker[]`
  - `RateMarker = { effectiveFrom: string; rateType: 'hourly' | 'daily'; rateAmount: number; currency: string }`
  - Mirrors `ReportsService.rateChanges`: per project, order `contracts` by `effectiveFrom`, take rows with **rank > 1** (i.e. an actual *change*, not the first contract) whose `effectiveFrom ∈ [from,to]`. **Only emitted when `projectId` is set** (rate changes are per-project; an "All projects" overlay would be ambiguous). Sorted ascending.

### `reports/earnings-summary.ts`
- `earningsSummary(rows, { from, to, projectId? }): EarningsSummaryResult`
  - `EarningsSummaryResult = { totalCzk: number; billableMinutes: number; unbillableMinutes: number; avgEffectiveHourlyRateCzk: number | null; perProject: ProjectEarning[] }`
  - Mirrors `ReportsService.earnings` (CZK-only projection):
    - `billableMinutes` = Σ `effectiveMinutes` where `projectKind = 'work' && isBillable`.
    - `unbillableMinutes` = Σ `effectiveMinutes` where `projectKind = 'work' && !isBillable`.
    - `totalCzk` = Σ `earnedAmount` where `isBillable && rateCurrency = 'CZK' && earnedAmount != null`.
    - `czkBillableMinutes` = Σ `effectiveMinutes` over the **same** rows that contribute to `totalCzk` (`isBillable && rateCurrency = 'CZK' && earnedAmount != null`).
    - `avgEffectiveHourlyRateCzk` = `totalCzk / (czkBillableMinutes / 60)`; `null` if `czkBillableMinutes = 0` (mirrors the orchestrator's `billable_minutes > 0` guard).
    - `perProject` = `ProjectEarning[]` (reuse R1's existing type), CZK earnings + minutes per billable project, sorted by `earnedCzk` desc.
  - `time_off` minutes are excluded from billable/unbillable (mirrors the orchestrator's `kind` split).

### `reports/breakdown.ts`
- `projectBreakdown(rows, { from, to }): ProjectBreakdownSlice[]`
  - `ProjectBreakdownSlice = { projectId: number; name: string; color: string | null; minutes: number; earnedCzk: number; share: number }`
  - Mirrors `ReportsService.byProject` shape: group all worklogs in range by project, sum `effectiveMinutes` (`minutes`) and CZK `earnedAmount` (`earnedCzk`), keep only `minutes > 0`, sort by `minutes` desc. `share` = project minutes / total minutes (0–1), for the donut arc + legend %.

### `reports/heatmap.ts` (extend existing `heatmap.ts`)
- Add an explicit-range entry point alongside the existing 30-day `activityHeatmap(rows, { today, windowDays? })` (keep that path untouched for the Dashboard).
- `activityHeatmapRange(rows, { from, to }): HeatmapResult` — same zero-fill + `computeStats` logic, but the window is `[from, to]` inclusive instead of `[today-(n-1), today]`. `weeklyAvgMinutes` uses the range's day count. Reuses the existing `HeatmapResult` shape and `computeStats` internals (refactor the shared core out of `activityHeatmap` so both entry points call it).

## UI components (`apps/ipad/src/components/billing/`)

All plain React + inline styles, matching the R1 components' visual language (cards, NBSP/Kč formatting, project-color dots).

- **`ReportsView.tsx`** — the tab body. Renders the sticky `ReportsFilterBar` then the four panel cards in a vertical scroll. Owns `useReportsFilters`, derives each panel's props via the shared fns, memoized on `{ dataset, filters }`.
- **`reports/ReportsFilterBar.tsx`** — sticky top bar:
  - **Range presets:** `7 dní` / `30 dní` / `Tento měsíc` / `Tento rok` / `Vše` (segmented control).
  - **Granularity:** `Den` / `Týden` / `Měsíc` toggle.
  - **Project filter:** `Vše` / single project (dropdown / sheet; lists projects present in the dataset).
- **`reports/TrendChart.tsx`** — hand-rolled CSS/SVG bar chart. X = buckets (gap-filled across the range so empty buckets show as zero-height), dual encoding: bar height = hours, with a CZK earnings read-out on hover/tap. Vertical dashed lines at `rateChangeMarkers` (only when a single project is selected). Bucket labels formatted per granularity (cs-CZ).
- **`reports/EarningsSummary.tsx`** — four metric tiles (Celkem vyděláno `Kč`, Účtovatelné hodiny, Neúčtovatelné hodiny, Prům. efektivní sazba `Kč/h`) + horizontal per-project earnings bars (sorted desc).
- **`reports/ProjectDonut.tsx`** — SVG donut (arc per slice, project color) with a center label = total hours, and a right/below legend: color dot, project name, hours, % share. Tapping a legend row → R1 `ProjectDetailView`.
- **`reports/ActivityHeatmap.tsx`** — calendar-grid (week columns × weekday rows), 4-level color intensity by minutes, + stat line (current streak, longest streak, active days, weekly avg). Driven by `activityHeatmapRange`.
- **`BillingModule.tsx`** — wire the reserved **Reporty** tab into the tab bar + content switch (between Výdělky and the future Záznamy).

### Filter model & edge rules
- Presets resolve to `{ from, to }` against "today" (passed in; no `Date.now()` inside pure fns — `today` is supplied by the view, consistent with R1).
- **Auto-default granularity per preset**, user-overridable: `7 dní`/`30 dní`/`Tento měsíc` → `Den`; `Tento rok` → `Měsíc`; `Vše` → `Měsíc`.
- **Clamp** to avoid absurd bar counts (concrete thresholds): if the resolved range spans **> 92 days**, `Den` is disabled and auto-bumped to `Týden`; if it spans **> 1100 days (~3 years)**, `Týden` is auto-bumped to `Měsíc`. The filter bar reflects (and disables) the unavailable options and shows the effective granularity.
- **Rate-change markers** render only when a single project is selected.
- **CZK-only** earnings everywhere; a small note/badge if the dataset contains non-CZK billable rows in range (surfaced, not merged).
- Empty range (no worklogs) → each panel shows its own empty state.

## Testing

Logic-only, matching R1. New vitest files under `tests/shared/billing/reports/`:
- `buckets.test.ts` — `bucketKey` for all three granularities, incl. SQLite `%W` week-00 and year-boundary edges.
- `trend.test.ts` — `trendSeries` bucketing/sums (effective minutes + CZK earnings), project filter, multi-currency exclusion; `rateChangeMarkers` rank>1 + range + project-only gating.
- `earnings-summary.test.ts` — billable/unbillable split, CZK total, avg-rate guard (null at 0 minutes), perProject sort, time_off exclusion, non-CZK exclusion from earnings.
- `breakdown.test.ts` — grouping, `minutes>0` filter, share computation, sort.
- `heatmap.test.ts` — extend: `activityHeatmapRange` window + stats; assert the existing `activityHeatmap` path is unchanged.
- `tests/ipad/` — `useReportsFilters` reducer: preset→range resolution, granularity auto-default + clamp transitions.

UI components verify via `npx tsc -p apps/ipad/tsconfig.json --noEmit` (+ `tsc -b packages/shared`) and the billing mockup artifact. No DOM/render tests.

## Risks & follow-ups
- **`%W` week bucketing fidelity** — JS has no built-in `strftime('%W')`; the port must replicate SQLite's exact semantics (Monday-first, week-00). Mitigation: dedicated unit tests against captured SQLite outputs. This is the single highest-risk port.
- **Aggregation drift** — the new shared fns and the orchestrator `ReportsService` remain two implementations of the same reports until converged. Same mitigation as R1: mirror semantics exactly + shared unit tests; a follow-up issue tracks migrating the desktop onto the shared fns (out of scope here).
- **MD omission** — documented deliberate simplification (see Constraints). If dogfooding wants MD on Reports, the cleanest path is deriving MD onto worklog rows in the data plane (sub-project work), not re-resolving contracts on the client.

## Out of this spec (future)
- R3 (Records: worklogs list, monthly Task Grid, Time Off calendar) — separate spec.
- Write-back (sub-project #3) — Supabase write RLS + offline outbox.
- Custom from/to date picker (presets only in R2).
- Syncing the real sprint-window / report settings config.
