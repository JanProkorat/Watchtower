# iPad Billing Module — R1 (Dashboard) Design

**Date:** 2026-06-27
**Status:** Approved (brainstorm) — pending spec review
**Roadmap:** Sub-project #2 of the iPad billing module (read module). This is **R1 of 3**; R2 (Reports) and R3 (Records) follow as their own spec → plan → build cycles.
**Depends on:** Sub-project #1 (Supabase data plane — derived per-worklog billing fields + RLS + Auth), merged in PR #106.

## Goal

A **read-only** iPad billing experience that reads **directly from Supabase** (works with the Mac asleep), computes all metrics **on-device** from the synced tables, and works **offline** from a local cache. R1 delivers the highest-value "how am I doing" surface: a Dashboard, a per-month earnings view, and a per-project detail, behind a module-level login.

## Scope

**In (R1):**
- **Module-level auth gate** — only the Výdělky (Billing) module requires a Supabase login; Instances/Remote-Mac keep working over the Mac WS regardless. Session persists across launches.
- **Dashboard** — KPI tiles (Dnes / Sprint / Tento měsíc: hours + earned CZK), active-contract budget cards (MD used/limit, projected MD at month-end, workdays remaining), 30-day activity heatmap + streak stats, top projects this month.
- **Earnings (month)** — month picker, hero CZK total, trailing-months trend bars, per-project breakdown (tap → detail).
- **Project detail** — rate history (contract periods with computed earnings) + the month's worklog ledger.
- **Offline cache** with stale-while-revalidate + "aktualizováno před X" + pull-to-refresh.

**Out (deferred):**
- R2 — Reports tab (trend bar with rate-change markers, by-project donut, earnings summary tiles + per-project bar, activity heatmap with full filters, contract cards) and the date-range/preset/granularity filters.
- R3 — Records (worklogs list with filters, monthly Task Grid, Time Off calendar).
- **All editing** (worklog/contract/project/task/time-off CRUD, Jira sync) — sub-project #3 (write-back: Supabase write RLS + offline outbox).
- **Board / Jira mirror** — excluded entirely; it is Jira project-tracking, not billing, and `board_cards` is not synced/RLS'd to Supabase.

**Currency:** CZK only. No multi-currency handling (see issue #108 — desktop currency cleanup).

## Architecture

The iPad reaches **Supabase Cloud directly over the internet** (`https://xggihnrvsmbzbkhsnuky.supabase.co`), independent of the Mac/Tailscale WS used by the other modules. This is a **second, separate data path** alongside the existing `bridge.invoke(...)` WS path.

```
Supabase (Postgres + RLS + Auth)
        │  @supabase/supabase-js  (REST/PostgREST, JSON)
        ▼
  useBilling()  ── stale-while-revalidate ──►  localStorage cache (raw dataset)
        │
        ▼
  @watchtower/shared aggregation (pure fns)  ──►  Dashboard / Earnings / Project detail
```

**Why client-side compute:** the desktop's reports are computed by the Mac orchestrator from SQLite. The iPad has no access to those endpoints. Rather than duplicate the aggregation math, R1 introduces it **once as pure functions in `@watchtower/shared`**, unit-tested, consumed by the iPad. The desktop keeps its orchestrator implementation for now; converging the two onto the shared functions is a tracked follow-up (see Risks). New shared functions **mirror the orchestrator's existing logic exactly** (same discipline as `computeWorklogBilling` mirroring `SUM_EARNED`), so the two implementations cannot drift on the formulas.

**Data-plane status:** the six client-readable tables (`projects`, `epics`, `tasks`, `worklogs` with derived billing, `contracts`, `days_off`) and every field R1 needs (`contracts.md_limit`/`hours_per_day`/`end_date`/`rate_*`, `tasks.estimated_minutes`/`status`) **already sync** (verified in `orchestrator/sync/schema.ts`). **R1 requires no data-plane / sync / migration changes.** Czech public holidays are pure logic — ported from `orchestrator/services/czechHolidays.ts` and computed on-device, nothing to sync.

**Date safety:** the iPad reads via supabase-js (PostgREST → JSON), which returns `DATE` columns as `'YYYY-MM-DD'` **strings**, so the node-postgres local-midnight TZ shift (orchestrator-only, fixed in PR #107) does not apply here.

## Units

### Shared aggregation core — `@watchtower/shared` (new module, e.g. `shared/billing/`)

Pure functions over plain row arrays (no I/O). Each mirrors the named orchestrator source and is unit-tested against the same cases. R1 subset:

- `aggregateMonthEarnings(rows, month)` → `{ totalCzk, perProject: [{ projectId, name, color, minutes, mds, earnedCzk, rateBasis }] }` — mirrors `reports:earnings` / `EarningsSummary` per-project logic.
- `trailingMonths(rows, endMonth, n)` → `[{ month, earnedCzk }]` — the earnings trend series (mirrors `reports:trend` monthly bucketing, earnings dimension).
- `dashboardKpis(rows, { today, sprint })` → `{ today, sprint, month: { minutes, earnedCzk } }` — mirrors `dashboard:overview` today/sprint/month tiles.
- `contractBurn(contracts, worklogs, daysOff, holidays, { asOf })` → per active contract `{ mdsUsed, mdLimit, projectedMds, workdaysRemaining, totalWorkdays, endDate }` — mirrors `ContractStatusCard` / `RateHistorySection` projection math.
- `activityHeatmap(rows, { from, to })` → `{ days: [{ date, minutes }], stats: { currentStreak, longestStreak, activeDays, weeklyAvgHours, busiestDay } }` — mirrors `reports:heatmap` + the desktop stat strip.
- `topProjects(rows, month, limit)` → `[{ projectId, name, color, minutes, earnedCzk }]` — mirrors Dashboard `topProjects`.
- `projectRateHistory(contracts, worklogs, projectId)` → `[{ from, to, rate, rateType, earnedCzk }]` — mirrors `RateHistorySection` rate-period rows.
- `czechHolidays(year)` — ported verbatim from `orchestrator/services/czechHolidays.ts`.

Input row shape: the denormalized worklog set (worklog + derived billing fields + project/task/epic refs) plus raw `contracts` and `days_off`. The exact input types are defined alongside the functions.

### iPad app — `apps/ipad/src/` (plain React + inline styles, no MUI, no charting lib)

- `lib/supabaseClient.ts` — single supabase-js client; public URL + anon key as constants; session persisted to `localStorage`.
- `state/useSupabaseAuth.ts` — `{ session, signIn(email, pw), signOut(), status }`. Drives the gate.
- `state/billingCache.ts` — typed read/write of the cached dataset + `lastUpdated` in `localStorage`.
- `state/useBilling.ts` — stale-while-revalidate engine: read cache → render → fetch fresh (one pass of the synced tables, joined client-side or via PostgREST embedding) → update cache. Returns `{ data, state: 'cached'|'fresh'|'loading'|'offline', lastUpdated, refresh() }`. All views derive from this one in-memory dataset, so month switches need no refetch.
- `components/billing/BillingModule.tsx` — the auth gate: no session → `BillingLogin`; else the tabbed billing shell.
- `components/billing/BillingLogin.tsx` — email/password → `signInWithPassword`; inline error states.
- `components/billing/DashboardView.tsx` — KPI tiles, contract budget cards, heatmap + stats, top projects.
- `components/billing/EarningsMonthView.tsx` — month picker, hero total, trailing-months bars, per-project list.
- `components/billing/ProjectDetailView.tsx` — rate history + worklog ledger for the selected project/month.
- `lib/czFormat.ts` — cs-CZ formatting (NBSP thousands + `Kč`, dates `D. M. YYYY`). Local to apps/ipad (no i18n).
- `components/Rail.tsx` + `App.tsx` — flip the `billing` Rail item from `enabled: false` to enabled and wire it into the module switch. Internal tabs (Přehled / Výdělky) within the module; Reporty/Záznamy stubs reserved for R2/R3.

## Data Flow

1. Open Výdělky → `useSupabaseAuth` checks for a persisted session.
2. No session → `BillingLogin` → `signInWithPassword` → session persisted → proceed.
3. `useBilling` reads the cached dataset (renders instantly if present), then fetches the synced tables fresh from Supabase, joins to a denormalized worklog set, updates the cache + `lastUpdated`.
4. Views compute via the shared aggregation functions from the in-memory dataset. Month picker / project selection recompute client-side — no refetch.
5. Pull-to-refresh / refresh button forces a fetch.

## States

- **Offline + cache** → render cached data with an offline badge ("offline — uložená data").
- **Offline + no cache** → offline empty state.
- **Empty month** → "žádný výdělek".
- **Login errors** → inline (bad credentials, unconfirmed email, network).
- **Session expiry** → supabase-js auto-refreshes; only a hard refresh failure drops back to `BillingLogin`.

## Testing (`tests/ipad/` + shared tests, plain vitest — logic not rendering)

- **Shared aggregation** — one test file per function, asserting against the same fixtures/cases the orchestrator's logic produces (earnings totals, trailing series, contract projection, heatmap streaks, top projects, holidays). These are the correctness backbone.
- `useBilling` cache state machine — cached-then-fresh, offline fallback, with mock storage + mock fetch.
- `useSupabaseAuth` — mock client (sign-in success/fail, persisted session).
- Follows existing `tests/ipad/` patterns (`authBlockStore.test`, `vncKeys.test`).

## Dependencies

- `@supabase/supabase-js` added to `apps/ipad` (the app's first external runtime dep; still no MUI).
- Supabase URL + anon key are **public** (per the runbook) → baked as constants, no per-device config.

## Risks / Open Items

- **Aggregation drift:** the shared functions and the orchestrator's report code are two implementations of the same math until converged. Mitigation: mirror exactly + shared unit tests; **follow-up issue** to migrate the orchestrator/desktop onto the shared functions (out of scope for R1, to avoid risking working desktop code).
- **Join strategy:** client-side join vs PostgREST resource embedding (`worklogs?select=...,tasks(epics(projects(name)))`) — decided during planning based on whether the synced tables carry the FK constraints embedding needs.
- **Cache size:** ~2700 worklogs as JSON (a few hundred KB) is well within `localStorage` limits; revisit if the dataset grows materially.
- **Currency:** assumes CZK-only (issue #108). If non-CZK data exists historically, the aggregation must still not silently sum across currencies — guard or surface.

## Out of this spec (future)

- R2 (Reports) and R3 (Records) — separate specs.
- Write-back (sub-project #3) — Supabase write RLS + offline outbox.
- Desktop adoption of the shared aggregation functions — follow-up issue.
