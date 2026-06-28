# iPad Billing — Write-back Slice 1 (Time-off) Design

**Roadmap:** Sub-project #3 (write-back) of the iPad billing module — the inverse of the now-complete read module (R1 #109 / R2 #117 / R3 #118). Write-back decomposes into a **write foundation** + per-entity edit slices. **This is slice 1: the foundation + `days_off` (time-off) editing.** Later slices: worklog edit (slice 2), then contracts/projects/tasks.
**Unblocked by:** #107 (DATE pull round-trip fix, merged `9fc0584`) — a prerequisite for any second-writer/pull path.
**Depends on:** the read module (cached `BillingDataset`, `useBilling`, authenticated `supabase` client, R3 `TimeOffView` + `buildTimeOffModel`).
**Issue:** #120.

## Overview

Make the iPad's **Volno** (time-off) view **editable**, and build the reusable **write foundation** every later slice rides on. Per the approved iPad design ([[ipad-ios-remote-design]]), the iPad is **online-direct + read-only-offline** — writes go straight to Supabase when online; editing is disabled offline. Single-user **last-write-wins** via `updated_at`; deletes are **soft** (tombstone `deleted_at`) so the Mac's pull never resurrects them.

`days_off` is the deliberate first entity: the simplest table (no derived billing fields), so slice 1 stays focused on proving the foundation (write RLS + write path + DATE round-trip).

## Global Constraints

- **Online-direct writes.** Write `INSERT`/`UPDATE` to Supabase via the existing authenticated client. **No offline outbox** — edit controls are disabled whenever `useBilling` state is `offline`/`cached` (offline stays read-only, as today).
- **Soft-delete only.** "Clear a day" = `UPDATE ... SET deleted_at = now, updated_at = now`. The iPad never issues a hard `DELETE`.
- **LWW via `updated_at`.** Every write stamps `updated_at = now` (ISO). The Mac pulls the row on its next sync; #107 guarantees `date` round-trips. No merge logic (single user).
- **RLS scoped to `days_off` only** in slice 1 (least-privilege). Later slices add their tables, mirroring the pattern.
- **Optimistic local cache update** (not a full refetch): on a successful write, patch the in-memory `days_off` array; on error, roll back + toast. (The dataset is ~thousands of rows; per-tap refetch is wasteful.)
- **No new pure-recompute** — `days_off` has no derived fields. `buildTimeOffModel` (R3) is reused unchanged for rendering.
- **apps/ipad:** plain React + inline styles, no MUI; cs-CZ; no i18n; reuse R3 `TimeOffView` + `reports/tokens.ts` `C`.
- **iPad tests are logic-only**: write-payload shaping + optimistic-patch reducer + offline-gating predicate are pure and unit-tested; the Supabase client is injected (mockable), never hit live. UI via typecheck.
- Never edit `.env*`. Branch `feat/120-writeback-timeoff`.

## The write foundation (reused by every later slice)

### 1. Supabase write RLS — `orchestrator/db/pg/schema.ts`
Add **`PG_MIGRATIONS` version 5** mirroring the v4 read-policy pattern (idempotent, `authenticated`-role-guarded so plain-Postgres dev/test still works), scoped to `days_off`:
```sql
ALTER TABLE days_off ENABLE ROW LEVEL SECURITY;          -- already on; idempotent
DROP POLICY IF EXISTS write_authenticated ON days_off;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON days_off
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
```
`FOR ALL` covers INSERT/UPDATE (soft-delete is an UPDATE). Single user → `USING/WITH CHECK (true)` (every authenticated session is the owner). The read `read_authenticated` SELECT policy stays; permissive policies OR together.

### 2. `sync_id` on the synced `days_off` read
`days_off.sync_id` is `NOT NULL UNIQUE`, but the cached `DayOffRow` (`{date, kind}`) doesn't carry it — so the iPad can't preserve identity when updating an existing row. Add `sync_id` to the read (additive, mirrors R3's `source`):
- `DayOffRow` (`packages/shared/src/billing/types.ts`): add `syncId: string`.
- `useBilling` `days_off` select: `select('date,kind,sync_id')`; map `syncId: r.sync_id`.

### 3. Write helper — `apps/ipad/src/state/billingWrites.ts`
The shared write primitive (slice 2+ reuse the same module). Pure **payload-shaping** functions (injected `now`/`syncId`) + a thin client-calling layer:
- `buildDayOffUpsert(date, kind, opts: { syncId: string; now: string }): DayOffUpsertRow` → `{ sync_id, date, kind, note: null, deleted_at: null, updated_at: now }`.
- `buildDayOffDelete(now: string): { deleted_at: string; updated_at: string }` → `{ deleted_at: now, updated_at: now }`.
- `applyDayOffWrite(daysOff, change): DayOffRow[]` — the optimistic-patch reducer: upsert-by-date or remove-by-date. Pure, unit-tested.
- A `useDaysOffMutations()` hook wires the real `supabase` client + `crypto.randomUUID()` + `new Date().toISOString()`: `setDayOff(date, kind)` (upsert on `date`, preserving the existing row's `syncId` from the cache or minting a UUID for a new date) and `clearDayOff(date)` (update-by-date soft-delete). Each does optimistic patch → await write → on error roll back + `showError`.

### 4. Optimistic cache patch — `useBilling`
Expose `patchDaysOff(next: DayOffRow[])` (or `patch((d) => d)`) that swaps `data.daysOff` in place and re-saves the Capacitor cache, so a write reflects immediately without refetching the whole dataset. Roll back = patch with the prior array on write failure.

## UI — make R3 `TimeOffView` editable

- **Online gate:** read `state` from `useBilling`; when `offline`/`cached`, the calendar is display-only (no tap handlers, a subtle "jen pro čtení offline" hint). When `fresh`, days are interactive.
- **Tap a weekday/weekend cell** → an inline **kind picker** (Dovolená / Nemoc / Jiné / *Smazat*). Choosing a kind = `setDayOff(date, kind)`; *Smazat* on a marked day = `clearDayOff(date)`.
- **Public-holiday days** are tappable to *add* a user day-off shadowing the holiday (matches desktop); the computed holiday is never edited. (`buildTimeOffModel` already lets a user day-off win over a holiday.)
- A small per-write status affordance ("ukládám…/uloženo", error toast on failure). Reuse the existing `useToast`/`showError` pattern.

## Files

- `orchestrator/db/pg/schema.ts` — `PG_MIGRATIONS` v5 (days_off write policy).
- `packages/shared/src/billing/types.ts` — `DayOffRow.syncId`.
- `apps/ipad/src/state/useBilling.ts` + `billingCache.ts` — select+map `sync_id`; `patchDaysOff`.
- `apps/ipad/src/state/billingWrites.ts` (new) — payload shapers + optimistic reducer.
- `apps/ipad/src/state/useDaysOffMutations.ts` (new) — the client-wired hook.
- `apps/ipad/src/components/billing/records/TimeOffView.tsx` — editable interaction + kind picker + online gating.

## Testing

Logic-only vitest (no live Supabase):
- `tests/ipad/billingWrites.test.ts` — `buildDayOffUpsert` (fields incl. `deleted_at: null`, stamped `updated_at`), `buildDayOffDelete`, `applyDayOffWrite` (add new date / replace existing kind / remove on delete), and an offline-gating predicate.
- `tests/ipad/billingCache.test.ts` (extend) — `mapDayOffRow`/dataset maps `sync_id`.
- The migration: a `PG_MIGRATIONS` shape/version test if one exists for v4; otherwise assert v5 is present and idempotent-safe (mirror any existing schema test).
- UI via `tsc -b packages/shared && tsc -p apps/ipad --noEmit`. Note: with #122 (CI gate now includes desktop) merged, the gate also typechecks desktop — keep the branch rebased.

## Risks & follow-ups
- **`sync_id` on re-marking a soft-deleted date (MUST preserve — not harmless):** the cache holds only non-deleted rows, so re-marking a previously-cleared date can't see the tombstone's `sync_id`. Minting a *new* one and upserting on the `date` PK overwrites the row's `sync_id` — and because the Mac's sync push **and** pull key on `sync_id` (not date), the resulting `date`-PK collision is silently swallowed on both sides, wedging the Mac's local copy out of convergence for that date (same class the desktop avoids via `daysOff.getIncludingDeleted`). **Fix (implemented):** `setDayOff` resolves the existing `sync_id` with a tombstone-inclusive lookup (`select('sync_id').eq('date',date)`, no `deleted_at` filter) before upserting, minting only when no row exists for the date at all.
- **Mac re-derivation:** none needed — `days_off` has no derived fields (the reason it's slice 1). Worklog write (slice 2) WILL need to resolve "who computes `earned_amount`/`effective_minutes` for an iPad-written worklog" — call it out there, not here.
- **Write RLS verification:** the policy is applied when the orchestrator runs PG migrations against Supabase; confirm v5 runs on the live project (the migration runner is idempotent/versioned).
- Converging desktop/iPad write paths is out of scope.

## Out of this slice (future)
- Slice 2: worklog create/edit/delete (+ the derived-field question).
- Later: contracts / projects / tasks editing; offline outbox (only if online-direct proves insufficient).
