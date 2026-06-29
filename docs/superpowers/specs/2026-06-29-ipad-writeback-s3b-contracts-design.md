# iPad Billing — Write-back Slice 3b (Contract editing) Design

**Roadmap:** Sub-project #3 (write-back) of the iPad billing module. Slice 1
(time-off) PR #123, slice 2 (worklogs) PR #124, slice 3a (tasks) PR #125
(`3bea720`). Slice 3 was decomposed by entity; **this is 3b: contracts.**
Slice 3c (projects) remains deferred.
**Depends on:** the slice-1/2/3a foundation (online-direct write path,
`useBilling` optimistic patch + reducer, `billingWrites.ts` pure shapers,
write-RLS migration pattern, `canEdit` gating) and the shared
`computeWorklogBilling` formula (slice 2).
**Issue:** #120.

## Overview

Make a project's **contracts (rate history)** editable from the iPad: full
**create / edit / delete**, surfaced in the existing `ProjectDetailView` rate
table. Per the approved iPad design ([[ipad-ios-remote-design]]), the iPad is
**online-direct + read-only-offline**; LWW via `updated_at`; soft-delete.

A contract change ripples to **every affected worklog's `earned_amount`** (same
project, from the contract's `effective_from` forward). The iPad writes directly
to Supabase and has no deriver in its write path, and per
[[ipad-writeback-derived-fields]] the Mac never re-derives a foreign write on its
own. This slice resolves that ripple with a **hybrid** (the central decision):

1. **iPad recomputes earnings locally for instant display** — on a contract
   write, recompute the project's cached worklogs' `earnedAmount`/
   `effectiveMinutes` via the shared `computeWorklogBilling` + the new contract
   set, and patch them into the in-memory cache (**no worklog writes to
   Supabase**).
2. **Mac self-heals for authoritative persistence** — a new Mac pull-side hook
   runs `markWorklogsForRebill` when it pulls a foreign contract change; the
   Mac's deriver then recomputes and pushes the authoritative `earned_amount`
   to Supabase on its next sync.

Both are required: (1) gives immediate correct earnings on the iPad; (2) fixes
Supabase so the iPad's *next refetch* (and any other device) reads correct
values rather than regressing to stale ones. They use the same formula, so they
agree.

This is the **first write-back slice to touch the Mac sync path.**

## Global Constraints (inherited)

- **Online-direct writes only.** `INSERT`/`UPDATE` to Supabase via the
  authenticated client; edit controls disabled unless `useBilling` state is
  `fresh` (`canEdit(state)`).
- **Soft-delete only.** Delete = `UPDATE ... SET deleted_at = now,
  updated_at = now`.
- **LWW via `updated_at`.** Every write stamps `updated_at = now` (ISO).
- **Optimistic local cache patch** (not a refetch); roll back + inline error on
  failure (incl. the overlap-conflict message).
- **apps/ipad:** plain React + inline styles, no MUI ([[ipad-app-no-mui]]);
  cs-CZ; no i18n; reuse `ProjectDetailView` + `C` tokens; errors inline via the
  hook's `error` + `C.red` (no `useToast`).
- **iPad tests logic-only**: shapers, the overlap predicate, the contract/worklog
  reducers, and the local-rebill recompute are pure and unit-tested; the Supabase
  client is injected, never hit live. UI + hooks via typecheck.
- **`@watchtower/shared` is a built composite** ([[watchtower-workspace-resolution]]):
  vitest resolves it from source; `npm run typecheck` builds it first then
  typechecks all 6 projects — the canonical verification.
- Never edit `.env*`. Branch `feat/120-writeback-contracts`.

## 1. Read addition — `ContractRow.syncId`

`ContractRow` lacks `sync_id`; writes key on it.
- `ContractRow` (`packages/shared/src/billing/types.ts`): add `syncId: string`.
- `useBilling` contracts select: add `sync_id`; map `syncId: r.sync_id`.

## 2. Shared pure helpers — `packages/shared/src/billing/`

- **`contractsOverlap(aFrom, aEnd, bFrom, bEnd): boolean`** — the overlap
  predicate mirroring the orchestrator's `assertNoOverlap`
  (`orchestrator/db/repositories/projectRates.ts`): with `SENTINEL_END =
  '9999-12-31'`, two windows overlap iff
  `aFrom <= (bEnd ?? SENTINEL) AND (aEnd ?? SENTINEL) >= bFrom`. (`end_date`
  null = open-ended = +∞.) New file `contracts-overlap.ts`. **This is the only
  guard on iPad contract writes** — the iPad bypasses the orchestrator's check,
  and overlap is *not* DB-enforced — so it must be solid and well-tested.
- **`previousDay(date: string): string`** — `YYYY-MM-DD` minus one day (for the
  auto-close end_date). New file `date-helpers.ts` (or alongside). TZ-safe
  string math (no `Date` round-trip pitfalls; cf. [[sync-pull-date-shift-bug]]).

## 3. iPad write path — `apps/ipad/src/state/`

### 3a. `billingWrites.ts` (extend, pure)
- `ContractWriteInput = { projectId; effectiveFrom; endDate: string | null; rateType: 'hourly'|'daily'; rateAmount; hoursPerDay; mdLimit: number | null }`.
- `buildContractInsert(input, { syncId, now }): ContractInsertRow` →
  `{ sync_id, project_id, effective_from, rate_type, rate_amount, hours_per_day,
  end_date, md_limit, deleted_at: null, updated_at: now }` (`created_at` PG
  default).
- `buildContractUpdate(input, { now }): ContractUpdateRow` — same columns minus
  `sync_id`/`project_id`, plus `updated_at`. (Project is not changed on edit.)
- `buildContractEndDateUpdate(endDate, now)` → `{ end_date, updated_at }` (the
  auto-close write for the prior open-ended contract).
- `buildContractDelete(now)` → `{ deleted_at, updated_at }`.
- `applyContractWrite(contracts, change): ContractRow[]` — pure reducer:
  `{ type: 'upsert'; row }` replaces/adds by `syncId`; `{ type: 'remove'; syncId }`
  filters out.
- `rebillProjectWorklogs(worklogs, projectId, contracts): WorklogRow[]` — pure:
  for each worklog of `projectId`, recompute `effectiveMinutes`/`earnedAmount`
  via `computeWorklogBilling` (contracts filtered to the project), returning a
  new `worklogs` array with those rows replaced. (Reuses the slice-2
  `computeDerivedForWrite` internally; **cache-only**, never written to
  Supabase.)

### 3b. `useContractMutations.ts` (new, client-wired)
Wires `getSupabase()` + `crypto.randomUUID()` + ISO `now` + cached
`contracts`/`worklogs`:
- `createContract(input)`: validate overlap against the project's cached
  contracts (excluding none) via `contractsOverlap` → on conflict set an
  overlap error and abort; resolve the prior open-ended contract to auto-close
  (`effective_from < input.effectiveFrom`, `endDate == null`) and compute its
  `previousDay(input.effectiveFrom)` end; mint `syncId`; build the new contract
  set (`applyContractWrite` for the closed prior + the new); optimistic
  `patchContracts(newSet)` + `patchWorklogs(rebillProjectWorklogs(...))`; write
  to Supabase (`update` the prior's end_date if any, then `insert` the new);
  roll back both patches + error on failure.
- `updateContract(syncId, input)`: validate overlap excluding `syncId`; build
  new set; optimistic patches; `update(...).eq('sync_id', syncId)`; roll back on
  error.
- `deleteContract(syncId)`: build new set (remove); optimistic patches;
  soft-delete `.eq('sync_id', syncId)`; roll back on error.
- Returns `{ createContract, updateContract, deleteContract, pending, error }`.

### 3c. `useBilling.patchContracts(next)` + `PATCH_CONTRACTS` reducer
Mirror slice-2/3a `patchWorklogs`/`patchTasks`. (`patchWorklogs` already exists
and is reused for the local rebill.)

## 4. Mac self-heal — pull-side rebill hook (orchestrator)

- `pullTable` (`orchestrator/sync/pull.ts`) additionally returns the set of local
  **`project_id`s of contract rows it upserted** (foreign changes won LWW). For
  generality it returns `touchedFkIds: number[]` (the resolved local FK ids of
  upserted rows); for `contracts` these are project ids.
- `SyncService` (`orchestrator/sync/service.ts`), after `pullAll`: for each
  distinct project id in `pull.contracts.touchedFkIds`, call
  `markWorklogsForRebill(db, projectId, EARLIEST, nowIso())` (whole-project
  rebill — `EARLIEST = '0001-01-01'`; simplest and correct). The **next** push
  cycle (push-then-pull order) re-derives and pushes the authoritative
  `earned_amount`. One-cycle delay; acceptable.
- The hook fires only for genuinely-pulled (foreign) contract changes — a
  Mac-originated contract edit is pushed, never pulled, so it never
  double-rebills.

## 5. PG write RLS — `PG_MIGRATIONS` v9 (contracts)
Mirror v6/v7/v8 (idempotent, role-guarded, `FOR ALL`) scoped to `contracts`.

## 6. UI — editable rate history in `ProjectDetailView`
- The existing rate-history table (`ProjectDetailView.tsx`) gains, when
  `canEdit(state)`: a **"+ Přidat sazbu"** button → create drawer, and tap a
  contract row → edit drawer (effective_from, end_date, rate_type, rate_amount,
  hours_per_day, md_limit + **Smazat**). Offline = read-only (slice-1 hint).
- Inputs: native `<input type="date">` for the two dates; numeric fields for
  rate/hours/md_limit; a `rate_type` select (Hodinová/Denní, cs labels). Save
  disabled until required fields valid.
- Overlap conflict surfaces inline in `C.red` (e.g. "Sazba se překrývá s
  obdobím od … do …").
- Because the iPad recomputes earnings locally (§3a), the rate-history earnings
  column updates **immediately** on a write — no Mac-sync wait.

## Files

- `packages/shared/src/billing/types.ts` — `ContractRow.syncId`.
- `packages/shared/src/billing/contracts-overlap.ts` (new) — `contractsOverlap`.
- `packages/shared/src/billing/date-helpers.ts` (new) — `previousDay`.
- `apps/ipad/src/state/useBilling.ts` — contracts select+map `sync_id`;
  `patchContracts` + `PATCH_CONTRACTS`.
- `apps/ipad/src/state/billingWrites.ts` — contract shapers + `applyContractWrite`
  + `rebillProjectWorklogs`.
- `apps/ipad/src/state/useContractMutations.ts` (new) — client-wired hook.
- `apps/ipad/src/components/billing/ProjectDetailView.tsx` — editable rate
  history + drawers + gating.
- `orchestrator/sync/pull.ts` — `touchedFkIds` on the pull result.
- `orchestrator/sync/service.ts` — post-pull contract rebill.
- `orchestrator/db/pg/schema.ts` — `PG_MIGRATIONS` v9 (contracts write policy).

## Testing

Logic-only vitest (no live Supabase):
- `tests/shared/contractsOverlap.test.ts` — overlapping/adjacent/open-ended/
  sentinel cases (incl. exact-boundary touch = the orchestrator's predicate).
- `tests/shared/previousDay.test.ts` — month/year boundary, TZ-safe.
- `tests/ipad/billingWrites.test.ts` (extend) — `buildContractInsert/Update/
  EndDateUpdate/Delete`, `applyContractWrite` (add/replace/remove by syncId),
  `rebillProjectWorklogs` (recomputes only the project's worklogs; hourly+daily;
  null when no contract).
- `tests/ipad/billingCache.test.ts` (extend) — contracts map carries `syncId`.
- `tests/ipad/useBilling.test.ts` (extend) — `PATCH_CONTRACTS` (swap + no-op).
- `tests/orchestrator/` — the pull hook: pulling a foreign contract change marks
  the project's worklogs for rebill (assert `updated_at` bumped on the right
  worklogs, and only those); a Mac-originated push path does not double-rebill.
- `tests/orchestrator/pgMigrations.writeback.test.ts` (extend) — v9 present +
  guarded FOR-ALL contracts policy.
- UI + hooks via `npm run typecheck`.

## Risks & follow-ups

- **Client-side overlap is the only guard for iPad writes** (overlap is not
  DB-enforced). The shared predicate must exactly match the orchestrator's
  sentinel semantics; covered by a dedicated boundary-case test.
- **Refetch-before-Mac-syncs window:** if the iPad does a hard refetch after a
  contract write but before the Mac has re-billed Supabase, it briefly reads
  stale stored `earned_amount` (then self-corrects once the Mac syncs; user can
  wake-on-LAN). Single-user, rare; accepted.
- **Non-atomic multi-write:** create issues two Supabase writes (auto-close prior
  + insert new). If the second fails, the optimistic cache rolls back but the
  prior contract's `end_date` write may have landed. The hook writes the prior
  close only after a successful overlap check and rolls back the cache on any
  error; a partial server state is possible but self-heals on the next desktop
  edit / is correctable. Documented; not guarded with a transaction (no RPC
  infra).
- **Whole-project rebill on the Mac** is coarse (re-derives all the project's
  worklogs even for a late-dated contract) but correct and simple; the deriver
  is cheap.
- The slice-3a follow-up bundle (test-fixture `epics: []`, `WorklogListView`
  cast, lockstep `finally`) is independent and can ride along or stay separate.

## Out of this slice (future)
- Slice 3c: projects editing (cascade-delete + atomic is_default).
- Offline outbox; converging desktop/iPad write paths.
