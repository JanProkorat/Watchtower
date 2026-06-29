# iPad Billing Write-back Slice 2 (Worklog CRUD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iPad billing worklog list support full create / edit / delete against Supabase, with derived billing fields computed on the iPad via a formula shared with the Mac.

**Architecture:** Online-direct writes (no offline outbox), LWW via `updated_at`, soft-delete via `deleted_at` — reusing the slice-1 foundation. The Mac's strict push LWW guard never re-derives an iPad-authored row, so the iPad computes `effective_minutes`/`resolved_rate`/`earned_amount` itself using the pure `computeWorklogBilling` extracted into `@watchtower/shared`, fed by its cached contracts. Create needs a task picker, so a flat `TaskRow[]` is added to the cached dataset.

**Tech Stack:** TypeScript, React (plain, inline styles — no MUI), Supabase JS client, `@watchtower/shared` (built composite), Postgres RLS, vitest.

## Global Constraints

- **Online-direct writes only.** Edit controls disabled unless `useBilling` state is `fresh` (`canEdit(state)` from slice 1). No offline outbox.
- **Soft-delete only.** Delete = `UPDATE ... SET deleted_at = now, updated_at = now`. Never a hard `DELETE`.
- **LWW via `updated_at`.** Every write stamps `updated_at = now` (ISO string).
- **iPad computes derived fields** via the shared `computeWorklogBilling`; never approximate with a forked formula.
- **apps/ipad:** plain React + inline styles, no MUI; cs-CZ; no i18n; reuse `reports/tokens.ts` `C` + `useToast`.
- **Pure logic is unit-tested; the Supabase client is injected/never hit live; UI verified by typecheck.**
- **`@watchtower/shared` is a built composite** — vitest resolves it from `packages/shared/src` (source alias), but `npm run typecheck` builds it first via `tsc -b`. Always run `npm run typecheck` (not a bare `tsc -p`) so shared is rebuilt.
- Verification commands: `npm test` (vitest, currently 799+ tests — add tests as code is added) and `npm run typecheck` (builds shared + typechecks every project incl. desktop + ipad).
- Never edit `.env*`. Branch: `feat/120-writeback-worklog` (already created).
- Source of truth: `docs/superpowers/specs/2026-06-28-ipad-writeback-s2-worklog-design.md`.

---

## File Structure

- `packages/shared/src/billing/worklogBilling.ts` — **new**, the extracted pure derivation (`computeWorklogBilling` + `resolveContract` + `ContractLite`/`WorklogBilling` types).
- `orchestrator/db/worklogBilling.ts` — **becomes a re-export shim** of the shared module (keeps `sync/derive.ts` and the existing test green).
- `packages/shared/src/billing/parseMinutes.ts` — **new**, the extracted minutes parser.
- `apps/desktop/src/util/format.ts` — drop the local `parseMinutes`, re-export from shared.
- `packages/shared/src/billing/types.ts` — add `reportedMinutes`/`description` to `WorklogRow`; add `TaskRow`.
- `apps/ipad/src/state/billingCache.ts` — map new worklog fields; add `RawTaskRow`/`mapTaskRow`; add `tasks` to `BillingDataset`; extend `loadCache` guard.
- `apps/ipad/src/state/useBilling.ts` — fetch+map `tasks`; add `reported_minutes,description` to the worklog select; add `patchWorklogs` + `PATCH_WORKLOGS` reducer action.
- `orchestrator/db/pg/schema.ts` — `PG_MIGRATIONS` v7 (worklogs write RLS).
- `apps/ipad/src/state/billingWrites.ts` — worklog shapers + pure derive/optimistic helpers + `applyWorklogWrite`.
- `apps/ipad/src/state/useWorklogMutations.ts` — **new**, client-wired CRUD hook.
- `apps/ipad/src/components/billing/records/WorklogListView.tsx` — create/edit drawers, task picker, online gating.

---

## Task 1: Extract `computeWorklogBilling` into `@watchtower/shared`

**Files:**
- Create: `packages/shared/src/billing/worklogBilling.ts`
- Modify: `orchestrator/db/worklogBilling.ts` (replace body with re-export shim)
- Move: `tests/orchestrator/worklogBilling.test.ts` → `tests/shared/worklogBilling.test.ts` (re-point import to shared)

**Interfaces:**
- Produces: `computeWorklogBilling(input: { minutes: number; reportedMinutes: number | null; workDate: string; contracts: ContractLite[] }): WorklogBilling`; `interface ContractLite { effectiveFrom: string; rateType: 'hourly' | 'daily'; rateAmount: number; hoursPerDay: number }`; `interface WorklogBilling { effectiveMinutes: number; resolvedRate: number | null; earnedAmount: number | null }`. Exported from `@watchtower/shared/billing/worklogBilling.js`.

- [ ] **Step 1: Create the shared module (verbatim copy of the current logic)**

Create `packages/shared/src/billing/worklogBilling.ts`:

```typescript
// Per-worklog billing, mirroring orchestrator/db/reportsSql.ts SUM_EARNED.
// Pure (no I/O) so it is unit-testable; used by the sync push (Mac) and the
// iPad write path to compute the Postgres-only derived columns. Keep in
// lockstep with reportsSql's hourly/daily formula and LEAD-based rate window.

export interface ContractLite {
  effectiveFrom: string;          // 'YYYY-MM-DD'
  rateType: 'hourly' | 'daily';
  rateAmount: number;
  hoursPerDay: number;
}

export interface WorklogBilling {
  effectiveMinutes: number;
  resolvedRate: number | null;
  earnedAmount: number | null;
}

/**
 * Resolve the contract whose window contains `workDate`: the latest contract
 * with `effectiveFrom <= workDate`. Returns null when no contract starts on or
 * before the date.
 */
function resolveContract(workDate: string, contracts: ContractLite[]): ContractLite | null {
  let best: ContractLite | null = null;
  for (const c of contracts) {
    if (c.effectiveFrom <= workDate && (best === null || c.effectiveFrom > best.effectiveFrom)) {
      best = c;
    }
  }
  return best;
}

export function computeWorklogBilling(input: {
  minutes: number;
  reportedMinutes: number | null;
  workDate: string;
  contracts: ContractLite[];
}): WorklogBilling {
  const effectiveMinutes = input.reportedMinutes ?? input.minutes;
  const c = resolveContract(input.workDate, input.contracts);
  if (!c) {
    return { effectiveMinutes, resolvedRate: null, earnedAmount: null };
  }
  const earnedAmount =
    c.rateType === 'hourly'
      ? (effectiveMinutes * c.rateAmount) / 60
      : (effectiveMinutes / 60 / c.hoursPerDay) * c.rateAmount;
  return { effectiveMinutes, resolvedRate: c.rateAmount, earnedAmount };
}
```

- [ ] **Step 2: Replace the orchestrator file with a re-export shim**

Replace the entire contents of `orchestrator/db/worklogBilling.ts` with:

```typescript
// Moved to @watchtower/shared/billing/worklogBilling so the iPad write path and
// the Mac sync push share one formula. This shim keeps existing import sites
// (orchestrator/sync/derive.ts) unchanged.
export {
  computeWorklogBilling,
  type ContractLite,
  type WorklogBilling,
} from '@watchtower/shared/billing/worklogBilling.js';
```

- [ ] **Step 3: Move the test and re-point it at shared**

`git mv tests/orchestrator/worklogBilling.test.ts tests/shared/worklogBilling.test.ts`, then change line 2's import to:

```typescript
import { computeWorklogBilling, type ContractLite } from '@watchtower/shared/billing/worklogBilling.js';
```

Leave the test bodies unchanged.

- [ ] **Step 4: Run the test (resolves shared via the vitest source alias)**

Run: `npx vitest run tests/shared/worklogBilling.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck (builds shared, then derive.ts via the shim)**

Run: `npm run typecheck`
Expected: no errors (shared builds; `orchestrator/sync/derive.ts` resolves through the shim).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/billing/worklogBilling.ts orchestrator/db/worklogBilling.ts tests/shared/worklogBilling.test.ts tests/orchestrator/worklogBilling.test.ts
git commit -m "refactor: extract computeWorklogBilling into @watchtower/shared (shim orchestrator)"
```

---

## Task 2: Extract `parseMinutes` into `@watchtower/shared`

**Files:**
- Create: `packages/shared/src/billing/parseMinutes.ts`
- Modify: `apps/desktop/src/util/format.ts` (replace local impl with re-export)
- Test: `tests/shared/parseMinutes.test.ts`

**Interfaces:**
- Produces: `parseMinutes(input: string): number` (returns `NaN` on invalid). Exported from `@watchtower/shared/billing/parseMinutes.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/parseMinutes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';

describe('parseMinutes', () => {
  it('parses decimal hours (dot and comma)', () => {
    expect(parseMinutes('1.5')).toBe(90);
    expect(parseMinutes('1,5')).toBe(90);
  });
  it('parses h:mm', () => {
    expect(parseMinutes('1:30')).toBe(90);
    expect(parseMinutes('0:45')).toBe(45);
  });
  it('parses 1h30m / 2h / 45m', () => {
    expect(parseMinutes('1h30m')).toBe(90);
    expect(parseMinutes('2h')).toBe(120);
    expect(parseMinutes('45m')).toBe(45);
  });
  it('returns NaN for empty/garbage', () => {
    expect(parseMinutes('')).toBeNaN();
    expect(parseMinutes('abc')).toBeNaN();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/parseMinutes.test.ts`
Expected: FAIL — cannot resolve `@watchtower/shared/billing/parseMinutes.js`.

- [ ] **Step 3: Create the shared module (verbatim from desktop)**

Create `packages/shared/src/billing/parseMinutes.ts`:

```typescript
/**
 * Parse a human minutes/hours string into integer minutes.
 * Accepts: "1.5"/"1,5" (decimal hours), "1:30" (h:mm), "1h30m"/"2h"/"45m".
 * Returns NaN for empty or unrecognised input.
 */
export function parseMinutes(input: string): number {
  const trimmed = input.trim().toLowerCase().replace(',', '.');
  if (!trimmed) return NaN;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const hours = Number(trimmed);
    return Math.round(hours * 60);
  }
  const colon = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const hm = trimmed.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (hm && (hm[1] || hm[2])) {
    return Math.round(Number(hm[1] ?? 0) * 60) + Number(hm[2] ?? 0);
  }
  return NaN;
}
```

- [ ] **Step 4: Re-export from the desktop util (don't break desktop import sites)**

In `apps/desktop/src/util/format.ts`, delete the local `parseMinutes` function body (lines 141-155) and add a re-export near the top of the file (after existing imports):

```typescript
export { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/shared/parseMinutes.test.ts`
Expected: PASS (4 tests).

Run: `npm run typecheck`
Expected: no errors (desktop's `WorklogCellPopover`/`BoardTaskDetailDrawer` still import `parseMinutes` from `../util/format`, now re-exported).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/billing/parseMinutes.ts apps/desktop/src/util/format.ts tests/shared/parseMinutes.test.ts
git commit -m "refactor: extract parseMinutes into @watchtower/shared; desktop re-exports"
```

---

## Task 3: Read additions — worklog fields, `TaskRow`, dataset `tasks`

**Files:**
- Modify: `packages/shared/src/billing/types.ts`
- Modify: `apps/ipad/src/state/billingCache.ts`
- Modify: `apps/ipad/src/state/useBilling.ts:84-150`
- Test: `tests/ipad/billingCache.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WorklogRow` gains `reportedMinutes: number | null` and `description: string | null`; `interface TaskRow { taskId: number; taskNumber: string | null; taskTitle: string; projectId: number; projectName: string; projectColor: string | null; projectKind: string; isBillable: boolean }`; `BillingDataset` gains `tasks: TaskRow[]`; `mapTaskRow(raw: RawTaskRow): TaskRow`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/ipad/billingCache.test.ts`:

```typescript
import { mapWorklogRow, mapTaskRow, loadCache } from '../../apps/ipad/src/state/billingCache.js';
import type { RawTaskRow } from '../../apps/ipad/src/state/billingCache.js';

describe('mapWorklogRow — slice 2 fields', () => {
  it('maps reported_minutes and description', () => {
    const row = mapWorklogRow({
      sync_id: 'w1', work_date: '2026-06-01', minutes: 120, effective_minutes: 90,
      earned_amount: 150, reported_minutes: 90, description: 'fix bug', source: 'manual',
      tasks: { number: 'X-1', title: 'T', epics: { projects: { id: 3, name: 'P', color: '#fff', kind: 'work', is_billable: true } } },
    });
    expect(row.reportedMinutes).toBe(90);
    expect(row.description).toBe('fix bug');
  });
  it('defaults reported_minutes/description to null', () => {
    const row = mapWorklogRow({
      sync_id: 'w2', work_date: '2026-06-01', minutes: 60, effective_minutes: 60,
      earned_amount: null, reported_minutes: null, description: null, source: null, tasks: null,
    });
    expect(row.reportedMinutes).toBeNull();
    expect(row.description).toBeNull();
  });
});

describe('mapTaskRow', () => {
  it('flattens task → epic → project', () => {
    const raw: RawTaskRow = {
      id: 7, number: 'X-9', title: 'Task nine',
      epics: { projects: { id: 3, name: 'Proj', color: '#abc', kind: 'work', is_billable: true } },
    };
    expect(mapTaskRow(raw)).toEqual({
      taskId: 7, taskNumber: 'X-9', taskTitle: 'Task nine',
      projectId: 3, projectName: 'Proj', projectColor: '#abc', projectKind: 'work', isBillable: true,
    });
  });
});

describe('loadCache — slice 2 shape guard', () => {
  it('rejects a cache without a tasks array (forces refetch)', async () => {
    const store = new Map<string, string>();
    const legacy = { worklogs: [], contracts: [], daysOff: [], projects: [], fetchedAt: '2026-06-01T00:00:00Z' };
    store.set('watchtower.ipad.billing.cache', JSON.stringify(legacy));
    const adapter = { get: async (k: string) => store.get(k) ?? null, set: async () => {} };
    expect(await loadCache(adapter)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ipad/billingCache.test.ts`
Expected: FAIL — `mapTaskRow`/`RawTaskRow` not exported; `reportedMinutes` not on the mapped row; legacy cache still returns non-null.

- [ ] **Step 3: Extend the shared types**

In `packages/shared/src/billing/types.ts`, update `WorklogRow` and add `TaskRow`:

```typescript
export interface WorklogRow {
  syncId: string;
  workDate: string;          // YYYY-MM-DD
  minutes: number;           // raw tracked minutes
  reportedMinutes: number | null; // billable-rounded override (null = use minutes)
  effectiveMinutes: number;  // derived: reported ?? minutes
  earnedAmount: number | null;
  description: string | null;
  projectId: number;
  projectName: string;
  projectColor: string | null;
  projectKind: string;       // 'work' | 'personal' | 'time_off' (...)
  isBillable: boolean;
  taskNumber: string | null;
  taskTitle: string | null;
  source: string | null;     // 'manual' | 'watchtower-auto' | 'jira-sync' | null
}

export interface TaskRow {
  taskId: number;
  taskNumber: string | null;
  taskTitle: string;
  projectId: number;
  projectName: string;
  projectColor: string | null;
  projectKind: string;
  isBillable: boolean;
}
```

- [ ] **Step 4: Extend the cache mappers + dataset + guard**

In `apps/ipad/src/state/billingCache.ts`:

1. Add `TaskRow` to the type import on line 1:
```typescript
import type { WorklogRow, ContractRow, DayOffRow, ProjectRow, TaskRow } from '@watchtower/shared/billing/types.js';
```
2. Add `tasks` to `BillingDataset`:
```typescript
export interface BillingDataset {
  worklogs: WorklogRow[];
  contracts: ContractRow[];
  daysOff: DayOffRow[];
  projects: ProjectRow[];
  tasks: TaskRow[];
  fetchedAt: string; // ISO timestamp
}
```
3. Extend `RawWorklogRow` with the two new columns:
```typescript
export type RawWorklogRow = {
  sync_id: string;
  work_date: string;
  minutes: number;
  effective_minutes: number;
  earned_amount: number | null;
  reported_minutes: number | null;
  description: string | null;
  source: string | null;
  tasks: RawTask;
};
```
4. In `mapWorklogRow`, add the two fields to the returned object (after `earnedAmount`):
```typescript
    reportedMinutes: raw.reported_minutes ?? null,
    description: raw.description ?? null,
```
5. Add the task mapper after `mapWorklogRow`:
```typescript
export type RawTaskRow = {
  id: number;
  number: string | null;
  title: string | null;
  epics: { projects: RawProject | null } | null;
};

export function mapTaskRow(raw: RawTaskRow): TaskRow {
  const proj = raw.epics?.projects ?? null;
  return {
    taskId: raw.id,
    taskNumber: raw.number ?? null,
    taskTitle: raw.title ?? '',
    projectId: proj?.id ?? 0,
    projectName: proj?.name ?? '',
    projectColor: proj?.color ?? null,
    projectKind: proj?.kind ?? '',
    isBillable: proj?.is_billable ?? false,
  };
}
```
6. Extend the `loadCache` shape guard to require `tasks`:
```typescript
    if (
      Array.isArray(v?.worklogs) &&
      Array.isArray(v?.contracts) &&
      Array.isArray(v?.daysOff) &&
      Array.isArray(v?.projects) &&
      Array.isArray(v?.tasks) &&
      typeof v?.fetchedAt === 'string'
    ) {
      return v;
    }
```

- [ ] **Step 5: Fetch + map tasks in `useBilling`, widen the worklog select**

In `apps/ipad/src/state/useBilling.ts`:

1. Import the task mapper + types:
```typescript
import type { ContractRow, DayOffRow, ProjectRow, TaskRow } from '@watchtower/shared/billing/types.js';
import {
  mapWorklogRow,
  mapDayOffRow,
  mapTaskRow,
  loadCache,
  saveCache,
  type BillingDataset,
  type BillingStore,
  type RawWorklogRow,
  type RawDayOffRow,
  type RawTaskRow,
} from './billingCache.js';
```
2. Add `reported_minutes,description,` to the worklog select string (line 94):
```typescript
        .select(
          'sync_id,work_date,minutes,effective_minutes,earned_amount,reported_minutes,description,source,' +
            'tasks(number,title,epics(projects(id,name,color,kind,is_billable)))',
        )
```
3. Add a paginated tasks fetch alongside `worklogsPromise`:
```typescript
  const tasksPromise = fetchAllPaged<RawTaskRow>(
    (from, to) =>
      supabase
        .from('tasks')
        .select('id,number,title,epics(projects(id,name,color,kind,is_billable))')
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<RawTaskRow>>,
  );
```
4. Add `tasksPromise` to the `Promise.all` destructure:
```typescript
  const [worklogsRaw, contractsResult, daysOffResult, projectsResult, tasksRaw] = await Promise.all([
    worklogsPromise,
    /* contracts */ supabase.from('contracts').select('project_id,effective_from,end_date,rate_type,rate_amount,hours_per_day,md_limit').is('deleted_at', null),
    supabase.from('days_off').select('date,kind,sync_id').is('deleted_at', null),
    supabase.from('projects').select('id,name,color,kind,is_billable').is('deleted_at', null),
    tasksPromise,
  ]);
```
(Keep the existing contracts/days_off/projects calls exactly; only add `tasksPromise` as the 5th element.)
5. Map tasks and include in the returned dataset:
```typescript
  const tasks: TaskRow[] = tasksRaw.map((r) => mapTaskRow(r));

  return {
    worklogs,
    contracts,
    daysOff,
    projects,
    tasks,
    fetchedAt: new Date().toISOString(),
  };
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/ipad/billingCache.test.ts`
Expected: PASS (all new + existing cases).

Run: `npm run typecheck`
Expected: no errors (any other constructor of `BillingDataset` in tests now needs `tasks: []` — fix those compile errors by adding `tasks: []` to literal datasets; search `tests/ipad/useBilling.test.ts` and `tests/ipad/billingCache.test.ts` for `fetchedAt:` literals and add `tasks: []`).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/billing/types.ts apps/ipad/src/state/billingCache.ts apps/ipad/src/state/useBilling.ts tests/ipad/billingCache.test.ts tests/ipad/useBilling.test.ts
git commit -m "feat(ipad): cache task tree + worklog reported/description for write-back"
```

---

## Task 4: `patchWorklogs` optimistic cache patch

**Files:**
- Modify: `apps/ipad/src/state/useBilling.ts`
- Test: `tests/ipad/useBilling.test.ts`

**Interfaces:**
- Consumes: `WorklogRow` (shared), `billingReducer`.
- Produces: `BillingAction` gains `{ type: 'PATCH_WORKLOGS'; worklogs: WorklogRow[] }`; `BillingHookResult` gains `patchWorklogs(next: WorklogRow[]): void`.

- [ ] **Step 1: Write the failing test**

Add to `tests/ipad/useBilling.test.ts`:

```typescript
import { billingReducer } from '../../apps/ipad/src/state/useBilling.js';
import type { WorklogRow } from '@watchtower/shared/billing/types.js';

describe('billingReducer — PATCH_WORKLOGS', () => {
  const wl = (syncId: string): WorklogRow => ({
    syncId, workDate: '2026-06-01', minutes: 60, reportedMinutes: null, effectiveMinutes: 60,
    earnedAmount: null, description: null, projectId: 1, projectName: 'P', projectColor: null,
    projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null, source: 'manual',
  });
  it('swaps worklogs in the existing dataset', () => {
    const start = { data: { worklogs: [wl('a')], contracts: [], daysOff: [], projects: [], tasks: [], fetchedAt: 'x' }, state: 'fresh' as const, lastUpdated: 'x' };
    const next = billingReducer(start, { type: 'PATCH_WORKLOGS', worklogs: [wl('a'), wl('b')] });
    expect(next.data?.worklogs.map((w) => w.syncId)).toEqual(['a', 'b']);
  });
  it('is a no-op when there is no data', () => {
    const start = { data: null, state: 'offline' as const, lastUpdated: null };
    expect(billingReducer(start, { type: 'PATCH_WORKLOGS', worklogs: [wl('a')] })).toBe(start);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ipad/useBilling.test.ts`
Expected: FAIL — `PATCH_WORKLOGS` not in the action union (type error / reducer returns `prev`).

- [ ] **Step 3: Implement the reducer action + hook method**

In `apps/ipad/src/state/useBilling.ts`:

1. Add the import of `WorklogRow` to the type import on line 3:
```typescript
import type { ContractRow, DayOffRow, ProjectRow, TaskRow, WorklogRow } from '@watchtower/shared/billing/types.js';
```
2. Extend `BillingHookResult`:
```typescript
  patchWorklogs(next: WorklogRow[]): void;
```
3. Extend `BillingAction`:
```typescript
  | { type: 'PATCH_DAYS_OFF'; daysOff: DayOffRow[] }
  | { type: 'PATCH_WORKLOGS'; worklogs: WorklogRow[] };
```
4. Add the reducer case (next to `PATCH_DAYS_OFF`):
```typescript
    case 'PATCH_WORKLOGS':
      return prev.data ? { ...prev, data: { ...prev.data, worklogs: action.worklogs } } : prev;
```
5. Add the callback and return it:
```typescript
  const patchWorklogs = useCallback((next: WorklogRow[]) => dispatch({ type: 'PATCH_WORKLOGS', worklogs: next }), [dispatch]);
```
```typescript
  return {
    data: bState.data,
    state: bState.state,
    lastUpdated: bState.lastUpdated,
    refresh,
    patchDaysOff,
    patchWorklogs,
  };
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/ipad/useBilling.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/useBilling.ts tests/ipad/useBilling.test.ts
git commit -m "feat(ipad): patchWorklogs optimistic cache patch"
```

---

## Task 5: Postgres write RLS — `PG_MIGRATIONS` v7 (worklogs)

**Files:**
- Modify: `orchestrator/db/pg/schema.ts` (append v7 to `PG_MIGRATIONS`)
- Test: `tests/orchestrator/pgMigrations.writeback.test.ts`

**Interfaces:**
- Produces: a `{ version: 7, up: string[] }` entry creating a guarded `write_authenticated` `FOR ALL` policy on `worklogs`.

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator/pgMigrations.writeback.test.ts`:

```typescript
describe('PG_MIGRATIONS v7 — worklogs write policy', () => {
  it('adds a version-7 migration', () => {
    expect(PG_MIGRATIONS.find((m) => m.version === 7)).toBeDefined();
  });
  it('creates a guarded write_authenticated policy for worklogs (FOR ALL)', () => {
    const sql = PG_MIGRATIONS.find((m) => m.version === 7)!.up.join('\n');
    expect(sql).toContain('worklogs');
    expect(sql).toContain('write_authenticated');
    expect(sql).toContain('FOR ALL TO authenticated');
    expect(sql).toContain('DROP POLICY IF EXISTS write_authenticated ON worklogs');
    expect(sql).toContain("rolname = 'authenticated'");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/orchestrator/pgMigrations.writeback.test.ts`
Expected: FAIL — v7 not found.

- [ ] **Step 3: Append v7 to `PG_MIGRATIONS`**

In `orchestrator/db/pg/schema.ts`, add a new entry after the v6 object (before the closing `];` of `PG_MIGRATIONS`):

```typescript
  {
    version: 7,
    up: [
      // Write-back slice 2: allow authenticated INSERT/UPDATE on worklogs (soft-delete
      // is an UPDATE). Mirrors v6/v4: idempotent + role-guarded so plain Postgres
      // (dev/test, no `authenticated` role) still applies cleanly.
      `ALTER TABLE worklogs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_authenticated ON worklogs;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON worklogs FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;`,
    ],
  },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/orchestrator/pgMigrations.writeback.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/pg/schema.ts tests/orchestrator/pgMigrations.writeback.test.ts
git commit -m "feat(sync): PG_MIGRATIONS v7 — worklogs write RLS policy"
```

---

## Task 6: Worklog write shapers + pure derive/optimistic helpers

**Files:**
- Modify: `apps/ipad/src/state/billingWrites.ts`
- Test: `tests/ipad/billingWrites.test.ts`

**Interfaces:**
- Consumes: `computeWorklogBilling`, `ContractLite`, `WorklogBilling` (shared); `WorklogRow`, `ContractRow`, `TaskRow` (shared).
- Produces:
  - `interface WorklogWriteInput { taskId: number; workDate: string; minutes: number; reportedMinutes: number | null; description: string | null }`
  - `computeDerivedForWrite(contracts: ContractRow[], projectId: number, input: { minutes: number; reportedMinutes: number | null; workDate: string }): WorklogBilling`
  - `buildWorklogInsert(input: WorklogWriteInput, opts: { syncId: string; now: string; billing: WorklogBilling }): WorklogInsertRow`
  - `buildWorklogUpdate(input: { workDate: string; minutes: number; reportedMinutes: number | null; description: string | null }, opts: { now: string; billing: WorklogBilling }): WorklogUpdateRow`
  - `buildWorklogDelete(now: string): { deleted_at: string; updated_at: string }`
  - `buildOptimisticWorklogRow(task: TaskRow, input: WorklogWriteInput, billing: WorklogBilling, syncId: string): WorklogRow`
  - `buildEditedWorklogRow(existing: WorklogRow, input: { workDate: string; minutes: number; reportedMinutes: number | null; description: string | null }, billing: WorklogBilling): WorklogRow`
  - `applyWorklogWrite(worklogs: WorklogRow[], change: WorklogChange): WorklogRow[]` where `WorklogChange = { type: 'upsert'; row: WorklogRow } | { type: 'remove'; syncId: string }`

- [ ] **Step 1: Write the failing tests**

Add to `tests/ipad/billingWrites.test.ts`:

```typescript
import {
  computeDerivedForWrite, buildWorklogInsert, buildWorklogUpdate, buildWorklogDelete,
  buildOptimisticWorklogRow, buildEditedWorklogRow, applyWorklogWrite,
} from '../../apps/ipad/src/state/billingWrites.js';
import type { ContractRow, TaskRow, WorklogRow } from '@watchtower/shared/billing/types.js';

const contract = (projectId: number): ContractRow => ({
  projectId, effectiveFrom: '2026-01-01', endDate: null, rateType: 'hourly', rateAmount: 100, hoursPerDay: 8, mdLimit: null,
});
const task: TaskRow = { taskId: 7, taskNumber: 'X-9', taskTitle: 'T', projectId: 3, projectName: 'P', projectColor: '#abc', projectKind: 'work', isBillable: true };
const input = { taskId: 7, workDate: '2026-06-01', minutes: 120, reportedMinutes: 90, description: 'note' };

describe('computeDerivedForWrite', () => {
  it('filters contracts to the project and derives via the shared formula', () => {
    const b = computeDerivedForWrite([contract(3), contract(999)], 3, input);
    expect(b.effectiveMinutes).toBe(90);
    expect(b.resolvedRate).toBe(100);
    expect(b.earnedAmount).toBeCloseTo(150);
  });
  it('null rate/earned when no contract for the project', () => {
    const b = computeDerivedForWrite([contract(999)], 3, input);
    expect(b.resolvedRate).toBeNull();
    expect(b.earnedAmount).toBeNull();
  });
});

describe('buildWorklogInsert', () => {
  it('shapes a full insert row: manual source, null external_id, derived merged', () => {
    const b = computeDerivedForWrite([contract(3)], 3, input);
    expect(buildWorklogInsert(input, { syncId: 'w1', now: '2026-06-28T10:00:00.000Z', billing: b })).toEqual({
      sync_id: 'w1', task_id: 7, work_date: '2026-06-01', minutes: 120, reported_minutes: 90,
      description: 'note', source: 'manual', external_id: null, jira_uploaded: false, deleted_at: null,
      updated_at: '2026-06-28T10:00:00.000Z', effective_minutes: 90, resolved_rate: 100, earned_amount: 150,
    });
  });
});

describe('buildWorklogUpdate', () => {
  it('shapes an update row WITHOUT task_id', () => {
    const b = computeDerivedForWrite([contract(3)], 3, input);
    const row = buildWorklogUpdate({ workDate: '2026-06-02', minutes: 60, reportedMinutes: null, description: null }, { now: '2026-06-28T10:00:00.000Z', billing: b });
    expect(row).not.toHaveProperty('task_id');
    expect(row.work_date).toBe('2026-06-02');
    expect(row.updated_at).toBe('2026-06-28T10:00:00.000Z');
    expect(row.effective_minutes).toBe(90);
  });
});

describe('buildWorklogDelete', () => {
  it('soft-deletes via deleted_at + updated_at', () => {
    expect(buildWorklogDelete('2026-06-28T10:00:00.000Z')).toEqual({ deleted_at: '2026-06-28T10:00:00.000Z', updated_at: '2026-06-28T10:00:00.000Z' });
  });
});

describe('buildOptimisticWorklogRow', () => {
  it('builds a denormalized WorklogRow from the picked task', () => {
    const b = computeDerivedForWrite([contract(3)], 3, input);
    const row = buildOptimisticWorklogRow(task, input, b, 'w1');
    expect(row).toEqual({
      syncId: 'w1', workDate: '2026-06-01', minutes: 120, reportedMinutes: 90, effectiveMinutes: 90,
      earnedAmount: 150, description: 'note', projectId: 3, projectName: 'P', projectColor: '#abc',
      projectKind: 'work', isBillable: true, taskNumber: 'X-9', taskTitle: 'T', source: 'manual',
    });
  });
});

describe('applyWorklogWrite', () => {
  const base: WorklogRow = buildOptimisticWorklogRow(task, input, computeDerivedForWrite([contract(3)], 3, input), 'w1');
  it('upsert replaces by syncId', () => {
    const edited = { ...base, minutes: 30 };
    expect(applyWorklogWrite([base], { type: 'upsert', row: edited })).toEqual([edited]);
  });
  it('upsert adds a new syncId', () => {
    const other = { ...base, syncId: 'w2' };
    expect(applyWorklogWrite([base], { type: 'upsert', row: other }).map((w) => w.syncId).sort()).toEqual(['w1', 'w2']);
  });
  it('remove filters by syncId', () => {
    expect(applyWorklogWrite([base], { type: 'remove', syncId: 'w1' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ipad/billingWrites.test.ts`
Expected: FAIL — the new exports don't exist.

- [ ] **Step 3: Implement the shapers + helpers**

Append to `apps/ipad/src/state/billingWrites.ts` (and add imports at the top):

```typescript
import type { DayOffRow, WorklogRow, ContractRow, TaskRow } from '@watchtower/shared/billing/types.js';
import { computeWorklogBilling, type ContractLite, type WorklogBilling } from '@watchtower/shared/billing/worklogBilling.js';
```
(Replace the existing line-1 `import type { DayOffRow } ...` with the widened import above; keep the `BillingState` import.)

```typescript
// --- Worklog write-back (slice 2) -----------------------------------------

export interface WorklogWriteInput {
  taskId: number;
  workDate: string;
  minutes: number;
  reportedMinutes: number | null;
  description: string | null;
}

export interface WorklogInsertRow {
  sync_id: string;
  task_id: number;
  work_date: string;
  minutes: number;
  reported_minutes: number | null;
  description: string | null;
  source: 'manual';
  external_id: null;
  jira_uploaded: false;
  deleted_at: null;
  updated_at: string;
  effective_minutes: number;
  resolved_rate: number | null;
  earned_amount: number | null;
}

export interface WorklogUpdateRow {
  work_date: string;
  minutes: number;
  reported_minutes: number | null;
  description: string | null;
  updated_at: string;
  effective_minutes: number;
  resolved_rate: number | null;
  earned_amount: number | null;
}

/** Derive billing fields for a write, using the same shared formula the Mac uses. */
export function computeDerivedForWrite(
  contracts: ContractRow[],
  projectId: number,
  input: { minutes: number; reportedMinutes: number | null; workDate: string },
): WorklogBilling {
  const lite: ContractLite[] = contracts
    .filter((c) => c.projectId === projectId)
    .map((c) => ({ effectiveFrom: c.effectiveFrom, rateType: c.rateType, rateAmount: c.rateAmount, hoursPerDay: c.hoursPerDay }));
  return computeWorklogBilling({ minutes: input.minutes, reportedMinutes: input.reportedMinutes, workDate: input.workDate, contracts: lite });
}

export function buildWorklogInsert(
  input: WorklogWriteInput,
  opts: { syncId: string; now: string; billing: WorklogBilling },
): WorklogInsertRow {
  return {
    sync_id: opts.syncId,
    task_id: input.taskId,
    work_date: input.workDate,
    minutes: input.minutes,
    reported_minutes: input.reportedMinutes,
    description: input.description,
    source: 'manual',
    external_id: null,
    jira_uploaded: false,
    deleted_at: null,
    updated_at: opts.now,
    effective_minutes: opts.billing.effectiveMinutes,
    resolved_rate: opts.billing.resolvedRate,
    earned_amount: opts.billing.earnedAmount,
  };
}

export function buildWorklogUpdate(
  input: { workDate: string; minutes: number; reportedMinutes: number | null; description: string | null },
  opts: { now: string; billing: WorklogBilling },
): WorklogUpdateRow {
  return {
    work_date: input.workDate,
    minutes: input.minutes,
    reported_minutes: input.reportedMinutes,
    description: input.description,
    updated_at: opts.now,
    effective_minutes: opts.billing.effectiveMinutes,
    resolved_rate: opts.billing.resolvedRate,
    earned_amount: opts.billing.earnedAmount,
  };
}

export function buildWorklogDelete(now: string): { deleted_at: string; updated_at: string } {
  return { deleted_at: now, updated_at: now };
}

export function buildOptimisticWorklogRow(
  task: TaskRow,
  input: WorklogWriteInput,
  billing: WorklogBilling,
  syncId: string,
): WorklogRow {
  return {
    syncId,
    workDate: input.workDate,
    minutes: input.minutes,
    reportedMinutes: input.reportedMinutes,
    effectiveMinutes: billing.effectiveMinutes,
    earnedAmount: billing.earnedAmount,
    description: input.description,
    projectId: task.projectId,
    projectName: task.projectName,
    projectColor: task.projectColor,
    projectKind: task.projectKind,
    isBillable: task.isBillable,
    taskNumber: task.taskNumber,
    taskTitle: task.taskTitle,
    source: 'manual',
  };
}

export function buildEditedWorklogRow(
  existing: WorklogRow,
  input: { workDate: string; minutes: number; reportedMinutes: number | null; description: string | null },
  billing: WorklogBilling,
): WorklogRow {
  return {
    ...existing,
    workDate: input.workDate,
    minutes: input.minutes,
    reportedMinutes: input.reportedMinutes,
    description: input.description,
    effectiveMinutes: billing.effectiveMinutes,
    earnedAmount: billing.earnedAmount,
  };
}

export type WorklogChange =
  | { type: 'upsert'; row: WorklogRow }
  | { type: 'remove'; syncId: string };

export function applyWorklogWrite(worklogs: WorklogRow[], change: WorklogChange): WorklogRow[] {
  if (change.type === 'remove') {
    return worklogs.filter((w) => w.syncId !== change.syncId);
  }
  const without = worklogs.filter((w) => w.syncId !== change.row.syncId);
  return [...without, change.row];
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/ipad/billingWrites.test.ts`
Expected: PASS (all new + existing slice-1 cases).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/billingWrites.ts tests/ipad/billingWrites.test.ts
git commit -m "feat(ipad): worklog write shapers + shared-formula derive + optimistic reducer"
```

---

## Task 7: `useWorklogMutations` client-wired hook

**Files:**
- Create: `apps/ipad/src/state/useWorklogMutations.ts`

**Interfaces:**
- Consumes: `getSupabase`; the Task 6 shapers/helpers; `WorklogRow`, `ContractRow`, `TaskRow`, `WorklogWriteInput`.
- Produces: `useWorklogMutations({ worklogs, contracts, patchWorklogs }): { createWorklog(task, input), updateWorklog(syncId, edit), deleteWorklog(syncId), pending: string | null, error: string | null }`.

This hook is thin glue over the pure, already-tested helpers; it is verified by typecheck (the Supabase client is not exercised in vitest, matching `useDaysOffMutations`).

- [ ] **Step 1: Create the hook**

Create `apps/ipad/src/state/useWorklogMutations.ts`:

```typescript
import { useState, useCallback } from 'react';
import { getSupabase } from '../lib/supabaseClient.js';
import type { WorklogRow, ContractRow, TaskRow } from '@watchtower/shared/billing/types.js';
import {
  computeDerivedForWrite,
  buildWorklogInsert,
  buildWorklogUpdate,
  buildWorklogDelete,
  buildOptimisticWorklogRow,
  buildEditedWorklogRow,
  applyWorklogWrite,
  type WorklogWriteInput,
} from './billingWrites.js';

interface Args {
  worklogs: WorklogRow[];
  contracts: ContractRow[];
  patchWorklogs(next: WorklogRow[]): void;
}

type WorklogEdit = { workDate: string; minutes: number; reportedMinutes: number | null; description: string | null };

export function useWorklogMutations({ worklogs, contracts, patchWorklogs }: Args) {
  const [pending, setPending] = useState<string | null>(null); // syncId being written
  const [error, setError] = useState<string | null>(null);

  const createWorklog = useCallback(
    async (task: TaskRow, input: WorklogWriteInput) => {
      const prev = worklogs;
      const syncId = crypto.randomUUID();
      const now = new Date().toISOString();
      const billing = computeDerivedForWrite(contracts, task.projectId, input);
      setError(null);
      setPending(syncId);
      patchWorklogs(applyWorklogWrite(prev, { type: 'upsert', row: buildOptimisticWorklogRow(task, input, billing, syncId) }));
      try {
        const { error: e } = await getSupabase().from('worklogs').insert(buildWorklogInsert(input, { syncId, now, billing }));
        if (e) throw e;
      } catch (err) {
        patchWorklogs(prev);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [worklogs, contracts, patchWorklogs],
  );

  const updateWorklog = useCallback(
    async (syncId: string, input: WorklogEdit) => {
      const prev = worklogs;
      const existing = prev.find((w) => w.syncId === syncId);
      if (!existing) return;
      const now = new Date().toISOString();
      const billing = computeDerivedForWrite(contracts, existing.projectId, input);
      setError(null);
      setPending(syncId);
      patchWorklogs(applyWorklogWrite(prev, { type: 'upsert', row: buildEditedWorklogRow(existing, input, billing) }));
      try {
        const { error: e } = await getSupabase().from('worklogs').update(buildWorklogUpdate(input, { now, billing })).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchWorklogs(prev);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [worklogs, contracts, patchWorklogs],
  );

  const deleteWorklog = useCallback(
    async (syncId: string) => {
      const prev = worklogs;
      const now = new Date().toISOString();
      setError(null);
      setPending(syncId);
      patchWorklogs(applyWorklogWrite(prev, { type: 'remove', syncId }));
      try {
        const { error: e } = await getSupabase().from('worklogs').update(buildWorklogDelete(now)).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchWorklogs(prev);
        setError(err instanceof Error ? err.message : 'Smazání selhalo');
      } finally {
        setPending(null);
      }
    },
    [worklogs, patchWorklogs],
  );

  return { createWorklog, updateWorklog, deleteWorklog, pending, error };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/state/useWorklogMutations.ts
git commit -m "feat(ipad): useWorklogMutations create/edit/delete hook"
```

---

## Task 8: Editable `WorklogListView` — drawers, task picker, online gating

**Files:**
- Modify: `apps/ipad/src/components/billing/records/WorklogListView.tsx`

**Interfaces:**
- Consumes: `useBilling` (`data`, `state`, `patchWorklogs`), `useWorklogMutations` (incl. its `error` field), `parseMinutes` (shared), `canEdit` (billingWrites), `formatCzk`/`formatHours` (czFormat), `computeDerivedForWrite` (for the live earned preview), `TaskRow`/`WorklogRow`.

This task is UI; it is verified by typecheck + manual run (no unit test). Reuse the **slice-1 error pattern exactly** (`TimeOffView`): the mutations hook returns `error`, rendered inline with the `C.red` token — there is **no** `useToast` in the iPad app. Reuse the slice-1 offline-gating pattern (`canEdit(state)`) and the `C` tokens.

- [ ] **Step 1: Rewrite `WorklogListView` with editing affordances**

Replace `apps/ipad/src/components/billing/records/WorklogListView.tsx` with:

```tsx
import { useState } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { useWorklogMutations } from '../../../state/useWorklogMutations.js';
import { groupWorklogsByDay } from '@watchtower/shared/billing/records/worklog-list.js';
import { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';
import type { TaskRow, WorklogRow } from '@watchtower/shared/billing/types.js';
import { canEdit, computeDerivedForWrite, type WorklogWriteInput } from '../../../state/billingWrites.js';
import { addMonths, czechMonthLabel } from '../../../lib/monthHelpers.js';
import { formatHours, formatDateCz, formatCzk } from '../../../lib/czFormat.js';
import { C } from '../reports/tokens.js';

const SOURCE_LABEL: Record<string, string> = { manual: 'manual', 'watchtower-auto': 'watchtower', 'jira-sync': 'jira' };

type DrawerState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; worklog: WorklogRow };

export function WorklogListView(): JSX.Element {
  const { data, state, patchWorklogs } = useBilling();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const [drawer, setDrawer] = useState<DrawerState>({ mode: 'closed' });

  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];
  const tasks = data?.tasks ?? [];
  const contracts = data?.contracts ?? [];
  const editable = canEdit(state);

  const { createWorklog, updateWorklog, deleteWorklog, error } = useWorklogMutations({ worklogs, contracts, patchWorklogs });

  const days = groupWorklogsByDay(worklogs, { month, projectId });

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: C.ground, minHeight: '100%', color: C.text }}>
      <MonthBar
        month={month}
        onPrev={() => setMonth(addMonths(month, -1))}
        onNext={() => setMonth(addMonths(month, 1))}
        onToday={() => setMonth(new Date().toISOString().slice(0, 7))}
        projects={projects}
        projectId={projectId}
        onProject={setProjectId}
        canAdd={editable}
        onAdd={() => setDrawer({ mode: 'create' })}
      />
      {!editable && (
        <div style={{ padding: '6px 16px', fontSize: 12, color: C.muted }}>jen pro čtení offline</div>
      )}
      {error && (
        <div style={{ padding: '6px 16px', fontSize: 12, color: C.red }}>{error}</div>
      )}
      <div style={{ padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {days.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>žádné záznamy</div>}
        {days.map((d) => (
          <div key={d.date}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{formatDateCz(d.date)}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{formatHours(d.totalMinutes)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {d.entries.map((w) => (
                <button
                  key={w.syncId}
                  onClick={() => editable && setDrawer({ mode: 'edit', worklog: w })}
                  disabled={!editable}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', textAlign: 'left', cursor: editable ? 'pointer' : 'default', fontFamily: 'inherit', color: C.text, width: '100%' }}
                >
                  {w.projectColor && <div style={{ width: 8, height: 8, borderRadius: '50%', background: w.projectColor, flexShrink: 0 }} />}
                  {w.taskNumber && <div style={{ fontFamily: 'monospace', fontSize: 12, color: C.muted, flexShrink: 0 }}>{w.taskNumber}</div>}
                  <div style={{ flex: 1, fontSize: 13, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.taskTitle || w.projectName}</div>
                  {w.source && <div style={{ fontSize: 10, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase', flexShrink: 0 }}>{SOURCE_LABEL[w.source] ?? w.source}</div>}
                  <div style={{ fontSize: 12, color: C.text, flexShrink: 0 }}>
                    {formatHours(w.minutes)}
                    {w.effectiveMinutes !== w.minutes && <span style={{ color: C.muted }}> → {formatHours(w.effectiveMinutes)}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {drawer.mode === 'create' && (
        <WorklogDrawer
          title="Nový záznam"
          tasks={tasks}
          contracts={contracts}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (taskRow, input) => { await createWorklog(taskRow, input); setDrawer({ mode: 'closed' }); }}
        />
      )}
      {drawer.mode === 'edit' && (
        <WorklogDrawer
          title="Upravit záznam"
          tasks={tasks}
          contracts={contracts}
          initial={drawer.worklog}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (_taskRow, input) => { await updateWorklog(drawer.worklog.syncId, input); setDrawer({ mode: 'closed' }); }}
          onDelete={async () => { await deleteWorklog(drawer.worklog.syncId); setDrawer({ mode: 'closed' }); }}
        />
      )}
    </div>
  );
}

function MonthBar({ month, onPrev, onNext, onToday, projects, projectId, onProject, canAdd, onAdd }: {
  month: string; onPrev(): void; onNext(): void; onToday(): void;
  projects: { id: number; name: string }[]; projectId: number | undefined; onProject(id: number | undefined): void;
  canAdd: boolean; onAdd(): void;
}): JSX.Element {
  const btn: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '4px 10px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.ground, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button style={btn} onClick={onPrev}>‹</button>
      <div style={{ fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{czechMonthLabel(month)}</div>
      <button style={btn} onClick={onNext}>›</button>
      <button style={btn} onClick={onToday}>Dnes</button>
      <div style={{ flex: 1 }} />
      <select value={projectId ?? ''} onChange={(e) => onProject(e.target.value === '' ? undefined : Number(e.target.value))} style={{ ...btn }}>
        <option value="">Všechny projekty</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name || '(bez názvu)'}</option>)}
      </select>
      {canAdd && <button style={{ ...btn, background: C.violet, color: '#fff', border: 'none' }} onClick={onAdd}>+ Přidat</button>}
    </div>
  );
}

function WorklogDrawer({ title, tasks, contracts, initial, onClose, onSubmit, onDelete }: {
  title: string;
  tasks: TaskRow[];
  contracts: import('@watchtower/shared/billing/types.js').ContractRow[];
  initial?: WorklogRow;
  onClose(): void;
  onSubmit(task: TaskRow, input: WorklogWriteInput): Promise<void>;
  onDelete?(): Promise<void>;
}): JSX.Element {
  const isEdit = initial != null;
  const [taskId, setTaskId] = useState<number | null>(isEdit ? null : null); // edit keeps the existing task; create picks one
  const [taskQuery, setTaskQuery] = useState('');
  const [date, setDate] = useState(initial?.workDate ?? new Date().toISOString().slice(0, 10));
  const [minutesStr, setMinutesStr] = useState(initial ? String((initial.minutes / 60).toFixed(2)).replace('.', ',') : '');
  const [reportedStr, setReportedStr] = useState(initial?.reportedMinutes != null ? String((initial.reportedMinutes / 60).toFixed(2)).replace('.', ',') : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);

  const minutes = parseMinutes(minutesStr);
  const reported = reportedStr.trim() === '' ? null : parseMinutes(reportedStr);
  const minutesValid = Number.isFinite(minutes) && minutes > 0;
  const reportedValid = reported === null || (Number.isFinite(reported) && reported > 0);

  // Resolve which project/task the preview + write target.
  const pickedTask: TaskRow | null = isEdit
    ? (tasks.find((t) => t.taskId === taskId) ?? null) // null in edit → task unchanged; project comes from initial
    : (tasks.find((t) => t.taskId === taskId) ?? null);
  const projectId = isEdit ? initial!.projectId : pickedTask?.projectId;
  const canSubmit = minutesValid && reportedValid && (isEdit || pickedTask != null) && !saving;

  const previewBilling = projectId != null && minutesValid
    ? computeDerivedForWrite(contracts, projectId, { minutes, reportedMinutes: reported, workDate: date })
    : null;

  const filteredTasks = taskQuery.trim() === ''
    ? tasks.slice(0, 50)
    : tasks.filter((t) => `${t.taskNumber ?? ''} ${t.taskTitle} ${t.projectName}`.toLowerCase().includes(taskQuery.toLowerCase())).slice(0, 50);

  const field: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
  const label: React.CSSProperties = { fontSize: 12, color: C.muted, marginBottom: 4 };

  async function submit() {
    // Edit: reuse the existing task (taskId unchanged); Create: require a picked task.
    const taskRow = isEdit
      ? ({ taskId: 0, taskNumber: initial!.taskNumber, taskTitle: initial!.taskTitle ?? '', projectId: initial!.projectId, projectName: initial!.projectName, projectColor: initial!.projectColor, projectKind: initial!.projectKind, isBillable: initial!.isBillable } as TaskRow)
      : pickedTask!;
    setSaving(true);
    await onSubmit(taskRow, { taskId: taskRow.taskId, workDate: date, minutes, reportedMinutes: reported, description: description.trim() === '' ? null : description.trim() });
    setSaving(false);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.ground, borderTopLeftRadius: 16, borderTopRightRadius: 16, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {!isEdit && (
          <div>
            <div style={label}>Úkol</div>
            <input style={field} placeholder="Hledat úkol…" value={taskQuery} onChange={(e) => setTaskQuery(e.target.value)} />
            <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredTasks.map((t) => (
                <button key={t.taskId} onClick={() => setTaskId(t.taskId)} style={{ ...field, textAlign: 'left', cursor: 'pointer', border: taskId === t.taskId ? `2px solid ${C.violet}` : `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {t.projectColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.projectColor, flexShrink: 0 }} />}
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.muted }}>{t.taskNumber ?? '—'}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.taskTitle}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {isEdit && (
          <div style={{ fontSize: 13, color: C.muted }}>
            {initial!.taskNumber ? `${initial!.taskNumber} · ` : ''}{initial!.taskTitle || initial!.projectName}
          </div>
        )}

        <div>
          <div style={label}>Datum</div>
          <input type="date" style={field} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Čas (např. 1,5 / 1:30 / 1h30m)</div>
            <input style={{ ...field, borderColor: minutesStr && !minutesValid ? C.red : C.border }} value={minutesStr} onChange={(e) => setMinutesStr(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Vykázáno (volitelné)</div>
            <input style={{ ...field, borderColor: reportedStr && !reportedValid ? C.red : C.border }} value={reportedStr} onChange={(e) => setReportedStr(e.target.value)} />
          </div>
        </div>
        <div>
          <div style={label}>Popis (volitelné)</div>
          <input style={field} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {previewBilling && (
          <div style={{ fontSize: 13, color: C.muted }}>
            Výdělek: <span style={{ color: C.text, fontWeight: 600 }}>{previewBilling.earnedAmount != null ? formatCzk(previewBilling.earnedAmount) : '—'}</span>
          </div>
        )}

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

- [ ] **Step 2: Confirm the consumed exports exist**

`czFormat.ts` exports `formatCzk`/`formatHours`/`formatDateCz`; `reports/tokens.ts` `C` includes `red`/`violet`/`muted`/`surface`/`border`/`ground`/`text` (all verified during planning). There is no `useToast` — errors are rendered inline via the hook's `error` + `C.red` (matching `TimeOffView`).

Run: `grep -n "formatCzk\|formatHours\|formatDateCz" apps/ipad/src/lib/czFormat.ts && grep -n "red\|violet" apps/ipad/src/components/billing/reports/tokens.ts`
Expected: all symbols present.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Fix any prop/type mismatches surfaced; the `ContractRow` inline import in `WorklogDrawer` can be hoisted to a top-level `import type` if the inline form is rejected by lint.)

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass (799+ baseline + the new tests).

- [ ] **Step 5: Manual smoke (optional, requires the iPad dev build + Supabase online)**

Build the iPad app and, in Records → Worklogy with a `fresh` dataset: add a worklog (pick a task, enter `1,5`), confirm it appears with the right earned amount; tap it, change minutes, confirm the list updates; delete it, confirm it disappears. Toggle airplane mode → confirm the list is read-only ("jen pro čtení offline", no +Přidat).

- [ ] **Step 6: Commit**

```bash
git add apps/ipad/src/components/billing/records/WorklogListView.tsx
git commit -m "feat(ipad): editable worklog list — create/edit/delete drawers + task picker"
```

---

## Final verification

- [ ] **Run the full suite + typecheck together**

Run: `npm test && npm run typecheck`
Expected: all tests pass; no type errors across shared/transport/electron/orchestrator/desktop/ipad.

- [ ] **Confirm the migration runs idempotently on the live Supabase project** (the orchestrator applies `PG_MIGRATIONS` on startup; v7 is versioned + role-guarded). Verify the next orchestrator run logs the v7 migration once and that authenticated worklog writes succeed.

---

## Self-Review notes (resolved)

- **Spec coverage:** shared derivation (Task 1), shared parseMinutes (Task 2), task-tree cache + worklog read fields (Task 3), patchWorklogs (Task 4), write RLS v7 (Task 5), shapers + derive (Task 6), client hook (Task 7), UI (Task 8). The spec's edit-prefill requirement surfaced a gap — `WorklogRow` lacked `reportedMinutes`/`description`; Task 3 adds both to the read path.
- **Type consistency:** `WorklogBilling` / `ContractLite` names match across Tasks 1, 6, 7; `applyWorklogWrite`'s `WorklogChange` union (`upsert`/`remove`) is used identically in Tasks 6 and 7; `WorklogWriteInput` defined in Task 6, consumed in Tasks 7 and 8.
- **sync_id:** create mints a fresh UUID (Task 7); edit/delete key on the existing `syncId`; no natural-key re-mark path, so no tombstone-inclusive lookup is needed (unlike slice 1).
