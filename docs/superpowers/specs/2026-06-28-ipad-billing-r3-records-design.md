# iPad Billing Module — R3 (Records) Design

**Roadmap:** Sub-project #2 of the iPad billing module (read module). This is **R3 of 3** — R1 (Dashboard, PR #109) and R2 (Reports, PR #117) shipped. R3 completes the read module. **All editing remains sub-project #3 (write-back)**, gated on the sync date-shift fix (PR #107).
**Depends on:** R1/R2 — the cached `BillingDataset`, `useBilling`, `BillingModule` shell, `czFormat`, `monthHelpers`, and the `packages/shared/src/billing/` layer. R2 has been reconciled to the **CZK-only** world (#108 removed `rateCurrency`/`ContractRow.currency`; all earnings are CZK).
**Orchestrator mirrored:** `apps/desktop/src/components/timetracker/{WorklogsList,TaskGridView,TimeOffTab}.tsx` (read/display semantics only) + `orchestrator/db/workdays.ts` (Czech holidays).

## Overview

A read-only **Záznamy** (Records) section completing the iPad billing module, with three views: **Seznam** (worklog list), **Mřížka** (monthly task grid), and **Volno** (time-off calendar). All compute on-device from the already-cached `BillingDataset` — no orchestrator endpoints. R3 also **refactors the billing module's navigation** from a top tab bar to a left section sidebar (the agreed iPad-idiomatic, desktop-style two-level nav), and adds the **`source`** field to the synced worklog rows (the one new data field R3 needs).

## Global Constraints

- **Read-only.** No writes/mutations/edit affordances anywhere (no cell popover, no drawers, no day-marking). Editing is sub-project #3.
- **Reads the cached `BillingDataset` only** (`worklogs`, `contracts`, `daysOff`, `projects`). The single data-plane change is **adding `source`** to the worklog `select` + `RawWorklogRow` + `mapWorklogRow` + `WorklogRow` (additive; the column already exists in Supabase). No other sync/schema/migration change.
- **CZK-only** (post-#108): there is no currency field; every `earnedAmount` is CZK. Earnings sum `earnedAmount != null`.
- **Tracked minutes are the primary number.** Views display raw `minutes`; where `effectiveMinutes !== minutes` (a reported/billable override exists) the list may show the reported value secondarily. The grid's earnings row uses `earnedAmount`. No tracked/reported toggle (simplification vs desktop).
- **Task Grid is a logged-time grid, not the desktop planner.** The iPad syncs no task/epic tables, so the grid shows **only tasks that have logged time in the month** (row identity = `taskNumber` within a project), with **no** empty-task rows, **no** `estimated_minutes`, **no** `status`/"hide done", and **no** capacity/expected-revenue targets (those need data not synced). Cells = logged hours; sticky rows = per-day totals + per-day CZK earnings.
- **iPad app:** plain React + inline styles, **no MUI**, no charting/calendar lib (hand-rolled). cs-CZ formatting via `czFormat` + `monthHelpers`; **no i18n**.
- **`@watchtower/shared` is `packages/shared/`**, subpath `.js` imports, no barrel; run `npx tsc -b packages/shared/tsconfig.json` after adding shared files before `apps/ipad` imports them.
- **iPad tests are logic-only** (no DOM). New shared fns + state helpers get vitest; UI verifies via typecheck.
- Never edit `.env*`. Don't commit build output. Worktree/branch: `feat/ipad-billing-r3` (spec + the R2→CZK reconciliation already committed there).

## Navigation refactor (billing module shell)

Replace `BillingModule.tsx`'s top tab bar with a **left section sidebar** rendered beside the module Rail, mirroring the desktop's two-level nav and idiomatic on iPad (sidebar/split-view):

- Items: **Přehled** (Dashboard) · **Výdělky** (Earnings) · **Reporty** (Reports) · **Záznamy** (Records, a group with sub-items **Seznam** / **Mřížka** / **Volno**).
- Selecting an item renders the corresponding view in the content pane to the right. The existing R1/R2 views (`DashboardView`, `EarningsMonthView`, `ReportsView`) are **unchanged internally** — only their selection moves from `activeTab` state to a sidebar `section` state.
- The sidebar is **collapsible** (icon-only) to preserve content width in portrait, consistent with the module Rail's collapse behavior. Persist expanded/collapsed in `localStorage` (same pattern as `Rail`).
- `selectedProject` drill-in (R1/R2 `ProjectDetailView`) continues to overlay as today; selecting any sidebar section clears it.
- Active-item styling matches the existing tab colors (`#2d2857` bg / `#a89cf0` fg active; muted otherwise).

A new `BillingNav` component owns the sidebar; `BillingModule` swaps its `activeTab` union for a `BillingSection = 'dashboard' | 'earnings' | 'reports' | 'records-list' | 'records-grid' | 'records-timeoff'` state and a content switch.

## Data addition: worklog `source`

- `WorklogRow` (+`packages/shared/src/billing/types.ts`): add `source: string | null` (`'manual' | 'watchtower-auto' | 'jira-sync' | null`).
- `RawWorklogRow` + `mapWorklogRow` (`apps/ipad/src/state/billingCache.ts`): add `source` to the raw shape and map `raw.source ?? null`.
- `useBilling` worklog `select` string: add `source` to the column list.
- The cache rides along automatically (whole `BillingDataset` is JSON-serialized).

## The three views (`apps/ipad/src/components/billing/records/`)

### Seznam — worklog list (`WorklogListView.tsx`)
Mirrors desktop `WorklogsList`: entries **grouped by `workDate`, days descending**; each day a header + a per-day **tracked-minutes** total (Σ `minutes`). Per row: project-color dot, task key (`taskNumber`, monospace) + title, tracked time (`minutes`; if `effectiveMinutes !== minutes`, show `minutes → effectiveMinutes` with a subtle "vykázáno" hint), and a **source badge** (`manual`→"manual", `watchtower-auto`→"watchtower", `jira-sync`→"jira"; fallback = raw value). Controls: month nav (prev/next/today via `monthHelpers.addMonths`) + project filter. Scoped to the selected month.

### Mřížka — task grid (`TaskGridView.tsx`)
Tasks × days matrix for the selected month (horizontal scroll):
- **Rows:** distinct tasks with logged time in the month, keyed by `(projectId, taskNumber)`, sorted by `taskNumber` (natural) then title. Row header = task key + title (+ project dot).
- **Columns:** day 1…daysInMonth.
- **Cells:** logged hours that day for that task (Σ `minutes`), blank when zero.
- **Sticky bottom rows:** (1) per-day **totals** (Σ tracked minutes across visible tasks) + month total at the right edge; (2) per-day **CZK earnings** (Σ `earnedAmount`) + month total. One earnings row (CZK only).
- Controls: month nav + project filter. No estimates/capacity/hide-done.

### Volno — time-off calendar (`TimeOffView.tsx`)
Mirrors desktop `TimeOffTab` read-only: a **3-month** calendar window (`focusMonth-1`, `focusMonth`, `focusMonth+1`). Each day marks user `days_off` (`kind` ∈ vacation/sick/other) and computed **Czech public holidays** (read-only, dashed/tinted); weekends tinted. An **upcoming list**: future `days_off` ∪ holidays, deduped by date (user entry wins), sorted ascending. Month nav (prev/next/today re-centers). **No day-marking** (read-only). Czech holidays via the existing `monthHelpers.czechHolidays(year)`.

## New shared logic (`packages/shared/src/billing/records/`)

Pure, plain-array in / object out, unit-tested. (Calendar/holiday helpers already exist in `apps/ipad/src/lib/monthHelpers.ts`; reuse them — don't duplicate.)

- `records/worklog-list.ts` → `groupWorklogsByDay(rows, { month, projectId? })` → `{ date, totalMinutes, entries: WorklogRow[] }[]` sorted by date desc; entries filtered to month (+project), each day's `totalMinutes` = Σ `minutes`.
- `records/task-grid.ts` → `buildTaskGrid(rows, { month, projectId? })` → `{ tasks: { key, projectId, taskNumber, taskTitle, projectColor, perDay: number[] }[], dailyTotals: number[], dailyEarnings: number[], monthTotalMinutes, monthTotalCzk, daysInMonth }`. `perDay`/`dailyTotals` in **minutes**; `dailyEarnings` sums `earnedAmount`. Rows sorted by `taskNumber` (natural-numeric) then title.

Time-off needs no new shared aggregation beyond `monthHelpers` (calendar grid + `czechHolidays` + `days_off` merge are done in the view / a small `apps/ipad/src/state` helper that IS unit-tested: `buildTimeOffModel(focusMonth, daysOff)` → calendar weeks + upcoming list).

## UI / state files

- `apps/ipad/src/components/billing/BillingNav.tsx` — the section sidebar.
- `apps/ipad/src/components/billing/BillingModule.tsx` (modify) — section state + content switch; mount R1/R2 views + the three Records views.
- `apps/ipad/src/components/billing/records/{WorklogListView,TaskGridView,TimeOffView}.tsx`.
- `apps/ipad/src/components/billing/records/tokens.ts` — reuse `reports/tokens.ts` `C` (import it; do not re-declare).
- `apps/ipad/src/state/useRecordsMonth.ts` — shared month-nav state for list + grid (`{ month, setMonth, prev, next, today }`), pure helpers tested.
- `apps/ipad/src/state/timeOffModel.ts` — `buildTimeOffModel` (pure, tested).
- `apps/ipad/src/state/billingCache.ts` + `useBilling.ts` (modify) — `source` field.

## Testing

Logic-only vitest:
- `tests/shared/billing/records/worklog-list.test.ts` — grouping/order/day totals/month+project filter.
- `tests/shared/billing/records/task-grid.test.ts` — task rows (only-with-logs, sort, `(projectId,taskNumber)` identity), per-day cells, daily totals + CZK earnings, month totals, days-in-month.
- `tests/ipad/useRecordsMonth.test.ts` — month nav helpers.
- `tests/ipad/timeOffModel.test.ts` — calendar window, holiday vs days_off merge, upcoming dedupe (user wins) + sort + future filter.
- `tests/ipad/billingCache.test.ts` (extend) — `mapWorklogRow` maps `source` (incl. null).

UI components verify via `npx tsc -b packages/shared && npx tsc -p apps/ipad/tsconfig.json --noEmit`. No DOM tests.

## Risks & follow-ups
- **Task identity** uses `(projectId, taskNumber)`; if `taskNumber` is null (ad-hoc worklogs), bucket those under a single "(bez úkolu)" row per project. Tested.
- **Nav refactor touches R1/R2 mounting** — keep `DashboardView`/`EarningsMonthView`/`ReportsView` internals untouched; only their selection mechanism changes. Verify all four prior sections still render + `ProjectDetailView` drill-in still works.
- **Two left columns** (module Rail + billing sidebar) in portrait — both collapsible; acceptable per design decision.
- Converging desktop/iPad reports+records onto shared fns remains a tracked follow-up (out of scope).

## Out of this spec (future)
- Write-back / editing (sub-project #3) — Supabase write RLS + offline outbox.
- Syncing task/epic tables (would enable full task-grid parity: estimates, empty rows, status).
- Adding a `tsc` CI gate (see incident in [[typecheck-not-in-ci]]).
