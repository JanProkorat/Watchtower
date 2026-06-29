# iPad Billing Write-back Slice 3b (Contract editing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a project's contracts (rate history) create/edit/delete-able from the iPad, with earnings recomputed locally for instant display and the Mac self-healing the authoritative worklog `earned_amount` via a new pull-side rebill hook.

**Architecture:** Online-direct Supabase writes (no offline outbox), LWW via `updated_at`, soft-delete — the slice-1/2/3a foundation. A contract change ripples to every affected worklog's earnings; this slice splits that: (1) the iPad recomputes the project's cached worklogs' `earnedAmount` in-memory via the shared `computeWorklogBilling` (cache-only, instant display); (2) a new Mac pull-side hook runs `markWorklogsForRebill` when it pulls a foreign contract change so the Mac's deriver re-persists authoritative values to Supabase. Client-side overlap validation is the only guard (overlap is not DB-enforced and the iPad bypasses the orchestrator check).

**Tech Stack:** TypeScript, React (plain, inline styles — no MUI), Supabase JS client, `@watchtower/shared` (built composite), Postgres RLS, Node SQLite + local Postgres for sync tests, vitest.

## Global Constraints

- **Online-direct writes only.** Edit controls disabled unless `useBilling` state is `fresh` (`canEdit(state)`). No offline outbox.
- **Soft-delete only.** Delete = `UPDATE ... SET deleted_at = now, updated_at = now`. Never a hard `DELETE`.
- **LWW via `updated_at`.** Every write stamps `updated_at = now` (ISO string).
- **iPad recomputes earnings cache-only** (never writes worklogs to Supabase); the **Mac self-heal** persists authoritative worklog values.
- **Client-side `contractsOverlap` is the only guard** for iPad contract writes — it must exactly match the orchestrator's sentinel (`9999-12-31`) semantics.
- **Writes key on `syncId`** (mint on create, `.eq('sync_id', …)` on edit/delete).
- **apps/ipad:** plain React + inline styles, no MUI; cs-CZ; no i18n; reuse `ProjectDetailView` + `C` tokens; errors inline via the hook's `error` + `C.red` (no `useToast`).
- **Pure logic unit-tested; Supabase client injected/never hit live; UI + hooks verified by typecheck.** The Mac pull-rebill hook is tested against a local Postgres (skips if unreachable, mirroring `tests/orchestrator/sync/pull.test.ts`).
- **`@watchtower/shared` is a built composite** — vitest resolves it from source; `npm run typecheck` builds it first then typechecks all 6 projects. Always verify with `npm run typecheck`.
- Verification: `npm test` (vitest, ~889+ baseline — add tests as code is added) and `npm run typecheck` (0 errors across all 6 projects).
- Never edit `.env*`. Branch: `feat/120-writeback-contracts` (already created).
- Source of truth: `docs/superpowers/specs/2026-06-29-ipad-writeback-s3b-contracts-design.md`.

---

## File Structure

- `packages/shared/src/billing/contracts-overlap.ts` — **new**, `contractsOverlap` predicate.
- `packages/shared/src/billing/date-helpers.ts` — **new**, `previousDay`.
- `packages/shared/src/billing/types.ts` — `ContractRow.syncId`.
- `apps/ipad/src/state/billingCache.ts` — `RawContractRow`/`mapContractRow` (extracted, + `syncId`).
- `apps/ipad/src/state/useBilling.ts` — contracts select+map via `mapContractRow`; `patchContracts` + `PATCH_CONTRACTS`.
- `apps/ipad/src/state/billingWrites.ts` — contract shapers + `applyContractWrite` + `buildOptimisticContractRow` + `rebillProjectWorklogs`.
- `apps/ipad/src/state/useContractMutations.ts` — **new**, client-wired hook.
- `apps/ipad/src/components/billing/ProjectDetailView.tsx` — editable rate history + `ContractDrawer`.
- `orchestrator/sync/pull.ts` — `touchedFkIds` on the pull result.
- `orchestrator/sync/service.ts` — post-pull contract rebill.
- `orchestrator/db/pg/schema.ts` — `PG_MIGRATIONS` v9 (contracts write policy).

---

## Task 1: Shared helpers — `contractsOverlap` + `previousDay`

**Files:**
- Create: `packages/shared/src/billing/contracts-overlap.ts`
- Create: `packages/shared/src/billing/date-helpers.ts`
- Test: `tests/shared/contractsOverlap.test.ts`, `tests/shared/previousDay.test.ts`

**Interfaces:**
- Produces: `contractsOverlap(aFrom: string, aEnd: string | null, bFrom: string, bEnd: string | null): boolean`; `previousDay(date: string): string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/contractsOverlap.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { contractsOverlap } from '@watchtower/shared/billing/contracts-overlap.js';

describe('contractsOverlap', () => {
  it('detects overlapping closed ranges', () => {
    expect(contractsOverlap('2026-01-01', '2026-06-30', '2026-06-01', '2026-12-31')).toBe(true);
  });
  it('treats exact-boundary touch as overlap (matches orchestrator sentinel predicate)', () => {
    expect(contractsOverlap('2026-01-01', '2026-06-30', '2026-06-30', '2026-12-31')).toBe(true);
  });
  it('non-overlapping adjacent ranges (prior ends day before) do not overlap', () => {
    expect(contractsOverlap('2026-01-01', '2026-05-31', '2026-06-01', null)).toBe(false);
  });
  it('open-ended existing overlaps any later range', () => {
    expect(contractsOverlap('2026-01-01', null, '2027-01-01', '2027-06-30')).toBe(true);
  });
  it('two open-ended ranges overlap', () => {
    expect(contractsOverlap('2026-01-01', null, '2026-06-01', null)).toBe(true);
  });
  it('new range entirely before existing does not overlap', () => {
    expect(contractsOverlap('2026-06-01', '2026-12-31', '2026-01-01', '2026-05-31')).toBe(false);
  });
});
```

Create `tests/shared/previousDay.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { previousDay } from '@watchtower/shared/billing/date-helpers.js';

describe('previousDay', () => {
  it('subtracts one day', () => {
    expect(previousDay('2026-06-15')).toBe('2026-06-14');
  });
  it('crosses a month boundary', () => {
    expect(previousDay('2026-06-01')).toBe('2026-05-31');
  });
  it('crosses a year boundary', () => {
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/shared/contractsOverlap.test.ts tests/shared/previousDay.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the helpers**

Create `packages/shared/src/billing/contracts-overlap.ts`:

```typescript
// Overlap predicate for two contract windows on the same project, mirroring the
// orchestrator's assertNoOverlap (orchestrator/db/repositories/projectRates.ts):
// a null end_date is open-ended (+infinity), represented by the sentinel.
const SENTINEL_END = '9999-12-31';

export function contractsOverlap(
  aFrom: string,
  aEnd: string | null,
  bFrom: string,
  bEnd: string | null,
): boolean {
  return aFrom <= (bEnd ?? SENTINEL_END) && (aEnd ?? SENTINEL_END) >= bFrom;
}
```

Create `packages/shared/src/billing/date-helpers.ts`:

```typescript
/**
 * YYYY-MM-DD → previous calendar day, YYYY-MM-DD. Built in UTC so a local
 * timezone never shifts the date (cf. the sync DATE round-trip bug).
 */
export function previousDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/shared/contractsOverlap.test.ts tests/shared/previousDay.test.ts`
Expected: PASS (9 tests).

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/billing/contracts-overlap.ts packages/shared/src/billing/date-helpers.ts tests/shared/contractsOverlap.test.ts tests/shared/previousDay.test.ts
git commit -m "feat(shared): contractsOverlap predicate + previousDay helper for contract write-back"
```

---

## Task 2: Read addition — `ContractRow.syncId` + `mapContractRow`

**Files:**
- Modify: `packages/shared/src/billing/types.ts`
- Modify: `apps/ipad/src/state/billingCache.ts`
- Modify: `apps/ipad/src/state/useBilling.ts:120,132-143`
- Test: `tests/ipad/billingCache.test.ts`

**Interfaces:**
- Produces: `ContractRow` gains `syncId: string`; `mapContractRow(raw: RawContractRow): ContractRow` exported from `billingCache.ts`.

- [ ] **Step 1: Write the failing test**

Add to `tests/ipad/billingCache.test.ts`:

```typescript
import { mapContractRow } from '../../apps/ipad/src/state/billingCache.js';
import type { RawContractRow } from '../../apps/ipad/src/state/billingCache.js';

describe('mapContractRow', () => {
  it('maps a raw contract row incl. syncId, nullable end_date/md_limit', () => {
    const raw: RawContractRow = {
      sync_id: 'c1', project_id: 3, effective_from: '2026-01-01', end_date: null,
      rate_type: 'hourly', rate_amount: 100, hours_per_day: 8, md_limit: null,
    };
    expect(mapContractRow(raw)).toEqual({
      syncId: 'c1', projectId: 3, effectiveFrom: '2026-01-01', endDate: null,
      rateType: 'hourly', rateAmount: 100, hoursPerDay: 8, mdLimit: null,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ipad/billingCache.test.ts`
Expected: FAIL — `mapContractRow`/`RawContractRow` not exported.

- [ ] **Step 3: Add `syncId` to `ContractRow`**

In `packages/shared/src/billing/types.ts`, replace the `ContractRow` interface with:

```typescript
export interface ContractRow {
  syncId: string;
  projectId: number;
  effectiveFrom: string;     // YYYY-MM-DD
  endDate: string | null;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay: number;
  mdLimit: number | null;
}
```

- [ ] **Step 4: Extract `mapContractRow` into billingCache**

In `apps/ipad/src/state/billingCache.ts`, after `mapDayOffRow`, add:

```typescript
export type RawContractRow = {
  sync_id: string;
  project_id: number;
  effective_from: string;
  end_date: string | null;
  rate_type: 'hourly' | 'daily';
  rate_amount: number;
  hours_per_day: number;
  md_limit: number | null;
};

export function mapContractRow(raw: RawContractRow): ContractRow {
  return {
    syncId: raw.sync_id,
    projectId: raw.project_id,
    effectiveFrom: raw.effective_from,
    endDate: raw.end_date ?? null,
    rateType: raw.rate_type,
    rateAmount: raw.rate_amount,
    hoursPerDay: raw.hours_per_day,
    mdLimit: raw.md_limit ?? null,
  };
}
```

`ContractRow` is already imported at the top of `billingCache.ts`; if not, add it to the `import type { … } from '@watchtower/shared/billing/types.js'` line.

- [ ] **Step 5: Use `mapContractRow` in useBilling + add `sync_id` to the select**

In `apps/ipad/src/state/useBilling.ts`:

1. Add `sync_id` to the contracts select (line ~120):
```typescript
    /* contracts */ supabase.from('contracts').select('sync_id,project_id,effective_from,end_date,rate_type,rate_amount,hours_per_day,md_limit').is('deleted_at', null),
```
2. Import `mapContractRow`/`RawContractRow` from `./billingCache.js` (add to the existing import block).
3. Replace the inline contracts map (the `(contractsResult.data ?? []).map(...)` block) with:
```typescript
  const contracts: ContractRow[] = (contractsResult.data ?? []).map((r) => mapContractRow(r as RawContractRow));
```

- [ ] **Step 6: Run tests + typecheck; fix broken ContractRow literals**

Run: `npx vitest run tests/ipad/billingCache.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: errors in any test that constructs a `ContractRow` literal (now needs `syncId`). Search `grep -rn "rateType:" tests/` and add `syncId: 'c-test'` (or similar) to each `ContractRow` literal (e.g. in `tests/ipad/billingWrites.test.ts`'s slice-2 contract fixtures). Re-run until `npm run typecheck` → 0 errors and `npx vitest run tests/ipad/` is green.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/billing/types.ts apps/ipad/src/state/billingCache.ts apps/ipad/src/state/useBilling.ts tests/
git commit -m "feat(ipad): ContractRow.syncId + mapContractRow for contract write-back"
```

---

## Task 3: `patchContracts` optimistic cache patch

**Files:**
- Modify: `apps/ipad/src/state/useBilling.ts`
- Test: `tests/ipad/useBilling.test.ts`

**Interfaces:**
- Produces: `BillingAction` gains `{ type: 'PATCH_CONTRACTS'; contracts: ContractRow[] }`; `BillingHookResult` gains `patchContracts(next: ContractRow[]): void`.

- [ ] **Step 1: Write the failing test**

Add to `tests/ipad/useBilling.test.ts`:

```typescript
import type { ContractRow } from '@watchtower/shared/billing/types.js';

describe('billingReducer — PATCH_CONTRACTS', () => {
  const ct = (syncId: string): ContractRow => ({
    syncId, projectId: 1, effectiveFrom: '2026-01-01', endDate: null,
    rateType: 'hourly', rateAmount: 100, hoursPerDay: 8, mdLimit: null,
  });
  it('swaps contracts in the existing dataset', () => {
    const start = { data: { worklogs: [], contracts: [ct('a')], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: 'x' }, state: 'fresh' as const, lastUpdated: 'x' };
    const next = billingReducer(start, { type: 'PATCH_CONTRACTS', contracts: [ct('a'), ct('b')] });
    expect(next.data?.contracts.map((c) => c.syncId)).toEqual(['a', 'b']);
  });
  it('is a no-op when there is no data', () => {
    const start = { data: null, state: 'offline' as const, lastUpdated: null };
    expect(billingReducer(start, { type: 'PATCH_CONTRACTS', contracts: [ct('a')] })).toBe(start);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ipad/useBilling.test.ts`
Expected: FAIL — `PATCH_CONTRACTS` not in the action union.

- [ ] **Step 3: Implement the reducer action + hook method**

In `apps/ipad/src/state/useBilling.ts`:

1. Extend `BillingHookResult` (after `patchTasks`):
```typescript
  patchContracts(next: ContractRow[]): void;
```
2. Extend `BillingAction`:
```typescript
  | { type: 'PATCH_TASKS'; tasks: TaskRow[] }
  | { type: 'PATCH_CONTRACTS'; contracts: ContractRow[] };
```
3. Add the reducer case (next to `PATCH_TASKS`):
```typescript
    case 'PATCH_CONTRACTS':
      return prev.data ? { ...prev, data: { ...prev.data, contracts: action.contracts } } : prev;
```
4. Add the callback and return it:
```typescript
  const patchContracts = useCallback((next: ContractRow[]) => dispatch({ type: 'PATCH_CONTRACTS', contracts: next }), [dispatch]);
```
```typescript
    patchTasks,
    patchContracts,
  };
```
(`ContractRow` is already imported in useBilling.ts.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/ipad/useBilling.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/useBilling.ts tests/ipad/useBilling.test.ts
git commit -m "feat(ipad): patchContracts optimistic cache patch"
```

---

## Task 4: Postgres write RLS — `PG_MIGRATIONS` v9 (contracts)

**Files:**
- Modify: `orchestrator/db/pg/schema.ts`
- Test: `tests/orchestrator/pgMigrations.writeback.test.ts`

**Interfaces:**
- Produces: a `{ version: 9, up: [...] }` entry creating a guarded `write_authenticated` `FOR ALL` policy on `contracts`.

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator/pgMigrations.writeback.test.ts`:

```typescript
describe('PG_MIGRATIONS v9 — contracts write policy', () => {
  it('adds a version-9 migration', () => {
    expect(PG_MIGRATIONS.find((m) => m.version === 9)).toBeDefined();
  });
  it('creates a guarded write_authenticated policy for contracts (FOR ALL)', () => {
    const sql = PG_MIGRATIONS.find((m) => m.version === 9)!.up.join('\n');
    expect(sql).toContain('contracts');
    expect(sql).toContain('write_authenticated');
    expect(sql).toContain('FOR ALL TO authenticated');
    expect(sql).toContain('DROP POLICY IF EXISTS write_authenticated ON contracts');
    expect(sql).toContain("rolname = 'authenticated'");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/orchestrator/pgMigrations.writeback.test.ts`
Expected: FAIL — v9 not found.

- [ ] **Step 3: Append v9 to `PG_MIGRATIONS`**

In `orchestrator/db/pg/schema.ts`, after the v8 object (before the closing `];`):

```typescript
  {
    version: 9,
    up: [
      // Write-back slice 3b: allow authenticated INSERT/UPDATE on contracts (soft-delete
      // is an UPDATE; auto-closing the prior contract is an UPDATE). Mirrors v6/v7/v8:
      // idempotent + role-guarded so plain Postgres (dev/test, no `authenticated` role)
      // still applies cleanly.
      `ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_authenticated ON contracts;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON contracts FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;`,
    ],
  },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/orchestrator/pgMigrations.writeback.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/pg/schema.ts tests/orchestrator/pgMigrations.writeback.test.ts
git commit -m "feat(sync): PG_MIGRATIONS v9 — contracts write RLS policy"
```

---

## Task 5: Contract write shapers + `applyContractWrite` + `rebillProjectWorklogs`

**Files:**
- Modify: `apps/ipad/src/state/billingWrites.ts`
- Test: `tests/ipad/billingWrites.test.ts`

**Interfaces:**
- Consumes: `ContractRow`, `WorklogRow` (shared); `computeDerivedForWrite` (slice-2, already in this file).
- Produces:
  - `interface ContractWriteInput { projectId: number; effectiveFrom: string; endDate: string | null; rateType: 'hourly' | 'daily'; rateAmount: number; hoursPerDay: number; mdLimit: number | null }`
  - `buildContractInsert(input, opts: { syncId: string; now: string }): ContractInsertRow`
  - `buildContractUpdate(input, opts: { now: string }): ContractUpdateRow`
  - `buildContractEndDateUpdate(endDate: string, now: string): { end_date: string; updated_at: string }`
  - `buildContractDelete(now: string): { deleted_at: string; updated_at: string }`
  - `buildOptimisticContractRow(input: ContractWriteInput, syncId: string): ContractRow`
  - `applyContractWrite(contracts: ContractRow[], change: ContractChange): ContractRow[]` where `ContractChange = { type: 'upsert'; row: ContractRow } | { type: 'remove'; syncId: string }`
  - `rebillProjectWorklogs(worklogs: WorklogRow[], projectId: number, contracts: ContractRow[]): WorklogRow[]`

- [ ] **Step 1: Write the failing tests**

Add to `tests/ipad/billingWrites.test.ts`:

```typescript
import {
  buildContractInsert, buildContractUpdate, buildContractEndDateUpdate, buildContractDelete,
  buildOptimisticContractRow, applyContractWrite, rebillProjectWorklogs,
} from '../../apps/ipad/src/state/billingWrites.js';
import type { ContractRow as ContractRowT, WorklogRow as WorklogRowT } from '@watchtower/shared/billing/types.js';

const cInput = { projectId: 3, effectiveFrom: '2026-01-01', endDate: null, rateType: 'hourly' as const, rateAmount: 100, hoursPerDay: 8, mdLimit: null };

describe('buildContractInsert', () => {
  it('shapes a full insert row (sync_id, project_id, tombstone clear, stamped updated_at)', () => {
    expect(buildContractInsert(cInput, { syncId: 'c1', now: '2026-06-29T10:00:00.000Z' })).toEqual({
      sync_id: 'c1', project_id: 3, effective_from: '2026-01-01', rate_type: 'hourly',
      rate_amount: 100, hours_per_day: 8, end_date: null, md_limit: null,
      deleted_at: null, updated_at: '2026-06-29T10:00:00.000Z',
    });
  });
});

describe('buildContractUpdate', () => {
  it('shapes an update row WITHOUT sync_id/project_id', () => {
    const row = buildContractUpdate({ ...cInput, rateAmount: 150 }, { now: '2026-06-29T10:00:00.000Z' });
    expect(row).not.toHaveProperty('sync_id');
    expect(row).not.toHaveProperty('project_id');
    expect(row).toEqual({
      effective_from: '2026-01-01', rate_type: 'hourly', rate_amount: 150, hours_per_day: 8,
      end_date: null, md_limit: null, updated_at: '2026-06-29T10:00:00.000Z',
    });
  });
});

describe('buildContractEndDateUpdate', () => {
  it('shapes the auto-close write', () => {
    expect(buildContractEndDateUpdate('2025-12-31', '2026-06-29T10:00:00.000Z')).toEqual({ end_date: '2025-12-31', updated_at: '2026-06-29T10:00:00.000Z' });
  });
});

describe('buildContractDelete', () => {
  it('soft-deletes', () => {
    expect(buildContractDelete('2026-06-29T10:00:00.000Z')).toEqual({ deleted_at: '2026-06-29T10:00:00.000Z', updated_at: '2026-06-29T10:00:00.000Z' });
  });
});

describe('buildOptimisticContractRow', () => {
  it('builds a ContractRow from input + syncId', () => {
    expect(buildOptimisticContractRow(cInput, 'c1')).toEqual({
      syncId: 'c1', projectId: 3, effectiveFrom: '2026-01-01', endDate: null,
      rateType: 'hourly', rateAmount: 100, hoursPerDay: 8, mdLimit: null,
    });
  });
});

describe('applyContractWrite', () => {
  const base: ContractRowT = buildOptimisticContractRow(cInput, 'c1');
  it('upsert replaces by syncId', () => {
    const edited = { ...base, rateAmount: 150 };
    expect(applyContractWrite([base], { type: 'upsert', row: edited })).toEqual([edited]);
  });
  it('remove filters by syncId', () => {
    expect(applyContractWrite([base], { type: 'remove', syncId: 'c1' })).toEqual([]);
  });
});

describe('rebillProjectWorklogs', () => {
  const wl = (syncId: string, projectId: number): WorklogRowT => ({
    syncId, workDate: '2026-06-01', minutes: 60, reportedMinutes: null, effectiveMinutes: 60,
    earnedAmount: 0, description: null, projectId, projectName: 'P', projectColor: null,
    projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null, source: 'manual',
  });
  const contract: ContractRowT = buildOptimisticContractRow(cInput, 'c1'); // hourly 100 from 2026-01-01
  it('recomputes earnedAmount only for the project worklogs', () => {
    const result = rebillProjectWorklogs([wl('a', 3), wl('b', 9)], 3, [contract]);
    const a = result.find((w) => w.syncId === 'a')!;
    const b = result.find((w) => w.syncId === 'b')!;
    expect(a.earnedAmount).toBeCloseTo(100); // 60min * 100/60
    expect(b.earnedAmount).toBe(0);          // untouched (different project)
  });
  it('null earnedAmount when no contract covers the project', () => {
    const result = rebillProjectWorklogs([wl('a', 3)], 3, []);
    expect(result[0].earnedAmount).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ipad/billingWrites.test.ts`
Expected: FAIL — new exports don't exist.

- [ ] **Step 3: Implement the shapers + helpers**

Append to `apps/ipad/src/state/billingWrites.ts`. (`ContractRow`, `WorklogRow` are already imported; `computeDerivedForWrite` is already defined in this file from slice 2.)

```typescript
// --- Contract write-back (slice 3b) ---------------------------------------

export interface ContractWriteInput {
  projectId: number;
  effectiveFrom: string;
  endDate: string | null;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay: number;
  mdLimit: number | null;
}

export interface ContractInsertRow {
  sync_id: string;
  project_id: number;
  effective_from: string;
  rate_type: 'hourly' | 'daily';
  rate_amount: number;
  hours_per_day: number;
  end_date: string | null;
  md_limit: number | null;
  deleted_at: null;
  updated_at: string;
}

export interface ContractUpdateRow {
  effective_from: string;
  rate_type: 'hourly' | 'daily';
  rate_amount: number;
  hours_per_day: number;
  end_date: string | null;
  md_limit: number | null;
  updated_at: string;
}

export function buildContractInsert(input: ContractWriteInput, opts: { syncId: string; now: string }): ContractInsertRow {
  return {
    sync_id: opts.syncId,
    project_id: input.projectId,
    effective_from: input.effectiveFrom,
    rate_type: input.rateType,
    rate_amount: input.rateAmount,
    hours_per_day: input.hoursPerDay,
    end_date: input.endDate,
    md_limit: input.mdLimit,
    deleted_at: null,
    updated_at: opts.now,
  };
}

export function buildContractUpdate(input: ContractWriteInput, opts: { now: string }): ContractUpdateRow {
  return {
    effective_from: input.effectiveFrom,
    rate_type: input.rateType,
    rate_amount: input.rateAmount,
    hours_per_day: input.hoursPerDay,
    end_date: input.endDate,
    md_limit: input.mdLimit,
    updated_at: opts.now,
  };
}

export function buildContractEndDateUpdate(endDate: string, now: string): { end_date: string; updated_at: string } {
  return { end_date: endDate, updated_at: now };
}

export function buildContractDelete(now: string): { deleted_at: string; updated_at: string } {
  return { deleted_at: now, updated_at: now };
}

export function buildOptimisticContractRow(input: ContractWriteInput, syncId: string): ContractRow {
  return {
    syncId,
    projectId: input.projectId,
    effectiveFrom: input.effectiveFrom,
    endDate: input.endDate,
    rateType: input.rateType,
    rateAmount: input.rateAmount,
    hoursPerDay: input.hoursPerDay,
    mdLimit: input.mdLimit,
  };
}

export type ContractChange =
  | { type: 'upsert'; row: ContractRow }
  | { type: 'remove'; syncId: string };

export function applyContractWrite(contracts: ContractRow[], change: ContractChange): ContractRow[] {
  if (change.type === 'remove') {
    return contracts.filter((c) => c.syncId !== change.syncId);
  }
  const without = contracts.filter((c) => c.syncId !== change.row.syncId);
  return [...without, change.row];
}

/**
 * Recompute effectiveMinutes/earnedAmount for the given project's worklogs using
 * the provided contract set (cache-only display rebill). Other projects' worklogs
 * pass through unchanged. Mirrors the Mac deriver via the shared formula.
 */
export function rebillProjectWorklogs(worklogs: WorklogRow[], projectId: number, contracts: ContractRow[]): WorklogRow[] {
  return worklogs.map((w) => {
    if (w.projectId !== projectId) return w;
    const billing = computeDerivedForWrite(contracts, projectId, {
      minutes: w.minutes,
      reportedMinutes: w.reportedMinutes,
      workDate: w.workDate,
    });
    return { ...w, effectiveMinutes: billing.effectiveMinutes, earnedAmount: billing.earnedAmount };
  });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/ipad/billingWrites.test.ts`
Expected: PASS (new + existing cases).

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/billingWrites.ts tests/ipad/billingWrites.test.ts
git commit -m "feat(ipad): contract write shapers + applyContractWrite + local rebillProjectWorklogs"
```

---

## Task 6: `useContractMutations` client-wired hook

**Files:**
- Create: `apps/ipad/src/state/useContractMutations.ts`

**Interfaces:**
- Consumes: `getSupabase`; Task-1 `contractsOverlap`/`previousDay`; Task-5 shapers/helpers; `ContractRow`, `WorklogRow`, `ContractWriteInput`.
- Produces: `useContractMutations({ contracts, worklogs, patchContracts, patchWorklogs }): { createContract(input), updateContract(syncId, input), deleteContract(syncId), pending: string | null, error: string | null }`.

This hook is verified by `npm run typecheck` (the Supabase client isn't exercised in vitest, matching `useWorklogMutations`/`useTaskMutations`).

- [ ] **Step 1: Create the hook**

Create `apps/ipad/src/state/useContractMutations.ts`:

```typescript
import { useState, useCallback } from 'react';
import { getSupabase } from '../lib/supabaseClient.js';
import { contractsOverlap } from '@watchtower/shared/billing/contracts-overlap.js';
import { previousDay } from '@watchtower/shared/billing/date-helpers.js';
import type { ContractRow, WorklogRow } from '@watchtower/shared/billing/types.js';
import {
  buildContractInsert,
  buildContractUpdate,
  buildContractEndDateUpdate,
  buildContractDelete,
  buildOptimisticContractRow,
  applyContractWrite,
  rebillProjectWorklogs,
  type ContractWriteInput,
} from './billingWrites.js';

interface Args {
  contracts: ContractRow[];
  worklogs: WorklogRow[];
  patchContracts(next: ContractRow[]): void;
  patchWorklogs(next: WorklogRow[]): void;
}

export function useContractMutations({ contracts, worklogs, patchContracts, patchWorklogs }: Args) {
  const [pending, setPending] = useState<string | null>(null); // syncId being written
  const [error, setError] = useState<string | null>(null);

  // First overlapping contract on the same project (excluding `excludeSyncId`), or null.
  const findOverlap = useCallback(
    (input: ContractWriteInput, excludeSyncId: string | null): ContractRow | null => {
      return (
        contracts.find(
          (c) =>
            c.projectId === input.projectId &&
            c.syncId !== excludeSyncId &&
            contractsOverlap(c.effectiveFrom, c.endDate, input.effectiveFrom, input.endDate),
        ) ?? null
      );
    },
    [contracts],
  );

  // Apply contract change + cache rebill of the project's worklogs, optimistically.
  const applyOptimistic = useCallback(
    (nextContracts: ContractRow[], projectId: number) => {
      patchContracts(nextContracts);
      patchWorklogs(rebillProjectWorklogs(worklogs, projectId, nextContracts));
    },
    [worklogs, patchContracts, patchWorklogs],
  );

  const overlapMsg = (c: ContractRow) =>
    `Sazba se překrývá s obdobím od ${c.effectiveFrom}${c.endDate ? ` do ${c.endDate}` : ''}`;

  const createContract = useCallback(
    async (input: ContractWriteInput) => {
      const prevC = contracts;
      const prevW = worklogs;
      const conflict = findOverlap(input, null);
      if (conflict) { setError(overlapMsg(conflict)); return; }
      const syncId = crypto.randomUUID();
      const now = new Date().toISOString();
      // Auto-close a prior open-ended contract on the same project starting earlier.
      const prior = contracts.find(
        (c) => c.projectId === input.projectId && c.endDate === null && c.effectiveFrom < input.effectiveFrom,
      );
      let nextContracts = contracts;
      if (prior) {
        nextContracts = applyContractWrite(nextContracts, { type: 'upsert', row: { ...prior, endDate: previousDay(input.effectiveFrom) } });
      }
      nextContracts = applyContractWrite(nextContracts, { type: 'upsert', row: buildOptimisticContractRow(input, syncId) });
      setError(null);
      setPending(syncId);
      applyOptimistic(nextContracts, input.projectId);
      try {
        if (prior) {
          const { error: e1 } = await getSupabase().from('contracts').update(buildContractEndDateUpdate(previousDay(input.effectiveFrom), now)).eq('sync_id', prior.syncId);
          if (e1) throw e1;
        }
        const { error: e2 } = await getSupabase().from('contracts').insert(buildContractInsert(input, { syncId, now }));
        if (e2) throw e2;
      } catch (err) {
        patchContracts(prevC);
        patchWorklogs(prevW);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [contracts, worklogs, findOverlap, applyOptimistic, patchContracts, patchWorklogs],
  );

  const updateContract = useCallback(
    async (syncId: string, input: ContractWriteInput) => {
      const prevC = contracts;
      const prevW = worklogs;
      const conflict = findOverlap(input, syncId);
      if (conflict) { setError(overlapMsg(conflict)); return; }
      const now = new Date().toISOString();
      const nextContracts = applyContractWrite(contracts, { type: 'upsert', row: buildOptimisticContractRow(input, syncId) });
      setError(null);
      setPending(syncId);
      applyOptimistic(nextContracts, input.projectId);
      try {
        const { error: e } = await getSupabase().from('contracts').update(buildContractUpdate(input, { now })).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchContracts(prevC);
        patchWorklogs(prevW);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [contracts, worklogs, findOverlap, applyOptimistic, patchContracts, patchWorklogs],
  );

  const deleteContract = useCallback(
    async (syncId: string) => {
      const prevC = contracts;
      const prevW = worklogs;
      const existing = prevC.find((c) => c.syncId === syncId);
      if (!existing) return;
      const now = new Date().toISOString();
      const nextContracts = applyContractWrite(contracts, { type: 'remove', syncId });
      setError(null);
      setPending(syncId);
      applyOptimistic(nextContracts, existing.projectId);
      try {
        const { error: e } = await getSupabase().from('contracts').update(buildContractDelete(now)).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchContracts(prevC);
        patchWorklogs(prevW);
        setError(err instanceof Error ? err.message : 'Smazání selhalo');
      } finally {
        setPending(null);
      }
    },
    [contracts, worklogs, applyOptimistic, patchContracts, patchWorklogs],
  );

  return { createContract, updateContract, deleteContract, pending, error };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/state/useContractMutations.ts
git commit -m "feat(ipad): useContractMutations create/edit/delete hook (overlap guard + auto-close + local rebill)"
```

---

## Task 7: Mac self-heal — pull-side rebill hook

**Files:**
- Modify: `orchestrator/sync/pull.ts`
- Modify: `orchestrator/sync/service.ts`
- Test: `tests/orchestrator/sync/pull.test.ts`

**Interfaces:**
- Consumes: `markWorklogsForRebill(db, projectId, fromDate, nowIso)` (`orchestrator/db/rebill.ts`).
- Produces: `pullTable`/`pullAll` results gain `touchedFkIds: number[]` (resolved local FK ids of upserted rows; for `contracts` these are project ids).

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator/sync/pull.test.ts` (inside the `describe('pullAll', …)` block, mirroring the existing harness — requires a reachable local Postgres, else it returns early like the others):

```typescript
  it('rebills a project\'s worklogs when a foreign contract change is pulled', async () => {
    if (!reachable || !store) return;
    const db = freshSqlite();
    // Local project → epic → task → worklog, pushed to Postgres.
    const proj = new ProjectsRepo(db).create({ name: 'Rebill P' });
    const epic = new EpicsRepo(db).create({ projectId: proj.id, name: 'E' });
    const task = new TasksRepo(db).create({ epicId: epic.id, number: 'R-1', title: 'T' });
    new WorklogsRepo(db).create({ taskId: task.id, workDate: '2026-06-01', minutes: 60 });
    await pushAll(db, store);
    const projSyncId = (db.prepare(`SELECT sync_id FROM projects WHERE id=?`).get(proj.id) as any).sync_id;
    const wlBefore = db.prepare(`SELECT updated_at FROM worklogs LIMIT 1`).get() as any;

    // A foreign contract appears in Postgres (newer than the pull cursor).
    await store.query(
      `INSERT INTO contracts (sync_id, project_id, effective_from, rate_type, rate_amount, hours_per_day, updated_at)
       VALUES ('remote-contract-1', (SELECT id FROM projects WHERE sync_id=$1), '2026-01-01', 'hourly', 100, 8, now() + interval '1 minute')`,
      [projSyncId],
    );

    const res = await pullAll(db, store);
    expect(res.contracts.pulled).toBe(1);
    expect(res.contracts.touchedFkIds).toContain(proj.id);
    const wlAfter = db.prepare(`SELECT updated_at FROM worklogs LIMIT 1`).get() as any;
    expect(wlAfter.updated_at > wlBefore.updated_at).toBe(true); // markWorklogsForRebill bumped it
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/orchestrator/sync/pull.test.ts`
Expected: FAIL (if PG reachable) — `touchedFkIds` undefined and the worklog `updated_at` not bumped. (If PG unreachable the test early-returns; confirm by checking the other pull tests skip too — then rely on Step 4's reasoning + the controller's local PG run.)

- [ ] **Step 3: Collect `touchedFkIds` in `pullTable`/`pullAll`**

In `orchestrator/sync/pull.ts`:

1. Change `pullTable`'s return type and track touched FK ids. Update the signature/return:
```typescript
export async function pullTable(
  db: SqliteLike,
  store: PgStore,
  table: SyncTable,
): Promise<{ pulled: number; conflicts: number; touchedFkIds: number[] }> {
```
2. Add `const touchedFkIds: number[] = [];` near `let pulled = 0;`.
3. In the branch where a remote row is actually written locally (the `upsertLocal(...)` call path — i.e. after the LWW guards decide remote wins / new row), push the resolved id: immediately after the `upsertLocal(db, table, remote, fk, localFkId);` call (and the `pulled++`), add:
```typescript
      if (localFkId != null) touchedFkIds.push(localFkId);
```
   (For tables with no FK, `localFkId` is null and nothing is pushed — `touchedFkIds` stays empty, which is fine; only `contracts` consumes it.)
4. Change the final `return { pulled, conflicts };` to:
```typescript
  return { pulled, conflicts, touchedFkIds };
```
5. In `pullAll`, the result map type widens automatically (it stores whatever `pullTable` returns); no change needed beyond the type flowing through. Confirm `pullAll`'s return annotation is `Record<string, { pulled: number; conflicts: number; touchedFkIds: number[] }>` (update it if it names the old shape explicitly).

- [ ] **Step 4: Trigger the rebill in the sync service**

In `orchestrator/sync/service.ts`, import the rebill helper + `nowIso` at the top (match the project's existing now/ISO helper — check `orchestrator/index.ts`'s `nowIso()` import source; it is `orchestrator/db/...` or a local util):
```typescript
import { markWorklogsForRebill } from '../db/rebill.js';
```
Then in `syncNow`, after `const pull = await pullAll(this.db, this.store);`:
```typescript
      // Self-heal: a foreign contract change (pulled from another writer, e.g. the
      // iPad) must re-bill that project's worklogs so the next push re-derives their
      // earned_amount. Whole-project rebill (earliest date) — simplest and correct.
      const contractProjects = new Set(pull.contracts?.touchedFkIds ?? []);
      const nowIso = new Date().toISOString();
      for (const projectId of contractProjects) {
        markWorklogsForRebill(this.db, projectId, '0001-01-01', nowIso);
      }
```
(Place this before building `result`. Use `new Date().toISOString()` inline — the service already runs real-time, no need for a special helper.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/orchestrator/sync/pull.test.ts` (with local Postgres up — the user's `fitness-postgres` docker; else the test early-returns)
Expected: PASS (the new case + existing pull cases).

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/sync/pull.ts orchestrator/sync/service.ts tests/orchestrator/sync/pull.test.ts
git commit -m "feat(sync): Mac self-heal — rebill a project's worklogs on pulling a foreign contract change"
```

---

## Task 8: Editable rate history in `ProjectDetailView` + `ContractDrawer`

**Files:**
- Modify: `apps/ipad/src/components/billing/ProjectDetailView.tsx`

**Interfaces:**
- Consumes: `useBilling` (`data`, `state`, `patchContracts`, `patchWorklogs`), `useContractMutations` (incl. `error`), `canEdit` (billingWrites), `C` tokens, `ContractRow`/`ContractWriteInput`.

UI task; verified by `npm run typecheck` + the full `npm test` suite.

- [ ] **Step 1: Add the `ContractDrawer` + wire editing into the rate history**

In `apps/ipad/src/components/billing/ProjectDetailView.tsx`:

1. Add imports at the top:
```typescript
import { useState } from 'react';
import { useContractMutations } from '../../state/useContractMutations.js';
import { canEdit, type ContractWriteInput } from '../../state/billingWrites.js';
import type { ContractRow } from '@watchtower/shared/billing/types.js';
```
2. Inside the component, after the existing `const { data, state } = useBilling();`, widen it to also pull the patch fns and wire the hook (use the existing `projectId` prop and the already-computed `projectContracts`/`projectWorklogs`):
```typescript
  const { data, state, patchContracts, patchWorklogs } = useBilling();
  // … existing code that derives projectContracts / projectWorklogs …
  const editable = canEdit(state);
  const allWorklogs = data?.worklogs ?? [];
  const { createContract, updateContract, deleteContract, error: contractError } =
    useContractMutations({ contracts: data?.contracts ?? [], worklogs: allWorklogs, patchContracts, patchWorklogs });
  const [drawer, setDrawer] = useState<{ mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; contract: ContractRow }>({ mode: 'closed' });
```
3. In the rate-history section header, add a "+ Přidat sazbu" button when `editable` (mirror the slice-3a header-button style). In the rate-history table, make each contract row open the edit drawer when `editable` (wrap the row's content in a clickable element / add an `onClick={() => editable && setDrawer({ mode: 'edit', contract })}` and `cursor: editable ? 'pointer' : 'default'`). Render `{contractError && <div style={{ color: C.red, fontSize: 12, padding: '4px 0' }}>{contractError}</div>}` near the section.
4. Render the drawer at the end of the component's returned JSX:
```tsx
      {drawer.mode === 'create' && (
        <ContractDrawer
          title="Nová sazba"
          projectId={projectId}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (input) => { await createContract(input); setDrawer({ mode: 'closed' }); }}
        />
      )}
      {drawer.mode === 'edit' && (
        <ContractDrawer
          title="Upravit sazbu"
          projectId={projectId}
          initial={drawer.contract}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (input) => { await updateContract(drawer.contract.syncId, input); setDrawer({ mode: 'closed' }); }}
          onDelete={async () => { await deleteContract(drawer.contract.syncId); setDrawer({ mode: 'closed' }); }}
        />
      )}
```
5. Add the `ContractDrawer` component at the bottom of the file (mirrors the slice-3a `TaskDrawer` pattern; bottom-sheet, inline styles, native date inputs):
```tsx
function ContractDrawer({ title, projectId, initial, onClose, onSubmit, onDelete }: {
  title: string;
  projectId: number;
  initial?: ContractRow;
  onClose(): void;
  onSubmit(input: ContractWriteInput): Promise<void>;
  onDelete?(): Promise<void>;
}): JSX.Element {
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effectiveFrom ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [rateType, setRateType] = useState<'hourly' | 'daily'>(initial?.rateType ?? 'hourly');
  const [rateAmount, setRateAmount] = useState(initial ? String(initial.rateAmount) : '');
  const [hoursPerDay, setHoursPerDay] = useState(initial ? String(initial.hoursPerDay) : '8');
  const [mdLimit, setMdLimit] = useState(initial?.mdLimit != null ? String(initial.mdLimit) : '');
  const [saving, setSaving] = useState(false);

  const rate = Number(rateAmount.replace(',', '.'));
  const hpd = Number(hoursPerDay.replace(',', '.'));
  const md = mdLimit.trim() === '' ? null : Number(mdLimit.replace(',', '.'));
  const valid =
    effectiveFrom !== '' &&
    Number.isFinite(rate) && rate >= 0 &&
    Number.isFinite(hpd) && hpd > 0 &&
    (md === null || (Number.isFinite(md) && md >= 0));
  const canSubmit = valid && !saving;

  const field: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
  const label: React.CSSProperties = { fontSize: 12, color: C.muted, marginBottom: 4 };

  async function submit() {
    setSaving(true);
    await onSubmit({
      projectId,
      effectiveFrom,
      endDate: endDate.trim() === '' ? null : endDate,
      rateType,
      rateAmount: rate,
      hoursPerDay: hpd,
      mdLimit: md,
    });
    setSaving(false);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.ground, borderTopLeftRadius: 16, borderTopRightRadius: 16, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Platné od</div>
            <input type="date" style={field} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Platné do (volitelné)</div>
            <input type="date" style={field} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div>
          <div style={label}>Typ sazby</div>
          <select value={rateType} onChange={(e) => setRateType(e.target.value as 'hourly' | 'daily')} style={field}>
            <option value="hourly">Hodinová</option>
            <option value="daily">Denní</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Sazba</div>
            <input style={field} inputMode="decimal" value={rateAmount} onChange={(e) => setRateAmount(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Hodin/den</div>
            <input style={field} inputMode="decimal" value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)} />
          </div>
        </div>
        <div>
          <div style={label}>MD limit (volitelné)</div>
          <input style={field} inputMode="decimal" value={mdLimit} onChange={(e) => setMdLimit(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {onDelete && (
            <button onClick={async () => { setSaving(true); await onDelete(); }} disabled={saving} style={{ ...field, width: 'auto', color: C.red, cursor: 'pointer' }}>Smazat</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...field, width: 'auto', cursor: 'pointer' }}>Zrušit</button>
          <button onClick={submit} disabled={!canSubmit} style={{ ...field, width: 'auto', background: canSubmit ? C.violet : C.border, color: '#fff', border: 'none', cursor: canSubmit ? 'pointer' : 'default' }}>
            {saving ? 'Ukládám…' : 'Uložit'}
          </button>
        </div>
      </div>
    </div>
  );
}
```
   Read the existing `ProjectDetailView.tsx` rate-history JSX (around the `contractPeriods.map(...)` block) to place the row `onClick` and the header button precisely; keep all existing read-only rendering intact. If `C` is not already imported in this file, add `import { C } from './reports/tokens.js';` (note: this file is one level above `records/`, so the path is `./reports/tokens.js`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors. Resolve any wrinkle (e.g. an unused import, or `C` already imported) yourself.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all tests pass (~889+ baseline + slice-3b tests from Tasks 1-5,7).

- [ ] **Step 4: Manual smoke (optional — iPad dev build + Supabase online)**

Open a project's detail with a `fresh` dataset: add a contract (rate 150 from a date), confirm the rate history shows it AND the earnings column updates immediately (local rebill); edit a contract's rate, confirm earnings change; try an overlapping range, confirm the inline `C.red` overlap error; delete a contract. Toggle airplane mode → read-only (no + Přidat / no row tap).

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/components/billing/ProjectDetailView.tsx
git commit -m "feat(ipad): editable rate history — contract create/edit/delete drawer + overlap error + local earnings rebill"
```

---

## Final verification

- [ ] **Run the full suite + typecheck together**

Run: `npm test && npm run typecheck`
Expected: all tests pass; 0 type errors across all 6 projects. (The Mac pull-rebill test needs local Postgres up; if it skipped, run it with `WATCHTOWER_PG_URL` pointed at the local `fitness-postgres` container and confirm it passes.)

- [ ] **Confirm v9 runs idempotently on the live Supabase project** (the orchestrator applies `PG_MIGRATIONS` on startup; v9 is versioned + role-guarded).

---

## Self-Review notes (resolved)

- **Spec coverage:** shared overlap/previousDay (T1); ContractRow.syncId read (T2); patchContracts (T3); contracts write RLS v9 (T4); shapers + applyContractWrite + local rebillProjectWorklogs (T5); useContractMutations with overlap guard + auto-close + local rebill (T6); Mac self-heal pull hook (T7); editable rate-history UI (T8). The two-part ripple (iPad local rebill in T5/T6, Mac self-heal in T7) is covered.
- **Type consistency:** `ContractWriteInput`/`ContractChange` names match across T5/T6/T8; `buildOptimisticContractRow`/`applyContractWrite`/`rebillProjectWorklogs` signatures consistent T5↔T6; `contractsOverlap`/`previousDay` signatures consistent T1↔T6; `touchedFkIds` shape consistent T7 pull↔service.
- **Overlap = only guard:** the shared predicate matches the orchestrator sentinel; boundary-touch test included (T1).
- **Non-atomic create:** auto-close write then insert; cache rolls back on error (T6); partial server state documented in the spec.
- **sync_id:** create mints; edit/delete key on existing syncId; no natural-key re-mark.
