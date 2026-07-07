# Shared contracts across projects — design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Scope:** desktop (SQLite/orchestrator) + Postgres schema/sync + iPad/iPhone billing UI

## Problem

A contract today belongs to exactly one project (`contracts.project_id`, one
row per project). But a real client contract / SOW often covers **several
projects at once**, with a single rate and a single man-day (MD) budget that is
consumed across all of them combined. There is no way to express that: the user
must re-enter the same rate on every project, and each project tracks its MD
budget in isolation, so there is no shared "MDs remaining" figure.

We want: **one client contract spanning multiple projects, with one shared MD
budget pool consumed by worklogs across all linked projects.**

Product decisions (from brainstorming):

- Motivation: one client contract, many projects.
- MD budget: **one shared pool** across all linked projects.
- Workflow: **link projects to a contract** — create the contract, then choose
  the projects it covers via a multi-select; it appears on every linked
  project's Contracts view.
- Platform: **everything** — desktop + Postgres schema/sync + iPad/iPhone UI.

## Chosen approach — Approach A: contract group id

Add one nullable column `contract_group_id` to `contracts`. A shared contract is
represented as **a set of ordinary per-project contract rows** — one row per
linked project — all carrying the same `contract_group_id` and **identical
terms** (`effective_from`, `end_date`, `rate_type`, `rate_amount`,
`hours_per_day`, `md_limit`). A `NULL` group id is a solo contract, i.e. exactly
today's behavior, unchanged.

### Why not a junction table or a client entity

The sync engine, worklog rate-resolution, rebilling, and overlap checks are all
hardwired to one `project_id` per contract row
(`orchestrator/sync/schema.ts:150`, `orchestrator/sync/push.ts:12`,
`orchestrator/sync/pull.ts:14`, `orchestrator/sync/derive.ts:36`,
`orchestrator/db/repositories/projectRates.ts`). A new synced *table*
(Approach B, `contract_projects` junction) would need its own sync-registry
entry, FK resolution in push/pull, and tombstone/LWW handling, plus a rewrite of
rate-resolution / rebilling / overlap to join through it — the largest blast
radius and the highest sync risk, exactly against the full-platform scope. A
top-level `clients` entity (Approach C) is a bigger build still and over-serves
the chosen "link projects" workflow.

Approach A rides all the existing per-project machinery unchanged and adds
shared-contract semantics as **a single column + group-aware orchestration**,
with **no new synced table**. Its one tradeoff — the shared terms
(`md_limit` etc.) are stored redundantly on each member row — is contained by
maintaining the "terms identical across a group" invariant in the service layer
(every group edit rewrites all member rows).

## Data model & migration

- **New column** `contract_group_id TEXT` (nullable) on `contracts`, both
  engines.
  - SQLite: migration **v17** via `addColumnIfMissing(db, 'contracts',
    'contract_group_id', 'TEXT')` (replay-safe), plus
    `CREATE INDEX IF NOT EXISTS idx_contracts_group ON
    contracts(contract_group_id)`.
  - Postgres: migration **v10** — `ALTER TABLE contracts ADD COLUMN IF NOT
    EXISTS contract_group_id TEXT;` + matching index.
- **Invariant:** all live rows sharing a `contract_group_id` have identical
  `effective_from`, `end_date`, `rate_type`, `rate_amount`, `hours_per_day`,
  `md_limit`; they differ only by `project_id` / `id` / `sync_id`.
- **Untouched:** the existing `UNIQUE(project_id, effective_from)` constraint on
  both engines. Each member row is still unique per project, so this feature is
  orthogonal to the separate deferred Postgres tombstone-unique bug fix.
- **Sync:** add `contract_group_id` (kind `text`, no FK) to the `contracts`
  column list in `orchestrator/sync/schema.ts`. It travels as a plain column;
  each member row still syncs independently via its own `project_sync_id`, and
  the group reassembles on any store by matching the id. **No new synced
  table, no new FK resolution.**

## Orchestrator operations & IPC

### IPC surface (`packages/shared/src/ipcContract.ts` + `messagePort.ts`)

- Extend `ContractInputPayload` with `projectIds: number[]` — the set of
  projects the contract covers. Length 1 = solo (backward compatible); length
  ≥2 = shared group. **The drawer's multi-select *is* the membership**, so
  link/unlink becomes a save-time diff rather than separate operations.
- `contracts:create`: if `projectIds` has ≥2 entries, mint a `group_id` and, in
  one transaction, run the **existing** per-project create (auto-close +
  `assertNoOverlap` + insert/resurrect) for each project with the group id set.
  Any overlap rolls back the whole operation and returns the overlap error,
  extended to name the conflicting project.
- `contracts:update` on a grouped row: propagate the new terms to **every**
  member row **and** reconcile membership against `projectIds` (create rows for
  newly-checked projects with the group's terms; soft-delete rows for unchecked
  projects); rebill every affected project.
- `contracts:delete` on a grouped row: soft-delete **all** member rows.
- `ContractViewPayload` gains `groupId: string | null` and `projectIds:
  number[]`. The overlap-error response gains `conflictingProjectId` and
  `conflictingProjectName`. All mirrored in `messagePort.ts`
  (`OrchContractInput` / `OrchContractView` / `OrchOverlapError`).

### Repo / service (`orchestrator/db/repositories/projectRates.ts`)

New group-aware methods (or a thin `ContractGroupService` wrapping the repo),
each in a single transaction:

- `createShared(terms, projectIds[])` → group id.
- `updateGroup(groupId, terms, projectIds[])` — propagate terms + membership
  diff.
- `deleteGroup(groupId)` — soft-delete all members.
- `listGroupMembers(groupId)` — project ids in the group.

The per-project `create`, `assertNoOverlap`, `autoClosePrevious`, and the
Problem-1 tombstone-resurrection path are reused as-is for each member.

## Pooled MD budget (`orchestrator/db/contractStatus.ts`)

- `ContractStatusService.forRate(rate, asOf)`: when `rate.contractGroupId` is
  set, resolve the member project ids
  (`SELECT DISTINCT project_id FROM contracts WHERE contract_group_id = ? AND
  deleted_at IS NULL`) and change the worklog-sum join
  (`contractStatus.ts:79`) from `e.project_id = ?` to `e.project_id IN
  (…members…)`, compared against the single `md_limit`. Result: one pooled
  `minutesLogged` / `mdsUsed` / `mdsRemaining`, shown identically on every
  linked project's card.
- **Dedupe:** `contractsReport` (`orchestrator/db/reports.ts:370`) and
  `dashboardOverview` (`orchestrator/db/dashboardOverview.ts:110`) currently loop
  per project and call `forProject`; for a grouped contract that would count the
  pool once *per member*. Both must dedupe by `contract_group_id` and report a
  grouped contract **once**, listing its member projects.
- iPad/web mirror `contractBurn` (`packages/shared/src/billing/contracts.ts:59`)
  gets the same member-set change (filter worklogs by the member project set
  instead of a single `projectId`).

## Rate resolution & rebilling

Unchanged per project. Each project keeps its own contract row, so
`resolveContract` / `computeWorklogBilling`
(`packages/shared/src/billing/worklogBilling.ts`), the sync deriver
(`orchestrator/sync/derive.ts`), and `markWorklogsForRebill`
(`orchestrator/db/rebill.ts`) all continue to operate on a single project's
contracts. Because every group member carries identical rate terms, per-project
earnings are consistent across the group. Group edits call
`markWorklogsForRebill` for **each** affected project.

## UI

### Desktop (`apps/desktop/src`)

- `components/timetracker/ContractDrawer.tsx`: add a "Sdíleno s projekty"
  multi-select (Autocomplete of other `work` projects), pre-filled from the
  current group members when editing. On save, `projectIds = [thisProject,
  ...selected]`.
- `components/timetracker/RateHistorySection.tsx` /
  `ActiveContractCard`: when a contract is grouped, show a
  "Sdílená smlouva · N projektů" chip and the member project names; the MD
  progress bar reflects the pool. Surface the overlap error naming the
  conflicting project.
- State hook `apps/desktop/src/state/useContracts.ts`: pass `projectIds` through
  create/update; expose `groupId` / member projects on the view.

### iPad / iPhone (`packages/module-timetracker/src/billing` + `packages/data-supabase`)

- `ProjectDetailView.tsx` inline `ContractDrawer` + shared badge mirroring the
  desktop.
- `useContractMutations.ts`: group-aware create/update/delete — write N Supabase
  rows with the same `group_id`; propagate term edits + membership diff across
  the group; optimistic cache update + `rebillProjectWorklogs` across **all**
  member projects; overlap pre-checked against each target project's existing
  contracts (naming the conflict).

## Error handling & edge cases

- **Overlap on link:** linking a project that already has an overlapping
  contract rejects the whole operation and names the project (transaction
  rollback on desktop; pre-check + abort on iPad).
- **Term consistency:** `md_limit` (and all terms) single source of truth = the
  drawer value; rewritten to every member on each edit.
- **Auto-close:** `autoClosePrevious` still runs per project as each member row
  is created.
- **Unlink last member:** removing the final project dissolves the group (all
  rows soft-deleted). A one-member group still functions (pool over one
  project).
- **Concurrent multi-device edits:** per-row LWW can transiently diverge terms
  across members; acceptable under the single-Mac-push topology (only the Mac
  pushes). Documented, not defended against in v1.
- **Tombstone resurrection:** re-linking a project that previously had a
  soft-deleted row at the same `effective_from` composes for free via the
  Problem-1 resurrection path in `create()`.

## Testing

- **Repo/service:** `createShared` across 3 projects; overlap rejection names
  the conflicting project; `updateGroup` propagates terms + membership diff
  (add/remove projects); `deleteGroup` soft-deletes all members; pooled
  `forRate` sums minutes across members against one `md_limit`; report +
  dashboard dedupe a grouped contract to a single row.
- **Shared billing:** `contractBurn` pooled across the member set.
- **Sync:** `contract_group_id` round-trips push/pull; grouped rows reassemble
  on the mirror store.
- **Migrations:** SQLite v17 adds the column and is replay-safe; Postgres v10
  adds the column.
- **iPad mutations:** `useContractMutations` group create/update/delete —
  optimistic cache + rebill across all members.

## Out of scope (v1)

- Cross-store defense against concurrent divergent edits of shared terms.
- A first-class `clients` entity (Approach C) — revisit if SOW modeling grows.
- The separate Postgres tombstone-unique bug fix (tracked independently).
