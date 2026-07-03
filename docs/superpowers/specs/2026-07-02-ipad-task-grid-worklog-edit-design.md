# iPad Task Grid — Worklog Edit / Delete / Add

**Date:** 2026-07-02
**Status:** Approved (design)
**Surface:** `apps/ipad` — Billing › Records › Task grid

## Problem

The iPad task grid (`TaskGridView`) renders per-task × per-day minute totals as
static text. Unlike the desktop grid (`WorklogCellPopover`) and the iPad's own
`WorklogListView`, its cells are not interactive — you cannot edit, delete, or
add a worklog from the grid. Users want to manage worklogs directly from the
grid, which is the primary at-a-glance view of the month.

## What already exists (no new plumbing)

- **Write-back layer:** `apps/ipad/src/state/useWorklogMutations.ts` —
  `createWorklog` / `updateWorklog` / `deleteWorklog`, writing directly to
  Supabase, with optimistic local patch + rollback on error.
- **Derived billing:** `apps/ipad/src/state/billingWrites.ts`
  (`computeDerivedForWrite`) → shared pure formula
  `packages/shared/src/billing/worklogBilling.ts` (`computeWorklogBilling`).
  iPad pre-computes and stores `effective_minutes` / `resolved_rate` /
  `earned_amount` on write.
- **Editor UI:** `WorklogDrawer` — a bottom-sheet with date / time /
  reported-minutes / description fields, an earnings preview, and
  Save / Cancel / **Smazat** (delete). It currently lives *privately* inside
  `WorklogListView.tsx` and supports `create` (task picker shown) and `edit`
  (task fixed) modes.
- **Offline gate:** `canEdit(state)` — read-only when the Supabase session /
  connectivity is unavailable.

This feature is therefore a **wiring + small refactor** job, not new
architecture.

## Design

### 1. Extract `WorklogDrawer` into its own module

Move `WorklogDrawer` from `WorklogListView.tsx` to
`apps/ipad/src/components/billing/records/WorklogDrawer.tsx` and export it.
`WorklogListView` imports it with no behavior change.

Add one capability — a **locked-task create mode**: when opened from a grid
cell, the caller passes the target task + date pre-filled and the task-search
picker is hidden (reuse the fixed-task header the `edit` mode already renders).
The list view's global **+ Přidat** keeps the picker (unlocked create).

Proposed prop shape (illustrative, not binding):

```
mode: 'create' | 'edit'
lockedTask?: TaskRow      // when set in create mode: prefill + hide picker
initialDate?: string      // YYYY-MM-DD, prefills the date field
initial?: WorklogRow      // edit mode (unchanged)
```

### 2. Cell → worklogs mapping

A grid cell is identified by `(projectId, taskNumber, day)`. The grid row
(`TaskGridRow`) already carries `projectId` / `taskNumber`; the day is the
column index + selected `month`. On **tap only** (not per render), filter the
`worklogs` array for that triple:

```
projectId === row.projectId
&& (taskNumber ?? '') === (row.taskNumber ?? '')
&& workDate === `${month}-${String(day).padStart(2,'0')}`
```

Factor this into a small pure shared helper
`worklogsForCell(worklogs, { projectId, taskNumber, workDate })` in
`packages/shared/src/billing/records/` so it is unit-testable and consistent
with `buildTaskGrid`'s keying (`${projectId}:${taskNumber ?? ''}`).

### 3. Smart open in `TaskGridView`

Every day cell becomes a tappable button, gated on `canEdit(state)` (inert +
no pointer affordance when read-only). Behavior by number of worklogs in the
cell:

| Cell contents | Action |
|---|---|
| **0 logs** | `WorklogDrawer` create mode, `lockedTask` = this row's task, `initialDate` = this day → add time to that task/day |
| **1 log**  | `WorklogDrawer` edit mode for that entry (edit or delete) |
| **N logs** | Bottom-sheet list of the cell's entries (same row markup as `WorklogListView`), each tapping into the edit drawer, plus a **+ Přidat** pre-filled (locked) for this task/day |

Every-cell-tappable is intentional (approved): tapping any empty cell is the
fastest way to log time against a known task/day.

**Known edge (accepted):** adding a *second* log to a cell that currently has
exactly one goes via the list view's global **+ Přidat**, not the grid (the
single-log cell routes straight to edit, which has no "add another"
affordance). Acceptable; revisit only if it bites in dogfood.

After any mutation, the grid re-renders from the optimistically-patched
`useBilling` data — no manual reload needed (same pattern as
`WorklogListView`).

### 4. Data dependencies

`TaskGridView` currently reads only `worklogs` + `projects` from `useBilling()`.
It will additionally read `tasks` + `contracts` (for the drawer's task lock and
earnings preview) and call `useWorklogMutations({ worklogs, contracts,
patchWorklogs })` — all already provided by `useBilling()`.

### 5. Styling / accessibility

Reuse the existing `C` design tokens, the extracted `WorklogDrawer`, and the
`WorklogListView` row markup for the multi-entry sheet. No new visual language.
Cells are 34px wide (a small tap target); the multi-entry sheet's full-width
rows give a comfortable target, and the cell button carries an appropriate
`role`/`cursor` so the tap affordance is discoverable.

## Testing

- **New:** unit tests for `worklogsForCell` (empty cell, single, multiple,
  cross-month exclusion, null-taskNumber grouping).
- **Untouched:** `buildTaskGrid` and `computeWorklogBilling` need no changes;
  their existing tests stand.
- Full suite must stay green (951+), plus the new helper tests.
- Typecheck: `npm run typecheck:ci` (covers `apps/ipad`).

## Out of scope

- No schema changes (`worklogs` table, derived fields unchanged).
- No change to `WorklogListView` behavior beyond the drawer import.
- No desktop (`apps/desktop`) changes.
- No new IPC — iPad writes go direct to Supabase as today.
