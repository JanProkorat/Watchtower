# iPad Billing — Write-back Slice 3a (Task CRUD) Design

**Roadmap:** Sub-project #3 (write-back) of the iPad billing module. Slice 1
(time-off) merged PR #123; slice 2 (worklog CRUD) merged PR #124 (`f9c333e`).
Slice 3 (contracts + projects + tasks editing) is **decomposed into sub-slices
by entity** — this is **slice 3a: tasks**. Contracts (3b) and projects (3c) are
deliberately deferred; see "Why decompose" below.
**Depends on:** the slice-1/2 foundation (online-direct write path, `useBilling`
optimistic patch + reducer, `billingWrites.ts` pure shapers, write-RLS migration
pattern, `canEdit` gating) and the read module (cached `BillingDataset`, the
slice-2 flat `TaskRow[]`).
**Issue:** #120.

## Overview

Make the iPad's **tasks** editable: full **create / edit / delete**. Per the
approved iPad design ([[ipad-ios-remote-design]]), the iPad is **online-direct +
read-only-offline** — writes go straight to Supabase when the dataset is
`fresh`; editing is disabled offline. Single-user **last-write-wins** via
`updated_at`; deletes are **soft** (`deleted_at`).

Tasks are the deliberate first entity of slice 3: they carry **no derived
billing fields** (unlike worklogs) and **no cross-table ripple** (unlike
contracts), so 3a stays a clean application of the slice-2 pattern plus two new
pieces — caching **epics** (a task's parent, needed for the create picker) and
replicating the orchestrator's **done-task lock**.

## Why decompose slice 3 (tasks first)

The iPad writes **directly to Supabase**, bypassing the orchestrator IPC
handlers where each entity's business logic lives. Each entity therefore needs
its integrity rules replicated client-side, and they differ sharply:

- **Contracts (deferred, 3b):** overlap validation + auto-closing the prior
  open-ended contract live in the orchestrator, and a contract change runs
  `markWorklogsForRebill` to re-derive **every affected worklog's
  `earned_amount`**. The iPad bypasses that, and (per [[ipad-writeback-derived-fields]])
  the Mac never re-derives a foreign write — so an iPad contract edit would have
  to re-derive and re-write every worklog in that project from the effective
  date. A real ripple; its own carefully-designed slice.
- **Projects (deferred, 3c):** `is_billable` is derived from `kind`; the
  single-default constraint needs an atomic clear-old/set-new (a partial unique
  index rejects bad ordering); delete cascades soft-delete across
  worklogs→tasks→epics→contracts→projects — a multi-table op that is non-atomic
  over direct Supabase writes.
- **Tasks (this slice, 3a):** no derived columns, no ripple. Only rule to
  replicate is the **done-lock**; create needs the parent epic cached. Lowest
  entanglement, highest on-the-go value (status changes + quick edits).

## Global Constraints (inherited)

- **Online-direct writes only.** `INSERT`/`UPDATE` to Supabase via the
  authenticated client. **No offline outbox** — edit controls disabled whenever
  `useBilling` state is not `fresh` (`canEdit(state)` from slice 1).
- **Soft-delete only.** Delete = `UPDATE ... SET deleted_at = now,
  updated_at = now`. Never a hard `DELETE`.
- **LWW via `updated_at`.** Every write stamps `updated_at = now` (ISO).
- **Optimistic local cache patch** (not a refetch): patch the in-memory `tasks`
  array, re-save the Capacitor cache; roll back + inline error on failure.
- **apps/ipad:** plain React + inline styles, no MUI ([[ipad-app-no-mui]]);
  cs-CZ; no i18n; reuse `reports/tokens.ts` `C`; errors surfaced inline via the
  hook's `error` + `C.red` (the slice-1/2 pattern — there is no `useToast`).
- **iPad tests are logic-only**: payload shapers, the optimistic reducer, and
  the done-lock predicate are pure and unit-tested; the Supabase client is
  injected, never hit live. UI verified via typecheck.
- **`@watchtower/shared` is a built composite** ([[watchtower-workspace-resolution]]):
  vitest resolves it from source; `npm run typecheck` builds it first via
  `tsc -b` then typechecks all 6 projects — the canonical verification.
- Never edit `.env*`. Branch `feat/120-writeback-tasks`.

## 1. Cache epics (new entity)

A task's parent epic is needed for the create picker and to show/change a task's
epic. Epics aren't cached today (only embedded via the task→epic→project join).

- **`EpicRow`** (shared `billing/types.ts`):
  `{ epicId: number; name: string; projectId: number; status: string }`.
- **`BillingDataset`**: add `epics: EpicRow[]`.
- **`useBilling`**: new `epics` select (`id,name,project_id,status`,
  `deleted_at IS NULL`), mapped to `EpicRow[]` (paginate via `fetchAllPaged`,
  ordered by `id` — robust though epics are few).
- **`billingCache.ts` `loadCache` guard**: add `Array.isArray(v?.epics)` so a
  pre-3a cache shape is rejected and refetched when next online.

Epics are **read-only** in 3a (picker only) — no epics write policy, no epic
editing UI.

## 2. Extend `TaskRow` read fields (edit prefill + write identity)

The slice-2 `TaskRow` lacks the fields the edit drawer must prefill and the
identity writes key on. Add (additive, mirrors slice 2's worklog read additions):

- `TaskRow` gains: `syncId: string`, `epicId: number`, `status: string`,
  `estimatedMinutes: number | null`, `description: string | null`.
- The `tasks` select adds `sync_id,epic_id,status,estimated_minutes,description`;
  `RawTaskRow` + `mapTaskRow` map them (sane defaults).
- **Writes key on `syncId`**: edit/delete use `.eq('sync_id', …)`; create mints
  a fresh UUID. (Consistent with slice 2; `taskId` remains the PG id used by the
  slice-2 worklog picker.)

**Also extend `ProjectRow`** with `kind: string` and `isBillable: boolean`. The
optimistic created `TaskRow` needs the parent project's `projectKind`/`isBillable`
(fields `TaskRow` already carries), and the `projects` select **already fetches
`kind,is_billable`** (`useBilling.ts:113`) — they are simply dropped in the map
today. Add them to `ProjectRow` and map them; `buildOptimisticTaskRow` then reads
them from the picked `ProjectRow`. (Additive; no new fetch.)

## 3. New "Úkoly" task-list view (4th Records section)

`TaskGridView` is **worklog-derived** (`buildTaskGrid(worklogs,…)`) so it cannot
show empty/new tasks — it is unsuitable for create or for editing tasks with no
logged time. Add a dedicated list:

- `apps/ipad/src/components/billing/records/TaskListView.tsx`, wired as a new
  Records section in `BillingModule.tsx` (`records-tasks`) + `BillingNav.tsx`.
- Lists `data.tasks` grouped by project → epic, searchable (the DB has ~780
  tasks — text filter, no giant control). Each row shows number + title +
  status badge.
- **Online gate** via `canEdit(state)`; offline = read-only with the slice-1
  hint.
- **Tap a task** → edit drawer (number, title, status, estimated_minutes,
  description, epic; + **Smazat**). **Done tasks are read-only** (see §4).
- **"+ Přidat úkol"** → create drawer with a **project → epic picker** (from
  `data.projects` + `data.epics`) then the same fields.
- `TaskGridView` is unchanged (stays read-only).

## 4. Done-lock (replicate `assertTaskNotDone`)

The orchestrator refuses edit/delete of `status='done'` tasks. The iPad mirrors
this:

- A pure `canEditTask(status: string): boolean` (= `status !== 'done'`) in
  `billingWrites.ts`.
- In `TaskListView`, done tasks open a read-only drawer (Save/Smazat disabled)
  or are visibly non-editable.
- `useTaskMutations.updateTask`/`deleteTask` guard on the cached row's status
  and no-op (with an error message) if done — defence in depth.

## 5. Write path (mirrors slice 2)

### 5a. PG write RLS — `PG_MIGRATIONS` version 8
`orchestrator/db/pg/schema.ts`. Add **v8** mirroring the v6/v7 idempotent,
role-guarded pattern, scoped to `tasks`:
```sql
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;          -- idempotent
DROP POLICY IF EXISTS write_authenticated ON tasks;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON tasks
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
```
`FOR ALL` covers INSERT/UPDATE (soft-delete is an UPDATE). The read policy stays.

### 5b. `billingWrites.ts` (extend, pure)
- `TaskWriteInput = { epicId: number; number: string; title: string; status: string; estimatedMinutes: number | null; description: string | null }`.
- `buildTaskInsert(input, { syncId, now })` → `{ sync_id, epic_id, number,
  title, status, estimated_minutes, description, deleted_at: null,
  updated_at: now }`. (`created_at` PG default; jira_* columns omitted → NULL.)
- `buildTaskUpdate(input, { now })` → `{ epic_id, number, title, status,
  estimated_minutes, description, updated_at: now }` (edit may reparent the epic
  — desktop parity).
- `buildTaskDelete(now)` → `{ deleted_at: now, updated_at: now }`.
- `buildOptimisticTaskRow(input, { syncId, taskId, project })` → `TaskRow`
  (denormalized project refs from the picked project; `taskId` is a placeholder
  until the insert returns the real id — see 5c).
- `buildEditedTaskRow(existing, input)` → `TaskRow` (spread + overwrite mutable
  fields; preserves `taskId`/`syncId`).
- `applyTaskWrite(tasks, change)` — reducer: `{ type: 'upsert'; row }`
  replaces/adds by `syncId`; `{ type: 'remove'; syncId }` filters out. Pure.
- `canEditTask(status)` — `status !== 'done'`.

### 5c. `useTaskMutations.ts` (new, client-wired)
Wires `getSupabase()` + `crypto.randomUUID()` + ISO `now` + the cached
`projects`:
- `createTask(epic, input)`: mint `syncId`, optimistic upsert (placeholder
  `taskId`), `insert(...).select('id').single()` → patch the returned real
  `taskId` into the cached row (so a worklog logged against it next has a valid
  `task_id`), roll back + error on failure.
- `updateTask(syncId, input)`: bail if the cached row is done; optimistic edited
  row; `update(...).eq('sync_id', syncId)`; roll back on error.
- `deleteTask(syncId)`: bail if done; optimistic remove; soft-delete
  `.eq('sync_id', syncId)`; roll back on error.
- Returns `{ createTask, updateTask, deleteTask, pending, error }`.

### 5d. `useBilling.patchTasks(next)` + `PATCH_TASKS` reducer
Mirror slice-2 `patchWorklogs`/`PATCH_WORKLOGS`.

## Files

- `packages/shared/src/billing/types.ts` — `EpicRow`; `BillingDataset.epics`;
  `TaskRow` field additions; `ProjectRow` gains `kind`/`isBillable`.
- `apps/ipad/src/state/billingCache.ts` — `RawEpicRow`/`mapEpicRow`; extend
  `RawTaskRow`/`mapTaskRow`; `epics` on dataset; `loadCache` guard.
- `apps/ipad/src/state/useBilling.ts` — fetch+map epics; widen the tasks select;
  map `kind`/`isBillable` into `ProjectRow` (select already fetches them);
  `patchTasks` + `PATCH_TASKS`.
- `orchestrator/db/pg/schema.ts` — `PG_MIGRATIONS` v8 (tasks write policy).
- `apps/ipad/src/state/billingWrites.ts` — task shapers + `applyTaskWrite` +
  `canEditTask`.
- `apps/ipad/src/state/useTaskMutations.ts` (new) — client-wired hook.
- `apps/ipad/src/components/billing/records/TaskListView.tsx` (new) — list +
  drawers + project→epic picker + online/done gating.
- `apps/ipad/src/components/billing/BillingModule.tsx` + `BillingNav.tsx` — wire
  the `records-tasks` section.

## Testing

Logic-only vitest (no live Supabase):
- `tests/ipad/billingWrites.test.ts` (extend) — `buildTaskInsert`
  (sync_id/epic_id/status/`deleted_at:null`/stamped `updated_at`, jira_* absent),
  `buildTaskUpdate` (incl. `epic_id`, no `sync_id` in the payload),
  `buildTaskDelete`, `buildOptimisticTaskRow`/`buildEditedTaskRow`,
  `applyTaskWrite` (add/replace/remove by syncId), `canEditTask` (done → false).
- `tests/ipad/billingCache.test.ts` (extend) — `mapEpicRow`; `mapTaskRow` new
  fields; `loadCache` rejects an epics-less cache shape.
- `tests/orchestrator/pgMigrations.writeback.test.ts` (extend) — v8 present +
  guarded FOR-ALL tasks policy (mirror the v6/v7 assertions).
- `useBilling` reducer: `PATCH_TASKS` (swap + no-op-when-null), mirroring the
  slice-2 `PATCH_WORKLOGS` test.
- UI + hook via `npm run typecheck` (0 errors across all 6 projects).

## Risks & follow-ups

- **`sync_id` integrity:** create mints a fresh UUID; edit/delete carry the
  explicit `syncId`. No natural-key re-mark path → no tombstone-inclusive lookup
  (unlike slice-1 days_off).
- **Optimistic `taskId` placeholder:** until `insert().select('id')` returns,
  the optimistic row's `taskId` is a placeholder; a worklog logged against a
  brand-new task before the insert resolves would get a wrong `task_id`. The
  `.select('id')` patch closes this for the normal path; the racing-create case
  is out of scope (single user, sequential taps).
- **Orphaned worklogs:** soft-deleting a task doesn't cascade to its worklogs
  (desktop parity). The worklog read embed still resolves the soft-deleted task
  by id. Out of scope.
- **Done-lock is advisory client-side** — the orchestrator remains the
  authoritative gate on the Mac; the iPad replicates it for UX correctness, but
  a direct Supabase write could technically bypass it. Acceptable (single user;
  the UI is the only writer).
- **No epic editing / no contracts / no projects** in 3a.

## Out of this slice (future)

- Slice 3b: contracts editing (+ the worklog re-derive ripple).
- Slice 3c: projects editing (cascade-delete + atomic is_default).
- Epic create/edit; offline outbox (only if online-direct proves insufficient).
