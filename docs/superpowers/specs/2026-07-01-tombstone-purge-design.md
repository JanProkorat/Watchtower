# Design — #79 TimeTracker sync: periodic tombstone purge

Epic #77 (remote access). Deferred from #69 (PR #78), specified in the remote
design doc (`2026-06-22-watchtower-ipad-remote-design.md`): tombstones are
"propagated, hard-purged in a later sweep." This is that sweep.

## Problem

Deleting a TimeTracker row (project / epic / task / worklog / contract / day-off)
is a **soft delete**: the row gets `deleted_at = <ts>` (and a bumped
`updated_at`) and is hidden everywhere (`deleted_at IS NULL` filters on every
read), but it physically remains in **both** stores — the Mac's SQLite and
Supabase Postgres. These tombstones accumulate forever. #79 physically removes
old tombstones once it is safe.

**Why tombstones exist (why not delete physically on the spot):** in a synced
system, physically removing a row makes a store that hasn't yet learned of the
deletion re-create it on its next sync ("resurrection"). The tombstone is the
durable record of the deletion that propagates to the other store. Once both
stores have seen it, the tombstone has done its job and can be removed.

## Topology (why this is simpler than the issue anticipated)

The issue assumed we must prove **every device** pulled a tombstone before
purging — implying per-device sync-state tracking that doesn't exist. The
implemented topology makes this unnecessary:

- **Only the Mac pushes.** The orchestrator runs the bidirectional sync (local
  SQLite ↔ Supabase) with per-table push/pull cursors stored **locally in the
  Mac's SQLite `settings`** (`orchestrator/sync/cursor.ts`).
- **iPad/iPhone are online-direct.** They read and write Supabase live and keep
  only a **read-only display cache** (Capacitor Preferences). They have **no
  separate store that re-pushes a full dataset**. They cannot resurrect a purged
  row by syncing.
- **Confirmed deployment: exactly one Mac, always.**

So the only actor that can resurrect a purged row is a Mac still holding it as a
**live** row. If the purge runs **only after a sync cycle has converged both
stores** (Mac has pulled/pushed every pending change), the Mac holds exactly the
tombstones Postgres holds and no live copy exists anywhere. A single-Mac,
Mac-driven, age-gated purge is therefore provably safe with **no new
per-device tracking**.

## Approach (chosen: A — Mac-driven purge after a converged sync)

Rejected alternatives:
- **B — Supabase-side cron.** A Mac offline > grace, still holding a row as
  live, re-pushes it after the cron purged it → resurrection. Safe only if the
  Mac's pull cursor is published to Postgres — the per-device tracking we avoid.
- **C — published-cursor two-phase purge.** The general multi-Mac-safe design
  (publish the Mac's pull high-water-mark to a shared table, purge below it).
  Overkill for one Mac (YAGNI); this is the upgrade path if a second Mac is ever
  added.

## Component

New module `orchestrator/sync/purge.ts`:

```
purgeTombstones(deps: {
  sqlite: Database,
  pg: PgStore,
  now: number,            // injected for testability
}): Promise<{ purged: Record<TableName, number> }>
```

Pure-ish: takes the two store handles + `now`, returns per-table purged counts.
Invoked by `SyncService` (`orchestrator/sync/service.ts`) at the end of a sync
cycle.

## Constants

- `GRACE_MS = 30 * 24 * 60 * 60 * 1000` — 30-day retention before hard-delete.
- `PURGE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000` — run at most once/day.

## Trigger & preconditions

`SyncService` calls `purgeTombstones` after a cycle **only if all hold**;
otherwise it skips silently until the next cycle:

1. This cycle's `pushAll` **and** `pullAll` both returned ok (both stores
   converged — the safety keystone).
2. `now − lastPurgeRunAt > PURGE_MIN_INTERVAL_MS` (throttle). `lastPurgeRunAt`
   is stored under settings key `sync.purge.lastRunAt` using the existing
   `cursor.ts` get/set helpers — **no migration** (the `settings` table already
   exists and takes arbitrary keys). Written after a successful purge.

## What it deletes

For each of the 6 synced tables: rows where
`deleted_at IS NOT NULL AND deleted_at < (now − GRACE_MS)`, from **both** stores.

Order: child → parent — `worklogs, tasks, contracts, epics, days_off, projects`
— so an FK-enforcing delete never orphans/violates. (A cascade-deleted subtree
is tombstoned together with near-equal `deleted_at`, so descendants and their
parent qualify in the same run.)

Per-store delete: `DELETE FROM <table> WHERE deleted_at IS NOT NULL AND
deleted_at < :threshold` (Postgres uses TIMESTAMPTZ, SQLite uses the ISO-Z TEXT
comparison already used throughout sync).

## Crash-safety / idempotency

Delete from **Postgres first, then SQLite**. Any partial failure is harmless and
self-heals:

- Leftover SQLite tombstone: its `updated_at` is ≥ 30 days old, far below the
  push cursor, so it **never re-pushes**; the next daily run deletes it.
- Leftover Postgres tombstone: still hidden by `deleted_at IS NULL` reads; the
  next run deletes it.

No cross-store transaction is needed. The operation is fully idempotent.

## Observability

Log a single summary line per run with per-table purged counts (mirrors the
existing conflict-logging style in `pull.ts`). Zero-count runs may log at debug
or be silent.

## Constraints & accepted risks (documented)

- **Single pushing Mac** is a safety precondition (confirmed). A second Mac
  would require Approach C before enabling purge.
- The 30-day grace is what covers the rare footgun of a client editing an
  already-deleted row from a weeks-stale offline cache (re-inserting it via
  upsert). This is consistent with the remote design's already-accepted LWW
  footguns for a single user.
- `sync_conflicts` log rows are **out of scope** — this purge is only the 6
  entity tables' tombstones. (A separate conflict-log retention sweep can come
  later if the table grows.)

## Testing

`tests/orchestrator/sync/purge.test.ts` (live Postgres, following the existing
`pull.test.ts` / `push.test.ts` harness):

- Purges tombstones with `deleted_at` older than `GRACE_MS` from **both** stores.
- Leaves fresh tombstones (< 30d) and all live rows (`deleted_at IS NULL`)
  untouched.
- Deletes child rows before parents without FK violation.
- `SyncService` skips purge when a cycle did not converge (push or pull failed).
- Throttle: a second call within `PURGE_MIN_INTERVAL_MS` is a no-op; a call
  after the interval runs.
- Idempotency: re-running purge on an already-purged store is a no-op.

Pure-unit coverage for the threshold/interval predicates where practical (no
Postgres needed), following the `schema.test.ts` split.

## Out of scope

- Any new schema, table, column, or Supabase-side job.
- Per-device sync-state tracking / multi-Mac support (Approach C).
- Undelete UI / audit retention beyond the grace window.
- Purging non-TimeTracker tables (`hook_events`, `notifications` — those have
  their own `pruneOlderThan`).
