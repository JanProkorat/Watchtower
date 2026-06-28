# Desktop CZK-only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all non-CZK currency support from Watchtower — drop the `currency` columns and the `rate_currency` derived column, collapse the multi-currency aggregation to CZK scalars, remove the contract-editor picker, and update the coupled iPad selects.

**Architecture:** A top-down deletion refactor across four tasks, each leaving the tree compiling and tests green. References to the DB columns are removed layer by layer (write path → reporting/aggregation → sync/derived → schema), and the columns are physically dropped last, once nothing reads them. A `'CZK'` literal bridges the `contracts.currency NOT NULL` constraint between the write-path task and the final drop.

**Tech Stack:** TypeScript, Electron, React + MUI v5, node:sqlite (tests) / better-sqlite3 (prod), Postgres (Supabase data plane), vitest.

## Global Constraints

- **No data migration needed** — prod holds 8 contracts, all CZK; zero historical EUR/USD data anywhere.
- **Locale:** keep cs-CZ money formatting — NBSP thousands, `Kč` symbol. All earnings format via `Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 2 })`.
- **No i18n.**
- **Green per task:** every task ends with `npx tsc -p orchestrator/tsconfig.json --noEmit` clean and `npm test` green (real-PG sync tests run against the local `fitness-postgres` container). Renderer typecheck `npx tsc -p apps/desktop/tsconfig.json` must add no new currency-typed errors (pre-existing drift is documented in CLAUDE.md — do not fix it).
- **Backups:** schema migrations are versioned and idempotent; follow the existing runner patterns (`orchestrator/db/migrations.ts`, `orchestrator/db/pg/schema.ts`).
- **Scope discipline:** only the currency removal. Do NOT rename `project_rates`→`contracts` further, touch `is_billable`, or refactor unrelated code.
- **Branch:** `feat/108-czk-only` (already created; the design doc is committed on it).

---

## File map

| File | Task | Change |
|---|---|---|
| `packages/shared/src/ipcContract.ts` | 1, 2 | drop `currency` fields; collapse earnings `Record<string,number>`→`number` |
| `packages/shared/src/messagePort.ts` | 1, 2 | mirror the same |
| `packages/shared/src/billing/types.ts` | 3 | drop `ContractRow.currency`, `WorklogRow.rateCurrency` |
| `orchestrator/db/repositories/projectRates.ts` | 1, 4 | drop `currency` from types/SELECT; bridge INSERT with `'CZK'` (T1) then remove (T4) |
| `orchestrator/index.ts` | 1 | drop `currency` from contract handler payloads |
| `apps/desktop/src/components/timetracker/ContractDrawer.tsx` | 1 | remove currency picker + `draft.currency` |
| `apps/desktop/src/components/timetracker/RateHistorySection.tsx` | 1 | drop `${currency}` from rate/earnings formatting |
| `apps/desktop/src/components/timetracker/ProjectDetailPane.tsx` | 1 | drop `${currency}` from `formatRate` |
| `orchestrator/db/reports.ts` | 2 | drop `currency` SELECT/GROUP BY; `Record`→scalar |
| `orchestrator/db/reportsSql.ts` | 2 | drop `pr.currency` from SELECT |
| `orchestrator/db/dashboardOverview.ts` | 2 | drop `currency` sub-select; `earned` `Record`→scalar |
| `orchestrator/db/taskGrid.ts` | 2 | remove `byCurrency`/`expectedByCurrency` maps + currency sort → single amount |
| `apps/desktop/src/util/format.ts` | 2 | `formatEarnings(amount)` hardcoded CZK |
| `apps/desktop/.../KpiTiles.tsx`, `charts/TrendChart.tsx`, `charts/EarningsSummary.tsx`, `ReportsTab.tsx`, `TaskGridView.tsx`, `WorklogCellPopover.tsx` | 2 | collapse per-currency iteration to a single CZK value |
| `orchestrator/db/worklogBilling.ts` | 3 | drop `ContractLite.currency`, `WorklogBilling.rateCurrency` |
| `orchestrator/sync/derive.ts` | 3 | drop `currency` from contracts SELECT; drop `rate_currency` from output |
| `orchestrator/sync/schema.ts` | 3 | drop `currency` from `projects`+`contracts`; drop `rate_currency` derived from `worklogs` |
| `apps/ipad/src/state/useBilling.ts`, `billingCache.ts` | 3 | drop `rate_currency`/`currency` from selects + mappings |
| `orchestrator/db/migrations.ts` | 4 | add SQLite migration v16 (DROP COLUMN) |
| `orchestrator/db/pg/schema.ts` | 4 | add PG migration v5 (DROP COLUMN IF EXISTS) + edit base DDL |
| `orchestrator/db/migrateTimetracker.ts` | 4 | drop `currency` from `projects`+`project_rates` COLUMNS |

**Tests touched:** `contracts-repo.test.ts` (T1); `reports.test.ts`, `dashboardOverview.test.ts`, `task-grid.test.ts` (T2); `sync/derive.test.ts`, `sync/schema.test.ts`, `sync/pull.test.ts`, `sync/push.test.ts`, `worklogBilling.test.ts`, `ipad/billingCache.test.ts`, `ipad/projectDetailHelpers.test.ts` (T3); new migration test + `timetracker-migration.test.ts` (T4).

> **Conflict note:** `tests/orchestrator/sync/push.test.ts` and `orchestrator/sync/push.ts` are also edited by the in-flight PR #111 (resilient push). Whichever PR merges second must rebase; the edits are in different regions (push.ts loop body vs. nothing here; push.test.ts new test vs. the `rate_currency` assertion in the existing "derived billing columns" test).

---

## Task 1: Remove currency from the contract write path

Removes the contract-editor currency picker and the `currency` field from the contract input/view types and the repo's read path. The repo's INSERT keeps a literal `'CZK'` so the `contracts.currency NOT NULL` constraint still holds until Task 4 drops the column.

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (`ContractInputPayload`, `ContractViewPayload`)
- Modify: `packages/shared/src/messagePort.ts` (`OrchContractInput`, `OrchContractView`)
- Modify: `orchestrator/db/repositories/projectRates.ts`
- Modify: `orchestrator/index.ts` (contract create/view handler, ~line 258, 280)
- Modify: `apps/desktop/src/components/timetracker/ContractDrawer.tsx`
- Modify: `apps/desktop/src/components/timetracker/RateHistorySection.tsx`
- Modify: `apps/desktop/src/components/timetracker/ProjectDetailPane.tsx`
- Test: `tests/orchestrator/contracts-repo.test.ts`

**Interfaces:**
- Produces: `ProjectRateInput` and `ProjectRateRow` (in `projectRates.ts`) **without** a `currency` field. `ContractInputPayload` / `ContractViewPayload` (and their `Orch*` mirrors) without `currency`.
- Consumes: nothing from later tasks.

- [ ] **Step 1: Update the repo test to drop `currency`**

In `tests/orchestrator/contracts-repo.test.ts`, remove `currency: 'CZK'` from every `create({...})` input and any `expect(...).currency` assertion (the map flagged line 31). The repo input type no longer carries currency.

- [ ] **Step 2: Run it — verify it fails to compile**

Run: `npx vitest run tests/orchestrator/contracts-repo.test.ts`
Expected: TS error / failure because the implementation still references `currency` (or the test still passing-but-compiling — if it still compiles, that's fine; the real gate is Step 4).

- [ ] **Step 3: Strip `currency` from the repo**

In `orchestrator/db/repositories/projectRates.ts`:
- Delete `currency: string;` from `ProjectRateRow` (line 12), `ProjectRateInput` (line 24), and `DbRow` (line 36).
- Delete `currency: r.currency,` from `toRow` (line 50).
- Delete `currency,` from all three SELECT column lists (lines 85, 99, 112).
- In `create()`, keep the column in the INSERT but write a literal (NOT NULL bridge). Change the column list at line 134 to keep `currency` and the VALUES placeholder, and pass `'CZK'` instead of `input.currency` at line 143:

```ts
const info = this.db
  .prepare(
    `INSERT INTO contracts
       (project_id, effective_from, rate_type, rate_amount, currency,
        hours_per_day, end_date, md_limit, sync_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  .run(
    input.projectId,
    input.effectiveFrom,
    input.rateType,
    input.rateAmount,
    'CZK', // bridge: contracts.currency is NOT NULL until migration v16 drops it (Task 4)
    input.hoursPerDay ?? 8,
    input.endDate ?? null,
    input.mdLimit ?? null,
    newSyncId(), nowIso(),
  ) as { lastInsertRowid: number | bigint };
```

- In `update()`, delete the `if (input.currency !== undefined) push('currency', input.currency);` line (177).

- [ ] **Step 4: Drop `currency` from the shared contract types**

In `packages/shared/src/ipcContract.ts`: delete `currency: string;` from `ContractInputPayload` (line 320) and `currency: string;` from `ContractViewPayload` (line 333).
In `packages/shared/src/messagePort.ts`: delete `currency: string;` from `OrchContractInput` (line 222) and `OrchContractView` (line 235).

- [ ] **Step 5: Fix the orchestrator contract handler**

In `orchestrator/index.ts`, the contract create/view handler builds a `ContractInput` from the payload and a `ContractView` from `rate`. Delete the `currency` field from the interface around line 258 and the `currency: rate.currency,` mapping around line 280. Do not pass `currency` into `ProjectRatesRepo.create/update`.

- [ ] **Step 6: Remove the currency picker from the drawer**

In `apps/desktop/src/components/timetracker/ContractDrawer.tsx`:
- Delete `currency: string;` from the `Draft` interface (line 47).
- Delete `currency: 'CZK',` from `emptyDraft()` (line 69).
- Delete `currency: c.currency,` from `draftOf()` (line 81).
- Delete `currency: draft.currency.trim().toUpperCase(),` from the submit payload (line 132).
- Delete the entire currency `TextField select` block (lines 237–243, the `label="Currency"` field with its CZK/EUR/USD `MenuItem`s).

- [ ] **Step 7: Drop `${currency}` from contract display formatting**

In `apps/desktop/src/components/timetracker/RateHistorySection.tsx`:
- In `formatRate` (line 35), remove the `${c.currency}` suffix — show the rate without a currency code (the amount renders via the CZK formatter).
- Replace `formatEarningsCzk(amount: number, currency: string)` (line 52) with a no-currency-arg version that formats CZK, and update the call at line 394 to drop `contract.currency`.

In `apps/desktop/src/components/timetracker/ProjectDetailPane.tsx`: remove the `${c.currency}` suffix from `formatRate` (line 67).

- [ ] **Step 8: Run the full gate**

Run:
```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
npx vitest run tests/orchestrator/contracts-repo.test.ts
npm test
```
Expected: orchestrator typecheck clean; contracts-repo green; full suite green except the 3 pre-existing `apps/ipad` Supabase-env file-load failures (`supabaseKey is required`).

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts \
  orchestrator/db/repositories/projectRates.ts orchestrator/index.ts \
  apps/desktop/src/components/timetracker/ContractDrawer.tsx \
  apps/desktop/src/components/timetracker/RateHistorySection.tsx \
  apps/desktop/src/components/timetracker/ProjectDetailPane.tsx \
  tests/orchestrator/contracts-repo.test.ts
git commit -m "refactor(#108): remove currency from contract write path (picker + repo input)"
```

---

## Task 2: Collapse the multi-currency aggregation to CZK scalars

Turns the per-currency earnings structures (`Record<string, number>`, per-currency rows, the alphabetical currency sort) into single CZK scalars across the reporting layer, the shared payloads, and the renderer charts/tiles. The DB `currency` column still exists but is no longer SELECTed.

**Files:**
- Modify: `packages/shared/src/ipcContract.ts`, `packages/shared/src/messagePort.ts`
- Modify: `orchestrator/db/reports.ts`, `orchestrator/db/reportsSql.ts`, `orchestrator/db/dashboardOverview.ts`, `orchestrator/db/taskGrid.ts`
- Modify: `apps/desktop/src/util/format.ts`
- Modify: `apps/desktop/src/components/dashboard/KpiTiles.tsx`, `.../timetracker/charts/TrendChart.tsx`, `.../charts/EarningsSummary.tsx`, `.../ReportsTab.tsx`, `.../TaskGridView.tsx`, `.../WorklogCellPopover.tsx`
- Test: `tests/orchestrator/reports.test.ts`, `dashboardOverview.test.ts`, `task-grid.test.ts`

**Interfaces:**
- Consumes: Task 1's currency-free contract types.
- Produces: the collapsed payload shapes below. Implementers of later tasks do not depend on these.

**Target shapes** (replace the `Record<string,number>` / `currency`-bearing versions):

```ts
// ipcContract.ts
export interface ByProjectMinutesPayload { /* line ~94 */
  minutes: number;
  mds: number;
  earned: number; // was earnedByCurrency: Record<string, number>
}
export interface ByProjectDatumPayload {
  projectId: number; projectName: string; projectColor: string;
  isBillable: number; minutes: number; mds: number;
  earnedAmount: number | null; // `currency` field deleted
}
export interface EarningsByProjectPayload {
  project_id: number; project_name: string; project_color: string;
  minutes: number; mds: number; earned_amount: number | null; // `currency` deleted
}
export interface EarningsResponsePayload {
  billableMinutes: number; unbillableMinutes: number; timeOffMinutes: number;
  billableMds: number; unbillableMds: number;
  totalEarned: number;             // was Record<string, number>
  avgEffectiveHourlyRate: number;  // was Record<string, number>
  byProject: EarningsByProjectPayload[];
}
export interface DashboardActiveContractPayload {
  projectId: number; projectName: string; projectColor: string;
  contract: ContractReportRowPayload['contract']; // `currency` deleted
}
// DashboardOverviewResponsePayload: today.earned / month.earned / sprint.totalEarned → number
// ContractReportRowPayload + RateChangeMarkerPayload + TaskGridEarningsRowPayload: delete `currency`
```

Mirror every one of these in `packages/shared/src/messagePort.ts` (`OrchByProjectDatum`, `OrchEarningsByProject`, `OrchRateChangeMarker`, `OrchTaskGridEarningsRow`, and the dashboard-overview `earned`/`totalEarned` fields).

- [ ] **Step 1: Rewrite the orchestrator reporting tests to CZK-only**

In `tests/orchestrator/reports.test.ts`: drop `currency` from contract fixtures; change `totalEarned`/`avgEffectiveHourlyRate` assertions from `{ CZK: N }` to scalar `N`; drop `currency` from `byProject` rows.
In `tests/orchestrator/dashboardOverview.test.ts`: delete all `currency: 'EUR'` fixtures (keep CZK-equivalent), change `earned`/`totalEarned` assertions to scalars, drop `currency` from active-contract assertions.
In `tests/orchestrator/task-grid.test.ts`: delete the multi-currency (EUR/USD) earnings tests and the alphabetical-currency-sort test; keep a single CZK earnings test asserting one expected/total amount (no per-currency rows).

- [ ] **Step 2: Run them — verify failure**

Run: `npx vitest run tests/orchestrator/reports.test.ts tests/orchestrator/dashboardOverview.test.ts tests/orchestrator/task-grid.test.ts`
Expected: FAIL (implementation still returns `Record`/per-currency rows).

- [ ] **Step 3: Collapse the reporting SQL + aggregation**

In `orchestrator/db/reports.ts`: remove the `currency` SELECT columns (132, 186, 268, 292, 422, 435), the `GROUP BY … currency` clauses (148, 280), and the per-currency bucketing (160, 313, 315). Build `total_earned`/`avg_effective_hourly_rate` as scalars summed across all (CZK) rows. Drop `currency` from the row interfaces and results (28, 39, 80, 153, 215, 226, 450, 459).
In `orchestrator/db/reportsSql.ts`: remove `pr.currency,` from the SELECT (line 40).
In `orchestrator/db/dashboardOverview.ts`: remove the `currency` sub-select (99–104) and the `currency` field (92, 126); make `earned`/`totalEarned` scalar sums.
In `orchestrator/db/taskGrid.ts`: remove the `byCurrency`/`expectedByCurrency` maps and the `out.sort(...localeCompare)` (lines 348–397); compute a single `expectedAmount`/`totalAmount`; drop `currency` from `TaskGridEarningsRow` (30, 103, 390).

- [ ] **Step 4: Update the shared payload types**

Apply the Target shapes above to `ipcContract.ts` and `messagePort.ts`.

- [ ] **Step 5: Run orchestrator gate**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npx vitest run tests/orchestrator/reports.test.ts tests/orchestrator/dashboardOverview.test.ts tests/orchestrator/task-grid.test.ts`
Expected: typecheck clean, the three suites green.

- [ ] **Step 6: Hardcode CZK in the formatter**

In `apps/desktop/src/util/format.ts`, change `formatEarnings` (line 60) to drop the `currency` param:

```ts
export function formatEarnings(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  try {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      style: 'currency',
      currency: 'CZK',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} Kč`;
  }
}
```

- [ ] **Step 7: Collapse the renderer consumers**

Update each to the scalar shape (remove per-currency loops/keys, drop the `currency` arg from `formatEarnings`/`formatAmount`):
- `KpiTiles.tsx` (61–69): render the single `earned` number, no `earnedEntries.map`.
- `charts/TrendChart.tsx` (20, 90): `earned: number` instead of `earned_by_currency` loop.
- `charts/EarningsSummary.tsx` (26, 160): drop `currency`; `formatEarnings(d.earned_amount)`.
- `ReportsTab.tsx` (134, 148, 173, 178, 184): drop `currency` from chart labels/series; filter only on `earned_amount != null`.
- `TaskGridView.tsx` (104–1109): `formatAmount(amount)` no currency; render one earnings row (no `key={row.currency}`, no `Earned ({row.currency})`).
- `WorklogCellPopover.tsx` (437): `formatEarnings(earned)`.

- [ ] **Step 8: Renderer typecheck + full suite**

Run: `npx tsc -p apps/desktop/tsconfig.json ; npm test`
Expected: no new currency-typed errors (pre-existing drift OK); full suite green except the 3 pre-existing ipad-env failures.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src orchestrator/db apps/desktop/src tests/orchestrator/reports.test.ts tests/orchestrator/dashboardOverview.test.ts tests/orchestrator/task-grid.test.ts
git commit -m "refactor(#108): collapse multi-currency earnings to CZK scalars"
```

---

## Task 3: Remove rate_currency (sync deriver + schema + iPad)

Removes the `rate_currency` derived column from the sync schema, deriver, and billing types, plus `currency` from the synced `projects`/`contracts` column lists, and updates the iPad Supabase selects. The PG `rate_currency`/`currency` columns still physically exist (dropped in Task 4) but are no longer written or read.

**Files:**
- Modify: `orchestrator/db/worklogBilling.ts`
- Modify: `orchestrator/sync/derive.ts`
- Modify: `orchestrator/sync/schema.ts`
- Modify: `packages/shared/src/billing/types.ts`
- Modify: `apps/ipad/src/state/useBilling.ts`, `apps/ipad/src/state/billingCache.ts`
- Test: `tests/orchestrator/worklogBilling.test.ts`, `sync/derive.test.ts`, `sync/schema.test.ts`, `sync/pull.test.ts`, `sync/push.test.ts`, `tests/ipad/billingCache.test.ts`, `tests/ipad/projectDetailHelpers.test.ts`

**Interfaces:**
- Consumes: nothing from Task 2.
- Produces: `WorklogBilling` without `rateCurrency`; the deriver output `{ effective_minutes, resolved_rate, earned_amount }` (no `rate_currency`); `SYNCED_TABLES` with no `currency`/`rate_currency`.

- [ ] **Step 1: Update the billing/derive/sync tests**

- `tests/orchestrator/worklogBilling.test.ts`: change the `hourly()`/`daily()` helpers to drop the `currency` arg/default (lines 4–7); remove `rateCurrency` from expected billing objects.
- `tests/orchestrator/sync/derive.test.ts`: drop `currency` from contract fixtures and remove `rate_currency` from expected deriver output (38, 59, 65, 80, 123, 139, 168).
- `tests/orchestrator/sync/schema.test.ts`: remove the assertion that `rate_currency` is in the derived-columns array (line 57); assert it is NOT present.
- `tests/orchestrator/sync/pull.test.ts` (115, 128) and `sync/push.test.ts` (the "derived billing columns land" test asserting `rate_currency='CZK'`, ~104/122/124/130): drop the `rate_currency` column from selects/assertions.
- `tests/ipad/billingCache.test.ts` (34, 102, 103, 110, 176) and `tests/ipad/projectDetailHelpers.test.ts` (21): drop `rate_currency`/`currency`.

- [ ] **Step 2: Run — verify failure**

Run: `npx vitest run tests/orchestrator/worklogBilling.test.ts tests/orchestrator/sync/derive.test.ts tests/orchestrator/sync/schema.test.ts`
Expected: FAIL (code still emits `rateCurrency`/`rate_currency`).

- [ ] **Step 3: Drop rateCurrency from billing**

In `orchestrator/db/worklogBilling.ts`: delete `currency: string;` from `ContractLite` (line 10) and `rateCurrency: string | null;` from `WorklogBilling` (line 17); remove `rateCurrency` from both returns (46, 52):

```ts
export interface WorklogBilling {
  effectiveMinutes: number;
  resolvedRate: number | null;
  earnedAmount: number | null;
}
// no-contract branch:
return { effectiveMinutes, resolvedRate: null, earnedAmount: null };
// resolved branch:
return { effectiveMinutes, resolvedRate: c.rateAmount, earnedAmount };
```

- [ ] **Step 4: Drop rate_currency/currency from the deriver**

In `orchestrator/sync/derive.ts`: remove `currency` from the contracts SELECT (line 37–38, it aliases into `ContractLite`) and delete `rate_currency: b.rateCurrency,` from the returned object (line 59).

- [ ] **Step 5: Drop currency/rate_currency from the sync schema**

In `orchestrator/sync/schema.ts`:
- `projects` columns: delete `{ name: 'currency', kind: 'text' }` (line 81).
- `contracts` columns: delete `{ name: 'currency', kind: 'text' }` (line 160).
- `worklogs` columns: delete `{ name: 'rate_currency', kind: 'text', derived: true }` (line 148).

- [ ] **Step 6: Drop currency from the shared billing types**

In `packages/shared/src/billing/types.ts`: delete `rateCurrency: string | null;` from `WorklogRow` (line 9) and `currency: string;` from `ContractRow` (line 25).

- [ ] **Step 7: Update the iPad selects**

In `apps/ipad/src/state/useBilling.ts`: remove `rate_currency,` (line 81) and `currency,` (line 88) from the Supabase `select` strings and `currency: r.currency,` from the `ContractRow` mapping (line 114).
In `apps/ipad/src/state/billingCache.ts`: remove `rate_currency,` from the embedded select doc-comment (line 30), `rate_currency: string | null;` from `RawWorklogRow` (line 50), and `rateCurrency: raw.rate_currency,` from `mapWorklogRow` (line 64).

- [ ] **Step 8: Run the gate**

Run:
```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
npx tsc -p apps/ipad/tsconfig.json
npm test
```
Expected: typechecks clean; full suite green except the 3 pre-existing ipad-env file-load failures. (Sync push/pull tests still run against PG — they must pass without `rate_currency`.)

- [ ] **Step 9: Commit**

```bash
git add orchestrator/db/worklogBilling.ts orchestrator/sync/derive.ts orchestrator/sync/schema.ts \
  packages/shared/src/billing/types.ts apps/ipad/src/state/useBilling.ts apps/ipad/src/state/billingCache.ts \
  tests/orchestrator/worklogBilling.test.ts tests/orchestrator/sync tests/ipad
git commit -m "refactor(#108): drop rate_currency derived column + currency from sync/iPad"
```

---

## Task 4: Drop the physical columns (migrations)

Physically drops `contracts.currency`, `projects.currency`, and `worklogs.rate_currency` now that nothing reads or writes them. Removes the repo's `'CZK'` INSERT bridge and the legacy importer's currency columns.

**Files:**
- Modify: `orchestrator/db/migrations.ts` (add SQLite v16)
- Modify: `orchestrator/db/pg/schema.ts` (add PG v5 + edit base DDL)
- Modify: `orchestrator/db/repositories/projectRates.ts` (remove the `'CZK'` bridge)
- Modify: `orchestrator/db/migrateTimetracker.ts` (drop `currency` from COLUMNS)
- Test: new test in `tests/orchestrator/migrations.test.ts` (or the existing migration test file); `tests/orchestrator/timetracker-migration.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (no remaining reads/writes of the columns).
- Produces: a schema with no currency columns. Fresh installs and upgrades both converge.

**Migration mechanics (read before writing):**
- **SQLite** has no `DROP COLUMN IF EXISTS`. A fresh DB runs the base `timetracker_schema.sql` (which still defines `currency`) then all migrations including v16, so v16's unconditional `DROP COLUMN` always has a column to drop. **Therefore: do NOT edit `timetracker_schema.sql` — leave `currency` in the base; v16 drops it for both fresh and existing DBs.**
- **Postgres** uses `CREATE TABLE IF NOT EXISTS` base strings + `DROP COLUMN IF EXISTS` in v5. **Therefore: DO edit the PG base strings** (remove `currency` from `PROJECTS`/`CONTRACTS`, remove the `rate_currency` line from `WORKLOGS_BILLING`) so fresh PG never creates them; v5's `DROP … IF EXISTS` is a harmless no-op on a fresh DB and the real drop on an existing one.

- [ ] **Step 1: Write the SQLite migration test**

In `tests/orchestrator/migrations.test.ts` (follow the existing node:sqlite style used by the sync tests — `new DatabaseSync`, `runMigrations`), add:

```ts
it('migration v16 drops the currency columns', () => {
  const db = freshSqlite(); // runs all migrations incl. v16
  const contractCols = (db.prepare(`PRAGMA table_info(contracts)`).all() as Array<{ name: string }>).map(c => c.name);
  const projectCols = (db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>).map(c => c.name);
  expect(contractCols).not.toContain('currency');
  expect(projectCols).not.toContain('currency');
});
```

(If `migrations.test.ts` does not exist, create it with the `freshSqlite` helper copied from `tests/orchestrator/sync/push.test.ts` lines 18–37.)

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run tests/orchestrator/migrations.test.ts -t "v16"`
Expected: FAIL — `currency` still present (v16 not written yet).

- [ ] **Step 3: Add SQLite migration v16**

In `orchestrator/db/migrations.ts`, append to the `MIGRATIONS` array (after v15, line 325):

```ts
  {
    version: 16,
    up: (db) => {
      // #108: standardize on CZK. Drop the now-unused currency columns.
      // No data migration: all existing contracts are CZK.
      db.exec(`ALTER TABLE contracts DROP COLUMN currency`);
      db.exec(`ALTER TABLE projects DROP COLUMN currency`);
    },
  },
```

> Fallback: if `DROP COLUMN` errors on either engine (an unexpected CHECK/index referencing `currency` — none found by grep), rebuild the table with the `*_new` RENAME pattern used by migrations v9 and v13 instead. Verify with the Step 1 test under node:sqlite.

- [ ] **Step 4: Run the SQLite migration test — verify pass**

Run: `npx vitest run tests/orchestrator/migrations.test.ts -t "v16"`
Expected: PASS.

- [ ] **Step 5: Remove the repo INSERT bridge**

In `orchestrator/db/repositories/projectRates.ts` `create()`: remove `currency` from the INSERT column list and the `'CZK'` value + its placeholder (revert the Task 1 bridge):

```ts
const info = this.db
  .prepare(
    `INSERT INTO contracts
       (project_id, effective_from, rate_type, rate_amount,
        hours_per_day, end_date, md_limit, sync_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  .run(
    input.projectId,
    input.effectiveFrom,
    input.rateType,
    input.rateAmount,
    input.hoursPerDay ?? 8,
    input.endDate ?? null,
    input.mdLimit ?? null,
    newSyncId(), nowIso(),
  ) as { lastInsertRowid: number | bigint };
```

- [ ] **Step 6: Add PG migration v5 + edit base DDL**

In `orchestrator/db/pg/schema.ts`:
- Remove `currency …` from the `PROJECTS` and `CONTRACTS` `CREATE TABLE` strings (base lines 30, 115).
- Remove the `ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS rate_currency TEXT;` line from `WORKLOGS_BILLING` (line 160).
- Append to `PG_MIGRATIONS` (after v4, line 203):

```ts
  {
    version: 5,
    up: [
      `ALTER TABLE contracts DROP COLUMN IF EXISTS currency;`,
      `ALTER TABLE projects DROP COLUMN IF EXISTS currency;`,
      `ALTER TABLE worklogs DROP COLUMN IF EXISTS rate_currency;`,
    ],
  },
```

- [ ] **Step 7: Drop currency from the legacy importer**

In `orchestrator/db/migrateTimetracker.ts`, remove `'currency',` from the `projects` COLUMNS list (line 76) and the `project_rates` COLUMNS list (line 87). The legacy source DB still has the column; the importer simply does not copy it into the (now currency-free) Watchtower schema.

- [ ] **Step 8: Verify the legacy-import test still passes**

In `tests/orchestrator/timetracker-migration.test.ts`, the source-fixture schema still declares `currency` (lines 50, 89, 121, 264, 268) — that is the *legacy source* and stays. Confirm the test passes now that the importer drops the column rather than carrying it into the destination. If any assertion checks a destination `currency`, remove it.

Run: `npx vitest run tests/orchestrator/timetracker-migration.test.ts`
Expected: PASS.

- [ ] **Step 9: Full gate**

Run:
```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
npm test
```
Expected: typecheck clean; full suite green except the 3 pre-existing ipad-env file-load failures. The PG sync tests recreate the schema (`DROP SCHEMA public CASCADE` + `runPgMigrations`) so they exercise v5.

- [ ] **Step 10: Commit**

```bash
git add orchestrator/db/migrations.ts orchestrator/db/pg/schema.ts \
  orchestrator/db/repositories/projectRates.ts orchestrator/db/migrateTimetracker.ts \
  tests/orchestrator/migrations.test.ts tests/orchestrator/timetracker-migration.test.ts
git commit -m "refactor(#108): drop currency + rate_currency columns (SQLite v16, PG v5)"
```

---

## Final verification (after all four tasks)

- [ ] `npx tsc -p orchestrator/tsconfig.json --noEmit` — clean.
- [ ] `npx tsc -p apps/desktop/tsconfig.json` and `npx tsc -p apps/ipad/tsconfig.json` — no new currency-typed errors.
- [ ] `npm test` — green except the 3 documented pre-existing `apps/ipad` Supabase-env file-load failures.
- [ ] `grep -rin "currency\|rate_currency\|EUR\|USD" orchestrator apps packages --include=*.ts --include=*.tsx` returns only intentional legacy-source references (timetracker_schema.sql / the TT source fixture). Everything else is gone.
- [ ] Manual smoke (optional, `npm run dev`): contract drawer has no currency picker; earnings render `1 234,56 Kč` (NBSP); a fresh DB has no `currency` column; the existing prod DB upgrades cleanly (v16 + PG v5 run once).

## Rollout caution

The desktop app runs `runPgMigrations` on startup, so the first updated desktop to launch drops the PG `currency`/`rate_currency` columns live. Deploy the updated iPad build (Task 3 selects) **at or before** the desktop release, or an older iPad build will 400 on the dropped columns.
