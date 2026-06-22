# TimeTracker → Postgres + Offline-First LWW Sync — Design (#69)

**Date:** 2026-06-22
**Status:** Spec — pending user sign-off on schema decisions, then plan → execute
**Parent:** Epic #77 (iPad/iPhone remote access); sub-project #2 of 9
**Branch:** `feat/timetracker-postgres-sync`

---

## 1. Goal

Stand up a Postgres copy of the 6 TimeTracker tables and a background
**last-write-wins (LWW) sync** between the orchestrator's local SQLite and
Postgres, so that (later) the iPad/iPhone can read/write TimeTracker data
directly against the cloud DB while the desktop keeps working **fully offline**.
For now the cloud DB is a **local Postgres** (`watchtower` DB in the
`fitness-postgres` container); Supabase is swapped in at test/prod.

## 2. Architecture — the critical clarification

Postgres is a **sync hub**, NOT the orchestrator's primary store. The desktop
data path is unchanged:

```
Desktop renderer ──IPC──▶ orchestrator ──▶ local SQLite (primary working copy, offline-capable)
                                  │
                                  └── background LWW sync (push/pull) ──▶ Postgres (hub)
                                                                             ▲
                                          (later) iPad/iPhone ──supabase-js──┘
```

- The 6 TT repos **stay on SQLite** — no repo rewrite, no IPC change. This is
  what keeps the desktop offline-first and avoids a 40-method Postgres port.
- Postgres holds a **mirror** of the 6 tables (refactored schema + sync columns).
- A new **sync service** in the orchestrator reconciles SQLite ⟷ Postgres:
  push local changes up, pull remote changes down, LWW by `updated_at`,
  tombstones for deletes, conflict logging.
- Operational tables (`instances`, `hook_events`, `notifications`, `settings`)
  stay SQLite-only — never synced.

**Why this matters:** a naive "move repos to Postgres" would break offline use
(the orchestrator can't reach the hub when the Mac is off-net) and force a huge
IPC/type churn. Mirror + sync preserves the working desktop untouched.

## 3. Schema decisions (refactors — user delegated "do what's best")

Applied to the **Postgres** mirror, and the sync columns also added to the
**SQLite** tables (migration v13).

1. **Sync-tracking columns on all 6 tables** (both stores):
   - `sync_id TEXT` — a UUID, the **cross-store identity**. Generated on insert
     (SQLite side too). The sync matches rows by `sync_id`, never by the local
     integer PK.
   - `updated_at TIMESTAMPTZ NOT NULL` — bumped on every insert/update; the LWW
     comparison key.
   - `deleted_at TIMESTAMPTZ NULL` — tombstone; deletes become soft-deletes that
     propagate (a hard delete would resurrect on the next pull).

2. **Keep local integer PKs.** The desktop/IPC keep using numeric `id` exactly
   as today — zero contract churn. `sync_id` is the only thing that crosses the
   wire between stores. (iPad later reads Postgres rows by their own ids +
   `sync_id`; the two id-spaces map via `sync_id`.)

3. **Rename `project_rates` → `contracts`.** The IPC already calls them
   `contracts:*` and CLAUDE.md flagged the rename as the deferred follow-up —
   now is the time. SQLite table renamed in v13; Postgres uses `contracts`.

4. **Proper Postgres types** (the mirror): `INTEGER AUTOINCREMENT`→`SERIAL`
   (local-only PK; not the sync key), `INTEGER 0/1`→`BOOLEAN`, `TEXT` dates →
   `DATE` (`work_date`, `effective_from`, `end_date`), `TEXT datetime`→
   `TIMESTAMPTZ` (`created_at`/`updated_at`/`deleted_at`), `REAL`→`NUMERIC`,
   `jira_globs` TEXT-JSON → `JSONB`. CHECK constraints + the partial unique
   index `(source, external_id) WHERE source IS NOT NULL` carry over verbatim
   (Postgres supports both).

5. **Keep `is_billable`.** It is live (earnings reports, the time-log flow).
   Not dropped — the design's "review is_billable" resolves to "keep."

6. **Soft-delete changes repo delete semantics** for the 6 synced tables:
   `delete()` sets `deleted_at = now()` (+ bumps `updated_at`) instead of
   `DELETE`. FK `ON DELETE CASCADE` no longer fires, so cascades are done
   explicitly (deleting a project soft-deletes its epics→tasks→worklogs in a
   transaction). A periodic purge hard-deletes tombstones older than N days,
   on both stores, after they've synced.

## 4. Sync service (hand-rolled LWW)

- **Cursor:** a `sync_state` row per table (last-synced `updated_at` high-water
  mark), stored in SQLite `settings`.
- **Push:** local rows with `updated_at > cursor` → upsert into Postgres by
  `sync_id` (`ON CONFLICT (sync_id) DO UPDATE` only when the incoming
  `updated_at` is newer — LWW).
- **Pull:** Postgres rows with `updated_at > cursor` → upsert into SQLite by
  `sync_id`, LWW; apply tombstones.
- **Conflict:** same row changed both sides since last sync → newer `updated_at`
  wins (row-level); **log every resolved conflict** (loser snapshot) to a
  `sync_conflicts` audit table so nothing silently vanishes.
- **Trigger:** debounced after local writes + a periodic timer + on
  connectivity-regained; no-op cleanly when Postgres is unreachable (offline).
- **Idempotency:** worklog auto-imports keep dedupe via `(source, external_id)`;
  sync upserts are idempotent by `sync_id`.
- **Clocks:** rely on NTP-synced device clocks (per design risk note).

## 5. ETL (one-time, dev) — decision 1B

Snapshot the **real** prod SQLite TT data into local Postgres so migration +
sync run against realistic data, **prod untouched (read-only copy)**:
- Read the 6 tables from `~/Library/Application Support/Watchtower/data.db`
  (open read-only), backfill `sync_id` (deterministic UUIDv5 from
  table+PK so re-runs are stable), set `updated_at = created_at`,
  `deleted_at = NULL`, insert into local Postgres.
- The same SQLite rows also get `sync_id`/`updated_at` backfilled by v13 so the
  two stores start aligned (cursor = max(updated_at)).
- A re-runnable script (`orchestrator/scripts/etl-timetracker.ts`), not a
  migration; documents row counts in/out.

## 6. Tech

- Add **`pg`** (node-postgres) — matches the existing hand-written
  prepared-statement style (no ORM). Pool, `connectionString` from
  `WATCHTOWER_PG_URL` env (defaults to the local dev URL).
- **Postgres migrations:** a small versioned runner mirroring
  `orchestrator/db/migrations.ts` (a `pg_schema_version` table), source DDL in
  `orchestrator/db/pg/`. Dual-store wiring added in
  `orchestrator/db/connection.ts` (returns `{ sqlite, pg }`); `pg` is optional —
  if `WATCHTOWER_PG_URL` is unset/unreachable the orchestrator runs SQLite-only
  and sync is dormant (desktop must never hard-depend on Postgres).
- Test: vitest; integration tests run against the local `watchtower` Postgres
  (skip-with-warning if unreachable, like other env-gated suites).

## 7. Decomposition (plan tasks — each TDD, own commit)

1. **`pg` dep + dual-store connection** — `connection.ts` returns `{sqlite, pg}`;
   Postgres optional/lazy; env `WATCHTOWER_PG_URL`. Health-check test.
2. **Postgres migration runner + schema v1** — `orchestrator/db/pg/` DDL for the
   6 refactored tables (+ `sync_conflicts`); versioned runner; applied on boot
   when pg present.
3. **SQLite migration v13** — add `sync_id`/`updated_at`/`deleted_at` to the 6
   tables; rename `project_rates`→`contracts`; backfill `sync_id`
   (UUIDv5) + `updated_at`. (Update repo SQL for the rename.)
4. **Repo write-path: maintain sync columns + soft-delete** — repos bump
   `updated_at`, set `sync_id` on insert, convert `delete()` to soft-delete with
   explicit cascade. Keep all existing method signatures + tests green.
5. **ETL script** — prod SQLite (read-only) → local Postgres; deterministic
   `sync_id`; row-count report.
6. **Sync service: push** — local→Postgres upsert by `sync_id`, LWW, cursor.
7. **Sync service: pull + tombstones + conflict log** — Postgres→local, LWW,
   apply/propagate `deleted_at`, write `sync_conflicts`.
8. **Sync orchestration** — debounce + timer + offline no-op; wire into
   bootstrap; manual end-to-end against local Postgres (write each side, observe
   convergence).

## 8. Out of scope (later sub-projects)

- iPad/iPhone reading Postgres directly (`supabase-js`) — clients sub-projects.
- Supabase provisioning, RLS, auth — test/prod cutover (user provides creds).
- Offline *write* outbox on iPad — explicitly out per design (iPad offline =
  read-only).

## 9. Open decisions for sign-off

- **Schema refactors in §3** — especially `project_rates`→`contracts` rename and
  the `sync_id`/soft-delete model. (User pre-approved "do what's best"; flagged
  here because it touches billing data + delete semantics.)
- Everything else follows the design doc.
