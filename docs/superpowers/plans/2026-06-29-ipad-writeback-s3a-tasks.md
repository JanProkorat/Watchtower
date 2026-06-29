# iPad Billing Write-back Slice 3a (Task CRUD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make iPad tasks create/edit/delete-able against Supabase, with a new task-list view, a cached epic tree for the create picker, and the orchestrator's done-task lock replicated client-side.

**Architecture:** Online-direct Supabase writes (no offline outbox), LWW via `updated_at`, soft-delete via `deleted_at` — the slice-1/2 foundation. Tasks have no derived fields and no cross-table ripple, so this is the slice-2 worklog pattern applied to tasks, plus two new pieces: caching `epics` (a task's parent, for the create picker) and a `canEditTask` done-lock. A new `TaskListView` is the surface because `TaskGridView` is worklog-derived and can't show empty/new tasks.

**Tech Stack:** TypeScript, React (plain, inline styles — no MUI), Supabase JS client, `@watchtower/shared` (built composite), Postgres RLS, vitest.

## Global Constraints

- **Online-direct writes only.** Edit controls disabled unless `useBilling` state is `fresh` (`canEdit(state)` from slice 1). No offline outbox.
- **Soft-delete only.** Delete = `UPDATE ... SET deleted_at = now, updated_at = now`. Never a hard `DELETE`.
- **LWW via `updated_at`.** Every write stamps `updated_at = now` (ISO string).
- **Done-lock:** `status='done'` tasks are read-only on the iPad (mirrors the orchestrator's `assertTaskNotDone`); the mutation hook also guards.
- **Writes key on `syncId`** (mint on create, `.eq('sync_id', …)` on edit/delete).
- **apps/ipad:** plain React + inline styles, no MUI; cs-CZ; no i18n; reuse `reports/tokens.ts` `C`; errors surfaced inline via the hook's `error` + `C.red` (the slice-1/2 pattern — there is NO `useToast`).
- **Pure logic unit-tested; Supabase client injected/never hit live; UI + hooks verified by typecheck.**
- **`@watchtower/shared` is a built composite** — vitest resolves it from source; `npm run typecheck` builds it first via `tsc -b` then typechecks all 6 projects. Always verify with `npm run typecheck` (not a bare `tsc -p`).
- Verification commands: `npm test` (vitest, currently 872+ tests — add tests as code is added) and `npm run typecheck` (0 errors across all 6 projects).
- Never edit `.env*`. Branch: `feat/120-writeback-tasks` (already created).
- Source of truth: `docs/superpowers/specs/2026-06-29-ipad-writeback-s3a-tasks-design.md`.

---

## File Structure

- `packages/shared/src/billing/types.ts` — add `EpicRow`; extend `ProjectRow` (`kind`/`isBillable`) and `TaskRow` (`syncId`/`epicId`/`status`/`estimatedMinutes`/`description`).
- `apps/ipad/src/state/billingCache.ts` — `RawEpicRow`/`mapEpicRow`; extend `RawTaskRow`/`mapTaskRow`; `epics` on `BillingDataset`; `loadCache` guard.
- `apps/ipad/src/state/useBilling.ts` — fetch+map epics; widen the tasks select; map `kind`/`isBillable` into `ProjectRow`; `patchTasks` + `PATCH_TASKS`.
- `orchestrator/db/pg/schema.ts` — `PG_MIGRATIONS` v8 (tasks write policy).
- `apps/ipad/src/state/billingWrites.ts` — task shapers + `applyTaskWrite` + `canEditTask`.
- `apps/ipad/src/state/useTaskMutations.ts` — **new**, client-wired CRUD hook.
- `apps/ipad/src/components/billing/records/TaskListView.tsx` — **new**, list + drawers + project→epic picker + online/done gating.
- `apps/ipad/src/components/billing/BillingModule.tsx` + `BillingNav.tsx` — wire the `records-tasks` section.

---

## Task 1: Read additions — EpicRow, ProjectRow/TaskRow fields, dataset.epics

**Files:**
- Modify: `packages/shared/src/billing/types.ts`
- Modify: `apps/ipad/src/state/billingCache.ts`
- Modify: `apps/ipad/src/state/useBilling.ts:90-162`
- Test: `tests/ipad/billingCache.test.ts`

**Interfaces:**
- Produces: `interface EpicRow { epicId: number; name: string; projectId: number; status: string }`; `ProjectRow` gains `kind: string` + `isBillable: boolean`; `TaskRow` gains `syncId: string`, `epicId: number`, `status: string`, `estimatedMinutes: number | null`, `description: string | null`; `BillingDataset` gains `epics: EpicRow[]`; `mapEpicRow(raw: RawEpicRow): EpicRow`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/ipad/billingCache.test.ts`:

```typescript
import { mapEpicRow, mapTaskRow, loadCache } from '../../apps/ipad/src/state/billingCache.js';
import type { RawEpicRow, RawTaskRow } from '../../apps/ipad/src/state/billingCache.js';

describe('mapEpicRow', () => {
  it('maps a raw epic row', () => {
    const raw: RawEpicRow = { id: 5, name: 'Sprint 1', project_id: 3, status: 'active' };
    expect(mapEpicRow(raw)).toEqual({ epicId: 5, name: 'Sprint 1', projectId: 3, status: 'active' });
  });
});

describe('mapTaskRow — slice 3a fields', () => {
  it('maps syncId/epicId/status/estimatedMinutes/description', () => {
    const raw: RawTaskRow = {
      id: 7, sync_id: 't-sync', epic_id: 5, number: 'X-9', title: 'Task nine',
      status: 'in_progress', estimated_minutes: 120, description: 'do it',
      epics: { projects: { id: 3, name: 'Proj', color: '#abc', kind: 'work', is_billable: true } },
    };
    expect(mapTaskRow(raw)).toEqual({
      taskId: 7, syncId: 't-sync', epicId: 5, taskNumber: 'X-9', taskTitle: 'Task nine',
      status: 'in_progress', estimatedMinutes: 120, description: 'do it',
      projectId: 3, projectName: 'Proj', projectColor: '#abc', projectKind: 'work', isBillable: true,
    });
  });
  it('defaults estimatedMinutes/description to null and status to empty', () => {
    const raw: RawTaskRow = {
      id: 8, sync_id: 's8', epic_id: 1, number: null, title: null,
      status: 'open', estimated_minutes: null, description: null, epics: null,
    };
    const r = mapTaskRow(raw);
    expect(r.estimatedMinutes).toBeNull();
    expect(r.description).toBeNull();
    expect(r.taskTitle).toBe('');
  });
});

describe('loadCache — slice 3a shape guard', () => {
  it('rejects a cache without an epics array (forces refetch)', async () => {
    const store = new Map<string, string>();
    const legacy = { worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], fetchedAt: '2026-06-01T00:00:00Z' };
    store.set('watchtower.ipad.billing.cache', JSON.stringify(legacy));
    const adapter = { get: async (k: string) => store.get(k) ?? null, set: async () => {} };
    expect(await loadCache(adapter)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ipad/billingCache.test.ts`
Expected: FAIL — `mapEpicRow`/`RawEpicRow` not exported; `mapTaskRow` missing new fields; legacy cache still returns non-null.

- [ ] **Step 3: Extend shared types**

In `packages/shared/src/billing/types.ts`:

Replace the `TaskRow` interface with:
```typescript
export interface TaskRow {
  taskId: number;
  syncId: string;
  epicId: number;
  taskNumber: string | null;
  taskTitle: string;
  status: string;
  estimatedMinutes: number | null;
  description: string | null;
  projectId: number;
  projectName: string;
  projectColor: string | null;
  projectKind: string;
  isBillable: boolean;
}
```

Replace the `ProjectRow` line with:
```typescript
export interface ProjectRow { id: number; name: string; color: string | null; kind: string; isBillable: boolean }

export interface EpicRow { epicId: number; name: string; projectId: number; status: string }
```

- [ ] **Step 4: Extend the cache mappers + dataset + guard**

In `apps/ipad/src/state/billingCache.ts`:

1. Add `EpicRow` to the type import on line 1:
```typescript
import type { WorklogRow, ContractRow, DayOffRow, ProjectRow, TaskRow, EpicRow } from '@watchtower/shared/billing/types.js';
```
2. Add `epics` to `BillingDataset`:
```typescript
export interface BillingDataset {
  worklogs: WorklogRow[];
  contracts: ContractRow[];
  daysOff: DayOffRow[];
  projects: ProjectRow[];
  tasks: TaskRow[];
  epics: EpicRow[];
  fetchedAt: string; // ISO timestamp
}
```
3. Extend `RawTaskRow` with the new columns:
```typescript
export type RawTaskRow = {
  id: number;
  sync_id: string;
  epic_id: number;
  number: string | null;
  title: string | null;
  status: string;
  estimated_minutes: number | null;
  description: string | null;
  epics: { projects: RawProject | null } | null;
};
```
4. Replace `mapTaskRow` with:
```typescript
export function mapTaskRow(raw: RawTaskRow): TaskRow {
  const proj = raw.epics?.projects ?? null;
  return {
    taskId: raw.id,
    syncId: raw.sync_id,
    epicId: raw.epic_id,
    taskNumber: raw.number ?? null,
    taskTitle: raw.title ?? '',
    status: raw.status,
    estimatedMinutes: raw.estimated_minutes ?? null,
    description: raw.description ?? null,
    projectId: proj?.id ?? 0,
    projectName: proj?.name ?? '',
    projectColor: proj?.color ?? null,
    projectKind: proj?.kind ?? '',
    isBillable: proj?.is_billable ?? false,
  };
}
```
5. Add the epic mapper after `mapTaskRow`:
```typescript
export type RawEpicRow = { id: number; name: string; project_id: number; status: string };

export function mapEpicRow(raw: RawEpicRow): EpicRow {
  return { epicId: raw.id, name: raw.name, projectId: raw.project_id, status: raw.status };
}
```
6. Extend the `loadCache` shape guard to require `epics`:
```typescript
    if (
      Array.isArray(v?.worklogs) &&
      Array.isArray(v?.contracts) &&
      Array.isArray(v?.daysOff) &&
      Array.isArray(v?.projects) &&
      Array.isArray(v?.tasks) &&
      Array.isArray(v?.epics) &&
      typeof v?.fetchedAt === 'string'
    ) {
      return v;
    }
```

- [ ] **Step 5: Fetch+map epics, widen the tasks select, map ProjectRow fields**

In `apps/ipad/src/state/useBilling.ts`:

1. Add `EpicRow` to the shared type import (line 3):
```typescript
import type { ContractRow, DayOffRow, ProjectRow, TaskRow, WorklogRow, EpicRow } from '@watchtower/shared/billing/types.js';
```
2. Add `mapEpicRow`/`RawEpicRow` to the billingCache import block:
```typescript
import {
  mapWorklogRow,
  mapDayOffRow,
  mapTaskRow,
  mapEpicRow,
  loadCache,
  saveCache,
  type BillingDataset,
  type BillingStore,
  type RawWorklogRow,
  type RawDayOffRow,
  type RawTaskRow,
  type RawEpicRow,
} from './billingCache.js';
```
3. Widen the tasks select (line 112) to include the new columns:
```typescript
        .select('id,sync_id,epic_id,number,title,status,estimated_minutes,description,epics(projects(id,name,color,kind,is_billable))')
```
4. Add an `epicsPromise` after `tasksPromise`:
```typescript
  const epicsPromise = fetchAllPaged<RawEpicRow>(
    (from, to) =>
      supabase
        .from('epics')
        .select('id,name,project_id,status')
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<RawEpicRow>>,
  );
```
5. Add `epicsPromise`/`epicsRaw` to the `Promise.all` (as the 6th element):
```typescript
  const [worklogsRaw, contractsResult, daysOffResult, projectsResult, tasksRaw, epicsRaw] = await Promise.all([
    worklogsPromise,
    /* contracts */ supabase.from('contracts').select('project_id,effective_from,end_date,rate_type,rate_amount,hours_per_day,md_limit').is('deleted_at', null),
    supabase.from('days_off').select('date,kind,sync_id').is('deleted_at', null),
    supabase.from('projects').select('id,name,color,kind,is_billable').is('deleted_at', null),
    tasksPromise,
    epicsPromise,
  ]);
```
6. Map `kind`/`isBillable` into `ProjectRow` (replace the projects map):
```typescript
  const projects: ProjectRow[] = (projectsResult.data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any): ProjectRow => ({ id: r.id, name: r.name, color: r.color ?? null, kind: r.kind, isBillable: r.is_billable }),
  );
```
7. Map epics and add to the returned dataset:
```typescript
  const epics: EpicRow[] = epicsRaw.map((r) => mapEpicRow(r));

  return {
    worklogs,
    contracts,
    daysOff,
    projects,
    tasks,
    epics,
    fetchedAt: new Date().toISOString(),
  };
```

- [ ] **Step 6: Run tests + typecheck; fix broken dataset/ProjectRow literals**

Run: `npx vitest run tests/ipad/billingCache.test.ts`
Expected: PASS (new + existing cases).

Run: `npm run typecheck`
Expected: errors in test files that construct `BillingDataset` literals (now need `epics: []`) or `ProjectRow`/`TaskRow` literals (now need the new required fields). Fix every one: search `grep -rn "fetchedAt:" tests/` and add `epics: []`; search for `ProjectRow`/`TaskRow` object literals in `tests/ipad/` (e.g. `tests/ipad/useBilling.test.ts`, `tests/ipad/billingWrites.test.ts`, `tests/ipad/billingCache.test.ts`) and add the new required fields (`kind`/`isBillable` on projects; `syncId`/`epicId`/`status`/`estimatedMinutes`/`description` on tasks). Re-run until `npm run typecheck` → 0 errors and `npx vitest run tests/ipad/` is green.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/billing/types.ts apps/ipad/src/state/billingCache.ts apps/ipad/src/state/useBilling.ts tests/ipad/
git commit -m "feat(ipad): cache epics + extend task/project read fields for task write-back"
```

---

## Task 2: `patchTasks` optimistic cache patch

**Files:**
- Modify: `apps/ipad/src/state/useBilling.ts`
- Test: `tests/ipad/useBilling.test.ts`

**Interfaces:**
- Consumes: `TaskRow` (shared), `billingReducer`.
- Produces: `BillingAction` gains `{ type: 'PATCH_TASKS'; tasks: TaskRow[] }`; `BillingHookResult` gains `patchTasks(next: TaskRow[]): void`.

- [ ] **Step 1: Write the failing test**

Add to `tests/ipad/useBilling.test.ts`:

```typescript
import type { TaskRow } from '@watchtower/shared/billing/types.js';

describe('billingReducer — PATCH_TASKS', () => {
  const tk = (syncId: string): TaskRow => ({
    taskId: 1, syncId, epicId: 1, taskNumber: 'T-1', taskTitle: 'T', status: 'open',
    estimatedMinutes: null, description: null, projectId: 1, projectName: 'P',
    projectColor: null, projectKind: 'work', isBillable: true,
  });
  it('swaps tasks in the existing dataset', () => {
    const start = { data: { worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [tk('a')], epics: [], fetchedAt: 'x' }, state: 'fresh' as const, lastUpdated: 'x' };
    const next = billingReducer(start, { type: 'PATCH_TASKS', tasks: [tk('a'), tk('b')] });
    expect(next.data?.tasks.map((t) => t.syncId)).toEqual(['a', 'b']);
  });
  it('is a no-op when there is no data', () => {
    const start = { data: null, state: 'offline' as const, lastUpdated: null };
    expect(billingReducer(start, { type: 'PATCH_TASKS', tasks: [tk('a')] })).toBe(start);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ipad/useBilling.test.ts`
Expected: FAIL — `PATCH_TASKS` not in the action union.

- [ ] **Step 3: Implement the reducer action + hook method**

In `apps/ipad/src/state/useBilling.ts`:

1. Extend `BillingHookResult` (after `patchWorklogs`):
```typescript
  patchTasks(next: TaskRow[]): void;
```
2. Extend `BillingAction`:
```typescript
  | { type: 'PATCH_WORKLOGS'; worklogs: WorklogRow[] }
  | { type: 'PATCH_TASKS'; tasks: TaskRow[] };
```
3. Add the reducer case (next to `PATCH_WORKLOGS`):
```typescript
    case 'PATCH_TASKS':
      return prev.data ? { ...prev, data: { ...prev.data, tasks: action.tasks } } : prev;
```
4. Add the callback and return it:
```typescript
  const patchTasks = useCallback((next: TaskRow[]) => dispatch({ type: 'PATCH_TASKS', tasks: next }), [dispatch]);
```
```typescript
  return {
    data: bState.data,
    state: bState.state,
    lastUpdated: bState.lastUpdated,
    refresh,
    patchDaysOff,
    patchWorklogs,
    patchTasks,
  };
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/ipad/useBilling.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/useBilling.ts tests/ipad/useBilling.test.ts
git commit -m "feat(ipad): patchTasks optimistic cache patch"
```

---

## Task 3: Postgres write RLS — `PG_MIGRATIONS` v8 (tasks)

**Files:**
- Modify: `orchestrator/db/pg/schema.ts` (append v8 to `PG_MIGRATIONS`)
- Test: `tests/orchestrator/pgMigrations.writeback.test.ts`

**Interfaces:**
- Produces: a `{ version: 8, up: string[] }` entry creating a guarded `write_authenticated` `FOR ALL` policy on `tasks`.

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator/pgMigrations.writeback.test.ts`:

```typescript
describe('PG_MIGRATIONS v8 — tasks write policy', () => {
  it('adds a version-8 migration', () => {
    expect(PG_MIGRATIONS.find((m) => m.version === 8)).toBeDefined();
  });
  it('creates a guarded write_authenticated policy for tasks (FOR ALL)', () => {
    const sql = PG_MIGRATIONS.find((m) => m.version === 8)!.up.join('\n');
    expect(sql).toContain('tasks');
    expect(sql).toContain('write_authenticated');
    expect(sql).toContain('FOR ALL TO authenticated');
    expect(sql).toContain('DROP POLICY IF EXISTS write_authenticated ON tasks');
    expect(sql).toContain("rolname = 'authenticated'");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/orchestrator/pgMigrations.writeback.test.ts`
Expected: FAIL — v8 not found.

- [ ] **Step 3: Append v8 to `PG_MIGRATIONS`**

In `orchestrator/db/pg/schema.ts`, add a new entry after the v7 object (before the closing `];` of `PG_MIGRATIONS`):

```typescript
  {
    version: 8,
    up: [
      // Write-back slice 3a: allow authenticated INSERT/UPDATE on tasks (soft-delete
      // is an UPDATE). Mirrors v6/v7: idempotent + role-guarded so plain Postgres
      // (dev/test, no `authenticated` role) still applies cleanly.
      `ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_authenticated ON tasks;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
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
git commit -m "feat(sync): PG_MIGRATIONS v8 — tasks write RLS policy"
```

---

## Task 4: Task write shapers + `applyTaskWrite` + `canEditTask`

**Files:**
- Modify: `apps/ipad/src/state/billingWrites.ts`
- Test: `tests/ipad/billingWrites.test.ts`

**Interfaces:**
- Consumes: `TaskRow`, `ProjectRow` (shared).
- Produces:
  - `interface TaskWriteInput { epicId: number; number: string; title: string; status: string; estimatedMinutes: number | null; description: string | null }`
  - `buildTaskInsert(input: TaskWriteInput, opts: { syncId: string; now: string }): TaskInsertRow`
  - `buildTaskUpdate(input: TaskWriteInput, opts: { now: string }): TaskUpdateRow`
  - `buildTaskDelete(now: string): { deleted_at: string; updated_at: string }`
  - `buildOptimisticTaskRow(input: TaskWriteInput, opts: { syncId: string; taskId: number; project: ProjectRow }): TaskRow`
  - `buildEditedTaskRow(existing: TaskRow, input: TaskWriteInput, project: ProjectRow): TaskRow`
  - `applyTaskWrite(tasks: TaskRow[], change: TaskChange): TaskRow[]` where `TaskChange = { type: 'upsert'; row: TaskRow } | { type: 'remove'; syncId: string }`
  - `canEditTask(status: string): boolean`

- [ ] **Step 1: Write the failing tests**

Add to `tests/ipad/billingWrites.test.ts`:

```typescript
import {
  buildTaskInsert, buildTaskUpdate, buildTaskDelete,
  buildOptimisticTaskRow, buildEditedTaskRow, applyTaskWrite, canEditTask,
} from '../../apps/ipad/src/state/billingWrites.js';
import type { ProjectRow, TaskRow as TaskRowT } from '@watchtower/shared/billing/types.js';

const project: ProjectRow = { id: 3, name: 'Proj', color: '#abc', kind: 'work', isBillable: true };
const taskInput = { epicId: 5, number: 'X-9', title: 'Nine', status: 'open', estimatedMinutes: 120, description: 'note' };

describe('buildTaskInsert', () => {
  it('shapes a full insert row (sync_id, epic_id, status, tombstone clear, stamped updated_at; no jira_* / created_at)', () => {
    expect(buildTaskInsert(taskInput, { syncId: 't1', now: '2026-06-29T10:00:00.000Z' })).toEqual({
      sync_id: 't1', epic_id: 5, number: 'X-9', title: 'Nine', status: 'open',
      estimated_minutes: 120, description: 'note', deleted_at: null, updated_at: '2026-06-29T10:00:00.000Z',
    });
  });
});

describe('buildTaskUpdate', () => {
  it('shapes an update row WITHOUT sync_id; includes epic_id (reparent) + stamped updated_at', () => {
    const row = buildTaskUpdate(taskInput, { now: '2026-06-29T10:00:00.000Z' });
    expect(row).not.toHaveProperty('sync_id');
    expect(row).toEqual({
      epic_id: 5, number: 'X-9', title: 'Nine', status: 'open',
      estimated_minutes: 120, description: 'note', updated_at: '2026-06-29T10:00:00.000Z',
    });
  });
});

describe('buildTaskDelete', () => {
  it('soft-deletes via deleted_at + updated_at', () => {
    expect(buildTaskDelete('2026-06-29T10:00:00.000Z')).toEqual({ deleted_at: '2026-06-29T10:00:00.000Z', updated_at: '2026-06-29T10:00:00.000Z' });
  });
});

describe('buildOptimisticTaskRow', () => {
  it('builds a denormalized TaskRow from input + picked project', () => {
    expect(buildOptimisticTaskRow(taskInput, { syncId: 't1', taskId: 0, project })).toEqual({
      taskId: 0, syncId: 't1', epicId: 5, taskNumber: 'X-9', taskTitle: 'Nine', status: 'open',
      estimatedMinutes: 120, description: 'note', projectId: 3, projectName: 'Proj',
      projectColor: '#abc', projectKind: 'work', isBillable: true,
    });
  });
});

describe('buildEditedTaskRow', () => {
  it('preserves taskId/syncId, updates mutable fields + project refs', () => {
    const existing: TaskRowT = buildOptimisticTaskRow(taskInput, { syncId: 't1', taskId: 42, project });
    const edited = buildEditedTaskRow(existing, { ...taskInput, title: 'Renamed', status: 'in_progress' }, project);
    expect(edited.taskId).toBe(42);
    expect(edited.syncId).toBe('t1');
    expect(edited.taskTitle).toBe('Renamed');
    expect(edited.status).toBe('in_progress');
  });
});

describe('applyTaskWrite', () => {
  const base: TaskRowT = buildOptimisticTaskRow(taskInput, { syncId: 't1', taskId: 42, project });
  it('upsert replaces by syncId', () => {
    const edited = { ...base, taskTitle: 'X' };
    expect(applyTaskWrite([base], { type: 'upsert', row: edited })).toEqual([edited]);
  });
  it('upsert adds a new syncId', () => {
    const other = { ...base, syncId: 't2' };
    expect(applyTaskWrite([base], { type: 'upsert', row: other }).map((t) => t.syncId).sort()).toEqual(['t1', 't2']);
  });
  it('remove filters by syncId', () => {
    expect(applyTaskWrite([base], { type: 'remove', syncId: 't1' })).toEqual([]);
  });
});

describe('canEditTask', () => {
  it('locks done tasks', () => {
    expect(canEditTask('done')).toBe(false);
    expect(canEditTask('open')).toBe(true);
    expect(canEditTask('in_progress')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ipad/billingWrites.test.ts`
Expected: FAIL — the new exports don't exist.

- [ ] **Step 3: Implement the shapers + helpers**

Append to `apps/ipad/src/state/billingWrites.ts`. First widen the shared-types import at the top of the file to also import `ProjectRow` (it currently imports `DayOffRow, WorklogRow, ContractRow, TaskRow`):
```typescript
import type { DayOffRow, WorklogRow, ContractRow, TaskRow, ProjectRow } from '@watchtower/shared/billing/types.js';
```

Then append:
```typescript
// --- Task write-back (slice 3a) -------------------------------------------

export interface TaskWriteInput {
  epicId: number;
  number: string;
  title: string;
  status: string;
  estimatedMinutes: number | null;
  description: string | null;
}

export interface TaskInsertRow {
  sync_id: string;
  epic_id: number;
  number: string;
  title: string;
  status: string;
  estimated_minutes: number | null;
  description: string | null;
  deleted_at: null;
  updated_at: string;
}

export interface TaskUpdateRow {
  epic_id: number;
  number: string;
  title: string;
  status: string;
  estimated_minutes: number | null;
  description: string | null;
  updated_at: string;
}

export function buildTaskInsert(input: TaskWriteInput, opts: { syncId: string; now: string }): TaskInsertRow {
  return {
    sync_id: opts.syncId,
    epic_id: input.epicId,
    number: input.number,
    title: input.title,
    status: input.status,
    estimated_minutes: input.estimatedMinutes,
    description: input.description,
    deleted_at: null,
    updated_at: opts.now,
  };
}

export function buildTaskUpdate(input: TaskWriteInput, opts: { now: string }): TaskUpdateRow {
  return {
    epic_id: input.epicId,
    number: input.number,
    title: input.title,
    status: input.status,
    estimated_minutes: input.estimatedMinutes,
    description: input.description,
    updated_at: opts.now,
  };
}

export function buildTaskDelete(now: string): { deleted_at: string; updated_at: string } {
  return { deleted_at: now, updated_at: now };
}

export function buildOptimisticTaskRow(
  input: TaskWriteInput,
  opts: { syncId: string; taskId: number; project: ProjectRow },
): TaskRow {
  return {
    taskId: opts.taskId,
    syncId: opts.syncId,
    epicId: input.epicId,
    taskNumber: input.number,
    taskTitle: input.title,
    status: input.status,
    estimatedMinutes: input.estimatedMinutes,
    description: input.description,
    projectId: opts.project.id,
    projectName: opts.project.name,
    projectColor: opts.project.color,
    projectKind: opts.project.kind,
    isBillable: opts.project.isBillable,
  };
}

export function buildEditedTaskRow(existing: TaskRow, input: TaskWriteInput, project: ProjectRow): TaskRow {
  return {
    ...existing,
    epicId: input.epicId,
    taskNumber: input.number,
    taskTitle: input.title,
    status: input.status,
    estimatedMinutes: input.estimatedMinutes,
    description: input.description,
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color,
    projectKind: project.kind,
    isBillable: project.isBillable,
  };
}

export type TaskChange =
  | { type: 'upsert'; row: TaskRow }
  | { type: 'remove'; syncId: string };

export function applyTaskWrite(tasks: TaskRow[], change: TaskChange): TaskRow[] {
  if (change.type === 'remove') {
    return tasks.filter((t) => t.syncId !== change.syncId);
  }
  const without = tasks.filter((t) => t.syncId !== change.row.syncId);
  return [...without, change.row];
}

/** The orchestrator locks done tasks (assertTaskNotDone); the iPad mirrors it. */
export function canEditTask(status: string): boolean {
  return status !== 'done';
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/ipad/billingWrites.test.ts`
Expected: PASS (new + existing day-off/worklog cases).

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/billingWrites.ts tests/ipad/billingWrites.test.ts
git commit -m "feat(ipad): task write shapers + applyTaskWrite + done-lock predicate"
```

---

## Task 5: `useTaskMutations` client-wired hook

**Files:**
- Create: `apps/ipad/src/state/useTaskMutations.ts`

**Interfaces:**
- Consumes: `getSupabase`; the Task 4 shapers/helpers; `TaskRow`, `EpicRow`, `ProjectRow`, `TaskWriteInput`.
- Produces: `useTaskMutations({ tasks, epics, projects, patchTasks }): { createTask(input), updateTask(syncId, input), deleteTask(syncId), pending: string | null, error: string | null }`.

This hook is thin glue over the pure, already-tested helpers; like `useWorklogMutations` it is verified by `npm run typecheck` (the Supabase client is not exercised in vitest).

- [ ] **Step 1: Create the hook**

Create `apps/ipad/src/state/useTaskMutations.ts`:

```typescript
import { useState, useCallback } from 'react';
import { getSupabase } from '../lib/supabaseClient.js';
import type { TaskRow, EpicRow, ProjectRow } from '@watchtower/shared/billing/types.js';
import {
  buildTaskInsert,
  buildTaskUpdate,
  buildTaskDelete,
  buildOptimisticTaskRow,
  buildEditedTaskRow,
  applyTaskWrite,
  canEditTask,
  type TaskWriteInput,
} from './billingWrites.js';

interface Args {
  tasks: TaskRow[];
  epics: EpicRow[];
  projects: ProjectRow[];
  patchTasks(next: TaskRow[]): void;
}

export function useTaskMutations({ tasks, epics, projects, patchTasks }: Args) {
  const [pending, setPending] = useState<string | null>(null); // syncId being written
  const [error, setError] = useState<string | null>(null);

  const resolveProject = useCallback(
    (epicId: number): ProjectRow | null => {
      const epic = epics.find((e) => e.epicId === epicId);
      if (!epic) return null;
      return projects.find((p) => p.id === epic.projectId) ?? null;
    },
    [epics, projects],
  );

  const createTask = useCallback(
    async (input: TaskWriteInput) => {
      const prev = tasks;
      const project = resolveProject(input.epicId);
      if (!project) {
        setError('Projekt nenalezen');
        return;
      }
      const syncId = crypto.randomUUID();
      const now = new Date().toISOString();
      setError(null);
      setPending(syncId);
      const optimistic = applyTaskWrite(prev, {
        type: 'upsert',
        row: buildOptimisticTaskRow(input, { syncId, taskId: 0, project }),
      });
      patchTasks(optimistic);
      try {
        const { data, error: e } = await getSupabase()
          .from('tasks')
          .insert(buildTaskInsert(input, { syncId, now }))
          .select('id')
          .single();
        if (e) throw e;
        const realId = (data as { id: number } | null)?.id;
        if (realId) {
          patchTasks(
            applyTaskWrite(optimistic, {
              type: 'upsert',
              row: buildOptimisticTaskRow(input, { syncId, taskId: realId, project }),
            }),
          );
        }
      } catch (err) {
        patchTasks(prev);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [tasks, resolveProject, patchTasks],
  );

  const updateTask = useCallback(
    async (syncId: string, input: TaskWriteInput) => {
      const prev = tasks;
      const existing = prev.find((t) => t.syncId === syncId);
      if (!existing) return;
      if (!canEditTask(existing.status)) {
        setError('Úkol je uzavřen (Hotovo)');
        return;
      }
      const project = resolveProject(input.epicId);
      if (!project) {
        setError('Projekt nenalezen');
        return;
      }
      const now = new Date().toISOString();
      setError(null);
      setPending(syncId);
      patchTasks(applyTaskWrite(prev, { type: 'upsert', row: buildEditedTaskRow(existing, input, project) }));
      try {
        const { error: e } = await getSupabase().from('tasks').update(buildTaskUpdate(input, { now })).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchTasks(prev);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [tasks, resolveProject, patchTasks],
  );

  const deleteTask = useCallback(
    async (syncId: string) => {
      const prev = tasks;
      const existing = prev.find((t) => t.syncId === syncId);
      if (!existing) return;
      if (!canEditTask(existing.status)) {
        setError('Úkol je uzavřen (Hotovo)');
        return;
      }
      const now = new Date().toISOString();
      setError(null);
      setPending(syncId);
      patchTasks(applyTaskWrite(prev, { type: 'remove', syncId }));
      try {
        const { error: e } = await getSupabase().from('tasks').update(buildTaskDelete(now)).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchTasks(prev);
        setError(err instanceof Error ? err.message : 'Smazání selhalo');
      } finally {
        setPending(null);
      }
    },
    [tasks, patchTasks],
  );

  return { createTask, updateTask, deleteTask, pending, error };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/state/useTaskMutations.ts
git commit -m "feat(ipad): useTaskMutations create/edit/delete hook"
```

---

## Task 6: `TaskListView` — list + drawers + project→epic picker + nav wiring

**Files:**
- Create: `apps/ipad/src/components/billing/records/TaskListView.tsx`
- Modify: `apps/ipad/src/components/billing/BillingModule.tsx`
- Modify: `apps/ipad/src/components/billing/BillingNav.tsx`

**Interfaces:**
- Consumes: `useBilling` (`data`, `state`, `patchTasks`), `useTaskMutations` (incl. `error`), `canEdit`/`canEditTask` (billingWrites), `parseMinutes` (shared), `C` tokens, `TaskRow`/`EpicRow`/`ProjectRow`/`TaskWriteInput`.

This task is UI; verified by `npm run typecheck` + the full `npm test` suite (no component unit test — matches the rest of the iPad UI).

- [ ] **Step 1: Wire the new Records section into the nav + module**

In `apps/ipad/src/components/billing/BillingNav.tsx`:
1. Extend the `BillingSection` union:
```typescript
export type BillingSection =
  | 'dashboard' | 'earnings' | 'reports'
  | 'records-list' | 'records-grid' | 'records-tasks' | 'records-timeoff';
```
2. Add the item to `RECORDS` (after `records-grid`):
```typescript
const RECORDS: { id: BillingSection; label: string }[] = [
  { id: 'records-list', label: 'Seznam' },
  { id: 'records-grid', label: 'Mřížka' },
  { id: 'records-tasks', label: 'Úkoly' },
  { id: 'records-timeoff', label: 'Volno' },
];
```

In `apps/ipad/src/components/billing/BillingModule.tsx`:
1. Import the view (after the `TaskGridView` import):
```typescript
import { TaskListView } from './records/TaskListView.js';
```
2. Render it (after the `records-grid` line):
```typescript
        {section === 'records-tasks' && <TaskListView />}
```

- [ ] **Step 2: Create `TaskListView`**

Create `apps/ipad/src/components/billing/records/TaskListView.tsx`:

```tsx
import { useState, useMemo } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { useTaskMutations } from '../../../state/useTaskMutations.js';
import { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';
import type { TaskRow, EpicRow, ProjectRow } from '@watchtower/shared/billing/types.js';
import { canEdit, canEditTask, type TaskWriteInput } from '../../../state/billingWrites.js';
import { C } from '../reports/tokens.js';

const STATUS_LABEL: Record<string, string> = {
  open: 'Otevřený', in_progress: 'Probíhá', to_accept: 'K akceptaci', done: 'Hotovo',
};
const STATUS_OPTIONS = ['open', 'in_progress', 'to_accept', 'done'];

type DrawerState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; task: TaskRow };

export function TaskListView(): JSX.Element {
  const { data, state, patchTasks } = useBilling();
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<DrawerState>({ mode: 'closed' });

  const tasks = data?.tasks ?? [];
  const epics = data?.epics ?? [];
  const projects = data?.projects ?? [];
  const editable = canEdit(state);

  const { createTask, updateTask, deleteTask, error } = useTaskMutations({ tasks, epics, projects, patchTasks });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q === ''
      ? tasks
      : tasks.filter((t) => `${t.taskNumber ?? ''} ${t.taskTitle} ${t.projectName}`.toLowerCase().includes(q));
    return [...rows].sort((a, b) => a.projectName.localeCompare(b.projectName) || a.taskTitle.localeCompare(b.taskTitle));
  }, [tasks, query]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: C.ground, minHeight: '100%', color: C.text }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.ground, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="Hledat úkol…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 140, background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit' }} />
        {editable && <button onClick={() => setDrawer({ mode: 'create' })} style={{ background: C.violet, color: '#fff', border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>+ Přidat úkol</button>}
      </div>
      {!editable && <div style={{ padding: '6px 16px', fontSize: 12, color: C.muted }}>jen pro čtení offline</div>}
      {error && <div style={{ padding: '6px 16px', fontSize: 12, color: C.red }}>{error}</div>}

      <div style={{ padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>žádné úkoly</div>}
        {filtered.map((t) => (
          <button
            key={t.syncId}
            onClick={() => editable && setDrawer({ mode: 'edit', task: t })}
            disabled={!editable}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', textAlign: 'left', cursor: editable ? 'pointer' : 'default', fontFamily: 'inherit', color: C.text, width: '100%' }}
          >
            {t.projectColor && <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.projectColor, flexShrink: 0 }} />}
            {t.taskNumber && <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.muted, flexShrink: 0 }}>{t.taskNumber}</span>}
            <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.taskTitle || '(bez názvu)'}</span>
            <span style={{ fontSize: 10, color: t.status === 'done' ? C.muted : C.violet, border: `1px solid ${C.border}`, borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>{STATUS_LABEL[t.status] ?? t.status}</span>
          </button>
        ))}
      </div>

      {drawer.mode === 'create' && (
        <TaskDrawer
          title="Nový úkol"
          epics={epics}
          projects={projects}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (input) => { await createTask(input); setDrawer({ mode: 'closed' }); }}
        />
      )}
      {drawer.mode === 'edit' && (
        <TaskDrawer
          title="Upravit úkol"
          epics={epics}
          projects={projects}
          initial={drawer.task}
          readOnly={!canEditTask(drawer.task.status)}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (input) => { await updateTask(drawer.task.syncId, input); setDrawer({ mode: 'closed' }); }}
          onDelete={async () => { await deleteTask(drawer.task.syncId); setDrawer({ mode: 'closed' }); }}
        />
      )}
    </div>
  );
}

function TaskDrawer({ title, epics, projects, initial, readOnly, onClose, onSubmit, onDelete }: {
  title: string;
  epics: EpicRow[];
  projects: ProjectRow[];
  initial?: TaskRow;
  readOnly?: boolean;
  onClose(): void;
  onSubmit(input: TaskWriteInput): Promise<void>;
  onDelete?(): Promise<void>;
}): JSX.Element {
  const [epicId, setEpicId] = useState<number | null>(initial ? initial.epicId : null);
  const [number, setNumber] = useState(initial?.taskNumber ?? '');
  const [title2, setTitle2] = useState(initial?.taskTitle ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'open');
  const [estimateStr, setEstimateStr] = useState(initial?.estimatedMinutes != null ? String((initial.estimatedMinutes / 60).toFixed(2)).replace('.', ',') : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);

  const estimate = estimateStr.trim() === '' ? null : parseMinutes(estimateStr);
  const estimateValid = estimate === null || (Number.isFinite(estimate) && estimate > 0);
  const canSubmit = !readOnly && epicId != null && number.trim() !== '' && title2.trim() !== '' && estimateValid && !saving;

  const field: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
  const label: React.CSSProperties = { fontSize: 12, color: C.muted, marginBottom: 4 };

  // Epics grouped by project for the picker.
  const grouped = projects
    .map((p) => ({ project: p, epics: epics.filter((e) => e.projectId === p.id) }))
    .filter((g) => g.epics.length > 0);

  async function submit() {
    if (epicId == null) return;
    setSaving(true);
    await onSubmit({
      epicId,
      number: number.trim(),
      title: title2.trim(),
      status,
      estimatedMinutes: estimate,
      description: description.trim() === '' ? null : description.trim(),
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

        {readOnly && <div style={{ fontSize: 12, color: C.muted }}>Úkol je uzavřen (Hotovo) — jen pro čtení.</div>}

        <div>
          <div style={label}>Epik</div>
          <select disabled={readOnly} value={epicId ?? ''} onChange={(e) => setEpicId(e.target.value === '' ? null : Number(e.target.value))} style={field}>
            <option value="">— vyber epik —</option>
            {grouped.map((g) => (
              <optgroup key={g.project.id} label={g.project.name || '(projekt)'}>
                {g.epics.map((ep) => <option key={ep.epicId} value={ep.epicId}>{ep.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Číslo</div>
            <input disabled={readOnly} style={field} value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Stav</div>
            <select disabled={readOnly} value={status} onChange={(e) => setStatus(e.target.value)} style={field}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div style={label}>Název</div>
          <input disabled={readOnly} style={field} value={title2} onChange={(e) => setTitle2(e.target.value)} />
        </div>
        <div>
          <div style={label}>Odhad (h, volitelné — např. 1,5)</div>
          <input disabled={readOnly} style={{ ...field, borderColor: estimateStr && !estimateValid ? C.red : C.border }} value={estimateStr} onChange={(e) => setEstimateStr(e.target.value)} />
        </div>
        <div>
          <div style={label}>Popis (volitelné)</div>
          <input disabled={readOnly} style={field} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {onDelete && !readOnly && (
            <button onClick={async () => { setSaving(true); await onDelete(); }} disabled={saving} style={{ ...field, width: 'auto', color: C.red, cursor: 'pointer' }}>Smazat</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...field, width: 'auto', cursor: 'pointer' }}>Zrušit</button>
          {!readOnly && (
            <button onClick={submit} disabled={!canSubmit} style={{ ...field, width: 'auto', background: canSubmit ? C.violet : C.border, color: '#fff', border: 'none', cursor: canSubmit ? 'pointer' : 'default' }}>
              {saving ? 'Ukládám…' : 'Uložit'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors across all 6 projects.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass (872+ baseline + the slice-3a tests added in Tasks 1-4).

- [ ] **Step 5: Manual smoke (optional — requires the iPad dev build + Supabase online)**

In Records → Úkoly with a `fresh` dataset: add a task (pick epic, number, title), confirm it appears; tap it, change status to Probíhá, confirm the list badge updates; mark a task Hotovo, reopen it → confirm the drawer is read-only (no Save/Smazat); delete a non-done task, confirm it disappears. Toggle airplane mode → confirm read-only (no + Přidat).

- [ ] **Step 6: Commit**

```bash
git add apps/ipad/src/components/billing/records/TaskListView.tsx apps/ipad/src/components/billing/BillingModule.tsx apps/ipad/src/components/billing/BillingNav.tsx
git commit -m "feat(ipad): Úkoly task-list view — create/edit/delete drawers + project→epic picker"
```

---

## Final verification

- [ ] **Run the full suite + typecheck together**

Run: `npm test && npm run typecheck`
Expected: all tests pass; 0 type errors across all 6 projects.

- [ ] **Confirm the migration runs idempotently on the live Supabase project** (the orchestrator applies `PG_MIGRATIONS` on startup; v8 is versioned + role-guarded). Verify the next orchestrator run logs the v8 migration once and that authenticated task writes succeed.

---

## Self-Review notes (resolved)

- **Spec coverage:** epic cache + read additions (Task 1), `patchTasks` (Task 2), tasks write RLS v8 (Task 3), shapers + `applyTaskWrite` + `canEditTask` (Task 4), client hook with done-guard + insert-returns-id (Task 5), `TaskListView` + nav wiring with online/done gating (Task 6). `ProjectRow` `kind`/`isBillable` extension is in Task 1; the optimistic-row `taskId` patch is in Task 5.
- **Type consistency:** `TaskWriteInput`/`TaskChange`/`canEditTask` names match across Tasks 4–6; `buildOptimisticTaskRow`/`buildEditedTaskRow` signatures (with `project: ProjectRow`) are consistent between Task 4 (defined) and Task 5 (consumed); `applyTaskWrite` upsert/remove union identical in both.
- **Done-lock:** enforced in the UI (read-only drawer, no +tap write) AND in the hook (`canEditTask` guard in update/delete) — defence in depth, mirroring the orchestrator.
- **sync_id:** create mints fresh; edit/delete key on the existing `syncId`; no natural-key re-mark path → no tombstone-inclusive lookup.
