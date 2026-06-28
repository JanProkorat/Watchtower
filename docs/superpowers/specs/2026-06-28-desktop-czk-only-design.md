# Desktop CZK-only — design

**Issue:** #108
**Date:** 2026-06-28
**Branch:** `feat/108-czk-only`

## Goal

Remove non-CZK currency support from Watchtower and standardize on CZK. The
contract editor currently lets you pick CZK / EUR / USD, and the earnings /
reports / task-grid layers carry a multi-currency aggregation structure
(`Record<currency, amount>`, per-currency rows, alphabetical currency sort).
None of it is used: CZK is the only currency anyone bills in. Standardizing
deletes that dead complexity end-to-end.

## Verified precondition — no data migration needed

Prod SQLite (`~/Library/Application Support/Watchtower/data.db`) holds 8
contracts, **all CZK**. There is no historical EUR/USD data anywhere, so this
is a pure schema-drop + code-simplification — no value-rewriting migration is
required. (The picker offered EUR/USD; nobody ever saved one.)

The TimeTracker schema-refactor freeze is lifted (the iPad data-plane work
already renamed `project_rates` → `contracts`), so dropping columns is now
permitted under the project's schema-change rules.

## Decisions

1. **Drop the columns** (not pin-to-CZK). Cleanest end state; the only-CZK
   reality makes it safe.
2. **Drop `projects.currency` too.** It defaulted to `'USD'`, is not used for
   billing, and is vestigial. Removing it eliminates the currency concept
   entirely.
3. **Drop the `rate_currency` derived column** on Postgres `worklogs`. The
   iPad billing module already assumes CZK-only; once desktop is CZK-only it
   carries no information.
4. **Include the iPad app in this change.** Dropping the PG columns breaks the
   iPad app's Supabase selects (PostgREST 400s on a missing column), so the
   iPad selects must be updated in the same change. See the rollout caution.
5. **Collapse the multi-currency aggregation to CZK scalars** (not "leave a
   single-key map"). `Record<currency, number>` → `number`, per-currency rows
   → a single row, etc.

## Scope by layer

### A. Schema

**SQLite — new migration v16** (current head is v15):
- `ALTER TABLE contracts DROP COLUMN currency`
- `ALTER TABLE projects DROP COLUMN currency`

`currency` is referenced in no SQLite index / view / trigger / generated column
(verified by grep over `migrations.ts`), so `DROP COLUMN` is valid (SQLite
≥ 3.35). **Fallback:** if an unexpected CHECK/constraint blocks the drop on
either engine, rebuild the table with the `tasks_new` RENAME pattern already
used by migrations v9 and v13.

> Engine note: the known SQLite engine-divergence caveat (node:sqlite in tests
> vs better-sqlite3 in prod) applies to ADD COLUMN with non-constant defaults —
> not to DROP COLUMN. The migration test must still run under node:sqlite and is
> expected to agree with prod here.

**Postgres — new migration v5** (current head is v4) in `db/pg/schema.ts`
`PG_MIGRATIONS`:
- `ALTER TABLE contracts DROP COLUMN IF EXISTS currency`
- `ALTER TABLE projects DROP COLUMN IF EXISTS currency`
- `ALTER TABLE worklogs DROP COLUMN IF EXISTS rate_currency`

Also edit the **base** DDL strings so fresh installs never create them:
- remove `currency` from the `PROJECTS` and `CONTRACTS` `CREATE TABLE` strings
- remove the `rate_currency` line from `WORKLOGS_BILLING`

(Editing the base strings only affects brand-new databases; existing DBs are
already past base version 1 and get the column removed via the v5 migration.)

### B. Sync layer

- `sync/schema.ts`: remove `{ name: 'currency', … }` from the `projects` and
  `contracts` column lists; remove `{ name: 'rate_currency', derived: true }`
  from `worklogs`.
- `sync/derive.ts` + `db/worklogBilling.ts`: drop `rateCurrency` from the
  deriver output and the `WorklogBilling` / `ContractLite` types.

**Ordering constraint:** the push SELECT in `sync/push.ts` is built from the
sync-schema column list, so the sync-schema edit and the SQLite column drop
**must ship in the same release** — a sync schema that lists `currency` while
SQLite has dropped it would make the push SELECT fail.

### C. Collapse multi-currency aggregation → CZK scalar

Replace per-currency maps/records with a single CZK number:
- `db/reports.ts`: `total_earned` / `avg_effective_hourly_rate`
  `Record<string, number>` → `number`; drop `GROUP BY … currency`, the
  `currency` SELECT columns, and the per-currency bucketing.
- `db/dashboardOverview.ts`: drop the `currency` sub-select; `currency` field
  removed from the active-contract payload.
- `db/taskGrid.ts`: remove `byCurrency` / `expectedByCurrency` maps and the
  alphabetical-currency sort; produce a single expected/total amount instead of
  one row per currency.
- `packages/shared/src/ipcContract.ts` + `messagePort.ts` +
  `billing/types.ts`: drop every `currency` / `rateCurrency` field; change the
  earnings record types to scalars.

### D. Formatting & renderer UI

- `apps/desktop/src/util/format.ts`: `formatEarnings(amount, currency)` →
  `formatEarnings(amount)`, hardcoded to `CZK` via `Intl.NumberFormat('cs-CZ',
  { style: 'currency', currency: 'CZK' })`. Keeps the NBSP-thousands / `Kč`
  cs-CZ convention.
- Update all callers; drop the `${currency}` suffixes in `RateHistorySection`,
  `TaskGridView`, `ProjectDetailPane`, `WorklogCellPopover`.
- `ContractDrawer.tsx`: **remove the CZK/EUR/USD `select` field** and the
  `draft.currency` member, the `emptyDraft` default, and the
  `.toUpperCase()` on submit.
- Earnings/chart components — collapse per-currency iteration to a single CZK
  value: `KpiTiles`, `TrendChart`, `EarningsSummary`, `ReportsTab`,
  `TaskGridView` earnings rows.

### E. iPad app (coupled)

- `apps/ipad/src/state/useBilling.ts` + `billingCache.ts`: remove
  `rate_currency` and `currency` from the Supabase select strings and the
  `ContractRow` / worklog-row mappings.

**Rollout caution (deploy ordering):** the desktop app runs `runPgMigrations`
on startup, so the first updated desktop to launch drops the PG columns live.
Any iPad build still selecting `rate_currency` / `currency` then 400s.
Therefore deploy the updated iPad build **at or before** the desktop release.

### F. Tests

Rewrite the multi-currency tests to CZK-only and delete EUR/USD fixtures:
- `tests/orchestrator/task-grid.test.ts` — extensive EUR/USD earnings tests.
- `tests/orchestrator/dashboardOverview.test.ts` — CZK/EUR mix.
- `tests/orchestrator/worklogBilling.test.ts` — EUR/CZK helper defaults.
- `tests/orchestrator/reports.test.ts`, `contracts-repo.test.ts`,
  `soft-delete.test.ts` — drop `currency` from fixtures.
- `tests/orchestrator/sync/derive.test.ts`, `sync/schema.test.ts`,
  `sync/pull.test.ts`, `sync/push.test.ts` — drop `rate_currency` assertions.
- `tests/ipad/billingCache.test.ts`, `projectDetailHelpers.test.ts` — drop
  `currency` / `rate_currency`.
- `tests/orchestrator/timetracker-migration.test.ts` — the TT legacy import
  schema still has `currency` (legacy source data); the importer reads from
  legacy and should simply not carry `currency` forward. Verify the import
  test still passes with `currency` absent from the destination schema.
- **New:** a migration test asserting v16 drops `contracts.currency` and
  `projects.currency` cleanly on a seeded (CZK) database, run under
  node:sqlite.

## Out of scope

- No `project_rates` / `is_billable` / other schema renames — only the currency
  removal.
- No change to the LWW sync semantics, deriver-merge logic, or billing math
  (rate × minutes is currency-agnostic; only the label goes away).

## Verification

(See memory: `sqlite-add-column-engine-divergence` for the engine-divergence
caveat referenced above.)

- `npx tsc -p orchestrator/tsconfig.json --noEmit` clean.
- `npx tsc -p apps/desktop/tsconfig.json` (and iPad) — no new currency-typed
  errors.
- `npm test` green (real-PG sync tests included; container reachable locally).
- Manual: fresh-DB boot creates no `currency` column; an upgrade boot drops it;
  contract drawer has no picker; earnings render `Kč` with NBSP thousands.

[SQLite ADD COLUMN engine divergence]: ../../.. "see memory: sqlite-add-column-engine-divergence"
