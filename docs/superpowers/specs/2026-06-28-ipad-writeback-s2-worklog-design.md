# iPad Billing — Write-back Slice 2 (Worklog CRUD) Design

**Roadmap:** Sub-project #3 (write-back) of the iPad billing module. Slice 1
(write foundation + `days_off` editing) merged in PR #123 (`571207a`). **This is
slice 2: worklog create / edit / delete.** Later slices: contracts / projects /
tasks editing.
**Depends on:** the slice-1 foundation (online-direct write path, `useBilling`
optimistic patch, `billingWrites.ts` pure shapers, write-RLS migration pattern)
and the read module (cached `BillingDataset`, R3 `WorklogListView`).
**Issue:** #120.

## Overview

Make the iPad's **worklog list** (Records → Worklogy) support full
**create / edit / delete**. Per the approved iPad design ([[ipad-ios-remote-design]]),
the iPad is **online-direct + read-only-offline**: writes go straight to Supabase
when the dataset is `fresh`; editing is disabled offline. Single-user
**last-write-wins** via `updated_at`; deletes are **soft** (tombstone
`deleted_at`).

A worklog carries three **derived billing fields** — `effective_minutes`,
`resolved_rate`, `earned_amount` — which on the Mac are computed by a pure
function **at push time** and stored **Postgres-only** (never in SQLite, never
pulled). The central design decision of this slice is **who computes them when
the iPad authors a worklog.**

## Decisions (locked in brainstorming)

1. **The iPad computes derived fields itself, via a shared formula.** The
   derivation (`computeWorklogBilling` + `resolveContract`) is extracted to
   `packages/shared` and used by *both* the Mac and the iPad. The iPad feeds it
   the worklog's physical fields + its cached project-scoped `ContractRow[]`,
   and writes the three derived columns alongside the physical ones.
2. **Full create + edit + delete** (not edit/delete only). Create requires a
   task picker, so this slice also caches the task tree.
3. **All sources editable** (desktop parity): `manual`, `watchtower-auto`,
   `jira-sync` worklogs are all editable/deletable from the iPad.

### Why the iPad computes (not "Mac re-derives on pull")

The Mac's push LWW guard is strict (`orchestrator/sync/push.ts:111`):
`... ON CONFLICT (sync_id) DO UPDATE SET ... WHERE pgTable.updated_at < EXCLUDED.updated_at`.
The pull path copies `updated_at` verbatim into SQLite
(`orchestrator/sync/pull.ts:161` — it is a physical, non-derived column). So
after the iPad writes a worklog stamped `updated_at = T` and the Mac pulls it,
the Mac's SQLite row also has `updated_at = T`; on the Mac's next push the guard
check is `T < T` → **false → no-op**. **The Mac never re-derives an
iPad-authored worklog** (until an unrelated contract change bumps `updated_at`
via `markWorklogsForRebill`).

Therefore "Mac re-derives on pull" is not free — it would need new Mac-side pull
logic *and* a Mac that is awake to round-trip (the Mac is often asleep — the
reason the remote exists). Having the iPad compute the fields makes read-back
instant and correct and sidesteps the no-re-derive trap entirely. The only
residual risk is a **stale cached contract** producing a rare wrong value;
single-user with rarely-changing contracts makes this acceptable, and a Mac
self-heal pass is a deferred follow-up.

## Global constraints (inherited from slice 1)

- **Online-direct writes.** `INSERT`/`UPDATE` to Supabase via the authenticated
  client. **No offline outbox** — edit controls are disabled whenever the
  `useBilling` state is not `fresh` (`canEdit(state)` from slice 1).
- **Soft-delete only.** "Delete a worklog" = `UPDATE ... SET deleted_at = now,
  updated_at = now`. The iPad never issues a hard `DELETE`.
- **LWW via `updated_at`.** Every write stamps `updated_at = now` (ISO).
- **Optimistic local cache patch** (not a full refetch): patch the in-memory
  `worklogs` array, re-save the Capacitor cache; roll back + toast on error.
- **apps/ipad:** plain React + inline styles, no MUI ([[ipad-app-no-mui]]);
  cs-CZ; no i18n; reuse R3 `WorklogListView` + `reports/tokens.ts` `C` +
  `useToast`.
- **iPad tests are logic-only**: payload shapers, the optimistic reducer, and
  the derivation are pure and unit-tested; the Supabase client is injected,
  never hit live. UI verified via typecheck.
- Never edit `.env*`. Branch `feat/120-writeback-worklog`.

## 1. Shared pure logic — `packages/shared/src/billing/`

### 1a. Derivation: `worklogBilling.ts`
**Extract** `computeWorklogBilling` and `resolveContract` from
`orchestrator/db/worklogBilling.ts` into `packages/shared/src/billing/worklogBilling.ts`,
**verbatim** (same logic, same `ContractLite` shape). The orchestrator module
re-exports from shared so its existing call sites and tests are unchanged:

```
effectiveMinutes = reportedMinutes ?? minutes
contract         = latest contract with effectiveFrom <= workDate  (null if none)
earnedAmount     = hourly: (effectiveMinutes * rateAmount) / 60
                   daily:  (effectiveMinutes / 60 / hoursPerDay) * rateAmount
                   null when no contract resolves (non-billable / personal / time-off)
resolvedRate     = contract.rateAmount  (null when no contract)
```

The iPad's `ContractRow` (`{ projectId, effectiveFrom, endDate, rateType,
rateAmount, hoursPerDay, mdLimit }`) already carries every field
`resolveContract` needs; the iPad filters its cached `contracts` to the
worklog's `projectId` and passes them in.

### 1b. Minutes parser: shared `parseMinutes`
**Extract** `parseMinutes` from `apps/desktop/src/util/format.ts` into
`packages/shared/src/billing/parseMinutes.ts`
(handles `1.5` / `1,5` / `1:30` / `1h30m`, returns `NaN` on invalid). Desktop
re-exports it from `format.ts` to avoid touching its many import sites. The iPad
imports it from shared for the drawer inputs.

## 2. Task tree cache (create needs a task picker)

The cached dataset has no task list — tasks exist only embedded on each worklog.
Add a flat task list:

- **`TaskRow`** (shared `billing/types.ts`):
  `{ taskId: number; taskNumber: string | null; taskTitle: string; projectId: number; projectName: string; projectColor: string | null; projectKind: string; isBillable: boolean }`.
  Carries enough to build a denormalized `WorklogRow` for the optimistic insert.
- **`BillingDataset`**: add `tasks: TaskRow[]`.
- **`useBilling`**: new select on `tasks` joined to `epics → projects`
  (`deleted_at IS NULL`), mapped to `TaskRow[]`; paginated via the existing
  `fetchAllPaged` helper (the table is ~780 rows).
- **`billingCache.ts` `loadCache` guard**: add `Array.isArray(v?.tasks)` so a
  pre-slice-2 cache shape is rejected and refetched when next online (the user
  must be online to edit anyway).

## 3. Supabase write RLS — `PG_MIGRATIONS` version 7

`orchestrator/db/pg/schema.ts`. Add **v7** mirroring the v5/v6 idempotent,
`authenticated`-role-guarded pattern (so plain-Postgres dev/test still works),
scoped to `worklogs`:

```sql
ALTER TABLE worklogs ENABLE ROW LEVEL SECURITY;          -- idempotent
DROP POLICY IF EXISTS write_authenticated ON worklogs;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON worklogs
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
```

`FOR ALL` covers INSERT/UPDATE (soft-delete is an UPDATE). Single user →
`USING/WITH CHECK (true)`. The read `read_authenticated` SELECT policy stays;
permissive policies OR together.

## 4. Write layer — `apps/ipad/src/state/`

### 4a. `billingWrites.ts` (extend, pure)
- `WorklogDerived = { effective_minutes: number; resolved_rate: number | null; earned_amount: number | null }`.
- `buildWorklogInsert(input, opts: { syncId; now; derived })` → full PG row:
  `{ sync_id, task_id, description, work_date, minutes, reported_minutes,
  source: 'manual', external_id: null, jira_uploaded: false, deleted_at: null,
  updated_at: now, ...derived }`. `created_at` is omitted (PG `DEFAULT now()`).
- `buildWorklogUpdate(input, opts: { now; derived })` → `{ work_date, minutes,
  reported_minutes, description, updated_at: now, ...derived }`. Keyed on
  `sync_id` (task is **not** changed on edit — desktop parity).
- `buildWorklogDelete(now)` → `{ deleted_at: now, updated_at: now }`.
- `applyWorklogWrite(worklogs, change)` — optimistic reducer:
  `{ type: 'upsert'; row: WorklogRow }` replaces/adds by `syncId`;
  `{ type: 'remove'; syncId }` filters it out. Pure, unit-tested.

### 4b. `useWorklogMutations.ts` (new)
Wires the real `supabase` client + `crypto.randomUUID()` +
`new Date().toISOString()` + the cached `contracts`:
- `createWorklog(input)`: mint `syncId`, derive via shared formula
  (contracts filtered to the task's `projectId`), build the denormalized
  optimistic `WorklogRow` from the picked `TaskRow`, patch → `insert` → on error
  roll back + `showError`.
- `updateWorklog(syncId, input)`: look up the existing cached row for its
  `projectId`/denormalized refs, re-derive, patch → `update().eq('sync_id', …)`
  → roll back on error.
- `deleteWorklog(syncId)`: soft-delete, optimistic remove, roll back on error.

### 4c. `useBilling.patchWorklogs(next: WorklogRow[])`
Mirror slice-1 `patchDaysOff`: swap `data.worklogs`, re-save the cache.

## 5. UI — make R3 `WorklogListView` editable

- **Online gate:** read `state` from `useBilling`; when not `fresh`, the list is
  display-only with the slice-1 "jen pro čtení offline" hint; edit affordances
  hidden.
- **"+ Přidat" button** in `MonthBar` → **create drawer**: task picker, date
  (default today), minutes, reported (optional), description (optional), live
  earned preview via the shared formula, Uložit/Zrušit. Save = `createWorklog`.
- **Tap an entry** → **edit drawer**: prefilled date/minutes/reported/
  description + earned preview + **Smazat**. Save = `updateWorklog`; Smazat =
  `deleteWorklog`. All sources editable (the `source` badge stays visible).
- **Task picker** (create only): searchable text filter over `tasks` grouped by
  project (~780 rows — no giant `<select>`). Selecting a task binds
  `task_id` + the denormalized refs for the optimistic row.
- **Minutes inputs** use the shared `parseMinutes`; invalid (`NaN`) or
  `minutes <= 0` disables Save (matches PG `CHECK (minutes > 0)` and
  `reported_minutes IS NULL OR > 0`).
- Per-write status: reuse `useToast`/`showError`; a small "ukládám…/uloženo"
  affordance as in slice 1.

## Files

- `packages/shared/src/billing/worklogBilling.ts` (new — extracted) + re-export
  shim in `orchestrator/db/worklogBilling.ts`.
- `packages/shared/src/billing/types.ts` — `TaskRow`; `BillingDataset.tasks`.
- `packages/shared/src/util/` (or `billing/`) — shared `parseMinutes`; desktop
  `format.ts` re-export.
- `orchestrator/db/pg/schema.ts` — `PG_MIGRATIONS` v7 (worklogs write policy).
- `apps/ipad/src/state/useBilling.ts` + `billingCache.ts` — tasks select/map +
  cache guard; `patchWorklogs`.
- `apps/ipad/src/state/billingWrites.ts` — worklog shapers + `applyWorklogWrite`.
- `apps/ipad/src/state/useWorklogMutations.ts` (new) — client-wired hook.
- `apps/ipad/src/components/billing/records/WorklogListView.tsx` — create/edit
  drawers, task picker, online gating.

## Testing

Logic-only vitest (no live Supabase):
- `tests/shared/worklogBilling.test.ts` — moved/extended: `effectiveMinutes`
  fallback, contract resolution (latest `effectiveFrom <= workDate`), hourly vs
  daily `earnedAmount`, `null` when no contract resolves. (Confirm the
  orchestrator's existing worklogBilling tests still pass against the shim.)
- `tests/shared/parseMinutes.test.ts` — `1.5` / `1,5` / `1:30` / `1h30m` /
  invalid → `NaN`.
- `tests/ipad/billingWrites.test.ts` (extend) — `buildWorklogInsert`
  (`source:'manual'`, `external_id:null`, `deleted_at:null`, derived merged,
  stamped `updated_at`), `buildWorklogUpdate` (no `task_id`), `buildWorklogDelete`,
  `applyWorklogWrite` (add / replace-by-syncId / remove).
- `tests/ipad/billingCache.test.ts` (extend) — `TaskRow` map; `loadCache`
  rejects a tasks-less cache shape.
- UI via `tsc -b packages/shared && tsc -p apps/ipad --noEmit`; keep the branch
  rebased so the CI desktop typecheck gate (#122) passes.

## Risks & follow-ups

- **`sync_id` is simpler than slice 1:** create mints a fresh UUID; edit/delete
  carry the explicit `syncId` from the cached `WorklogRow`. There is **no
  natural-key (date) re-mark path**, so slice 1's tombstone-inclusive lookup is
  not needed here.
- **Re-import resurrection (out of scope):** the `(source, external_id)` dedup
  index excludes `deleted_at IS NOT NULL` rows (migration v2), so a soft-deleted
  `watchtower-auto`/`jira-sync` worklog can be re-inserted by a later auto-import
  — pre-existing desktop behavior, unchanged by this slice.
- **Stale cached contract** → a rare wrong derived value if a contract changed
  on the Mac and the iPad edits an affected worklog before refetching
  (single-user, rare). A Mac authoritative self-heal pass (force re-derive on
  pull of foreign worklog writes) is a deferred follow-up.
- **Shared extraction safety:** moving `computeWorklogBilling`/`parseMinutes` to
  `packages/shared` is a built composite ([[watchtower-workspace-resolution]]) —
  rebuild shared before typechecking dependents; keep the orchestrator re-export
  shim so no orchestrator call site changes.

## Out of this slice (future)

- Contracts / projects / tasks editing.
- Offline outbox (only if online-direct proves insufficient).
- Mac authoritative re-derivation of foreign worklog writes.
