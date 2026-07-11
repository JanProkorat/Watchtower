# Pinned projects + attention-dot clears on interaction

Date: 2026-07-09
Branch: `worktree-contract-solo-to-group`
Delivery: one branch, two commits (Part A, then Part B).

Two independent changes bundled on one branch:

- **Part A** — replace the single "default project" flag with a multi-select
  "**pinned**" flag that preselects projects in the task-grid *and* dashboard
  filters. Includes a full rename (`is_default`/`isDefault` → `is_pinned`/
  `isPinned`) down to the DB column.
- **Part B** — fix the Instances red "attention needed" dot so it clears when
  the user clicks or types in an *already-focused* terminal, not only after
  leaving and refocusing.

---

## Part A — Pinned projects

### Goal / behaviour

- Any number of projects can be pinned (0..N). No single-default invariant.
- Pinned projects are the **preselected filter** on two surfaces:
  - **Task grid** — the multi-select project filter seeds to *all* pinned
    projects on first load.
  - **Dashboard** — currently a single-project select; it becomes a
    multi-select seeded to *all* pinned projects.
- Empty pin set = no preselection, which both surfaces already render as
  "All projects".

### Data layer

**Migration v6** (`orchestrator/db/migrations.ts`):

```sql
DROP INDEX IF EXISTS idx_projects_is_default;
ALTER TABLE projects RENAME COLUMN is_default TO is_pinned;
```

- Dropping the partial-unique index (`… WHERE is_default = 1`) removes the
  one-default constraint. Renaming the column preserves all existing values.
- `RENAME COLUMN` + `DROP INDEX` are supported by both `better-sqlite3` (prod)
  and `node:sqlite` (migration tests). This is not an `ADD COLUMN … DEFAULT`
  case, so the engine-divergence hazard does not apply.

**Postgres mirror** (`orchestrator/db/pg/schema.ts`): rename the column in the
`CREATE TABLE` to `is_pinned`, drop the partial-unique index definition. If PG
is already provisioned in an environment, apply the equivalent
`ALTER TABLE … RENAME COLUMN` + `DROP INDEX` via whatever PG bootstrap/migration
path the repo uses (verify during implementation).

**Sync column registry** (`orchestrator/sync/schema.ts`): `is_default` →
`is_pinned` (kind stays `bool`).

**Legacy TT importer** (`orchestrator/db/migrateTimetracker.ts`): the copy reads
`is_default` from the old standalone TimeTracker DB; map it into the new
`is_pinned` column (source column name unchanged, target renamed).

**Repository** (`orchestrator/db/repositories/projects.ts`):

- Remove `clearDefault()` and its calls in `create` and `update`. `update` no
  longer needs a transaction for this field — a plain
  `push('is_pinned', input.isPinned ? 1 : 0)` suffices.
- Keep forcing `is_pinned = 0` when a project is archived.
- `ORDER BY p.is_default DESC, …` → `ORDER BY p.is_pinned DESC, …`.
- Row→view mapping `isDefault: r.is_default === 1` → `isPinned: r.is_pinned === 1`.
- Rename `ProjectRow.isDefault`, `ProjectInput.isDefault`, `DbRow.is_default`.

### Types (rename only)

- `packages/shared/src/ipcContract.ts` — `ProjectViewPayload.isDefault` and
  `ProjectInputPayload.isDefault` → `isPinned`.
- `packages/shared/src/messagePort.ts` — `OrchProjectView.isDefault` and
  `OrchProjectInput.isDefault` → `isPinned`.
- `apps/desktop/src/components/timetracker/ProjectDrawer.tsx` — `DraftState.isDefault`
  → `isPinned`.

### UI

**ProjectDrawer** (checkbox) + **ProjectDetailPane** (star toggle): relabel to
"Pinned" / "Pin to filters"; tooltip "Pin project" / "Pinned". The star toggle
now simply flips this project's `isPinned` with no side effect on other
projects.

**Task grid** (`apps/desktop/src/components/timetracker/TaskGridView.tsx`): the
one-shot seed effect currently does
`const def = r.projects.find(p => p.isDefault); if (def) setProjectFilters([def.id]);`.
Change to seed all pinned:
`setProjectFilters(r.projects.filter(p => p.isPinned).map(p => p.id));`
(empty stays `[]` = all). Everything downstream is already array-based.

**Dashboard** — the substantive UI work:

- `apps/desktop/src/components/dashboard/ModuleDashboard.tsx`: state
  `projectId: number | null` → `projectIds: number[]`. localStorage key
  `watchtower.dashboard.projectId` → `watchtower.dashboard.projectIds` (store a
  JSON array; `[]` persisted = explicit "All projects"). Seed from all pinned
  when nothing was ever persisted.
- `apps/desktop/src/components/dashboard/DashboardHeader.tsx`: convert the
  single `<TextField select>` to a `multiple` Select with per-row `<Checkbox>`
  and a `renderValue` (empty → "All projects", else joined names) — mirror the
  proven task-grid control.
- `apps/desktop/src/state/useDashboardOverview.ts`: signature takes
  `projectIds: number[]`; key the fetch on the serialized ids (as
  `useTaskGrid` does).
- `packages/shared/src/ipcContract.ts` `DashboardOverviewRequestPayload`: add
  `projectIds?: number[]`; keep `projectId?` as legacy with `projectIds`
  taking precedence when non-empty (same back-compat pattern as
  `task-grid.ts`).
- `orchestrator/db/dashboardOverview.ts`: `projectClause(projectId)` →
  accept an id array and emit `AND p.id IN (?, …)` (empty/absent = no clause).
  `reports.earnings(...)` is per-worklog and additive, so compute earnings
  across the selected projects and sum (loop, or add a multi-project earnings
  path — verify `ReportsService.earnings` signature during implementation).
  `activeContracts` stays unfiltered (already independent of the filter).

**Minor consumers (rename only, behaviour unchanged):**

- `ProjectsPage.tsx` fallback: `projects.find(p => p.isPinned)?.id ?? projects[0].id`
  (first pinned).
- `ProjectsSidebar.tsx`: the pinned badge now legitimately shows on multiple
  rows.
- `ReportsTab.tsx`: stays single-select; preselect the first pinned; label
  `' (default)'` → `' (pinned)'`. (Converting Reports to multi-select is out of
  scope.)

### Tests (Part A)

- Repo: two projects can both be pinned simultaneously; pinning one does not
  unpin another; archiving unpins.
- Migration: existing `is_default = 1` rows survive as `is_pinned = 1`; the
  unique index is gone (two rows can be pinned).
- `dashboardOverview`: `projectIds` filters to the union; `[]`/absent = all;
  earnings summed correctly across two projects.
- Task grid + dashboard: seed effect selects all pinned on first load.

---

## Part B — attention dot clears on interaction

### Root cause

The tab dot is a pure function of instance `status`
(`packages/shared/src/tabAttention.ts` → `ACTION_NEEDED_STATUSES`). Status is
cleared only by the `tabFocused` and `windowFocusChanged` transitions
(`orchestrator/stateMachine.ts`), and those fire only on a focus **transition**:

- `focusChanged` is emitted from `useFocusedInstance.ts` in an effect keyed on
  `focusedInstanceId` — it re-runs only when that id *changes*.
- `windowFocusChanged` fires only on the OS window `focus`/`blur` edges
  (`electron/window.ts`).

Clicking an already-focused terminal re-sets the same focused id (no-op → no
`focusChanged`). Typing goes out via `ptyWrite` (`Terminal.tsx`) with no
transition; `ptyData` is pty *output* and deliberately never clears
`waiting-permission`. Permission answers (`y`/`n`) are not `UserPromptSubmit`,
so that path doesn't help either. Result: the red dot lingers until the user
leaves and refocuses.

### Fix

On genuine interaction with a terminal, emit the existing `focusChanged` IPC
for that instance, **gated so it only fires when the instance currently needs
attention** (avoids per-keystroke IPC spam):

- `apps/desktop/src/components/instances/ColumnSlot.tsx` — the capture-phase
  `mousedown` handler already fires on every click into the terminal (even when
  already focused).
- `apps/desktop/src/components/Terminal.tsx` — the `term.onData` handler fires
  on every keystroke.

Both call a small helper that, when the instance's status is in
`ACTION_NEEDED_STATUSES`, invokes `window.watchtower.invoke('focusChanged',
{ instanceId })`. This reuses the existing `tabFocused → clearAttention`
transition — no new IPC kind, no new orchestrator state. The renderer already
has per-instance status available (App.tsx `statusById`); thread the minimal
signal needed to the interaction handlers.

Semantics deliberately match the current "focus clears attention" behaviour
(including that focusing/interacting with a `crashed` instance clears its dot,
as today) — this change only makes interaction with an already-focused terminal
consistent with switching away and back.

### Tests (Part B)

- A test that an instance in `waiting-permission` has its attention cleared when
  interaction is signalled while it is already the focused instance (the case
  that currently does nothing).
- Gate test: interaction on a `working`/`idle` instance does not spam
  `focusChanged`.

---

## Out of scope

- Converting ReportsTab to a multi-select.
- Any change to how attention is *raised* (hooks/state machine inputs).
- Refactoring the `contracts`/`project_rates` naming (separate follow-up).
