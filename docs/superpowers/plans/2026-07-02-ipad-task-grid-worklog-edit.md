# iPad Task Grid — Worklog Edit / Delete / Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make iPad task-grid cells interactive so worklogs can be added, edited, and deleted directly from the grid, reusing the existing write-back layer and drawer.

**Architecture:** Three units. (1) A pure shared helper `worklogsForCell` that maps a `(projectId, taskNumber, workDate)` cell to its worklogs. (2) The existing `WorklogDrawer` extracted from `WorklogListView.tsx` into its own module and given a "locked task" create mode. (3) `TaskGridView` cells become tappable and smart-open: 0 logs → add, 1 log → edit, N logs → a bottom-sheet list → edit/add. All writes go through the existing `useWorklogMutations` (direct Supabase, shared billing formula, optimistic + rollback).

**Tech Stack:** TypeScript, React (no MUI — `apps/ipad` is plain React + inline styles), Vitest. Shared pure logic in `packages/shared`.

## Global Constraints

- `apps/ipad` is **plain React + inline styles — no MUI**. Use the `C` design tokens from `apps/ipad/src/components/billing/reports/tokens.js`.
- Locale is Czech; **no i18n**. UI copy is Czech string literals (e.g. `Přidat`, `Smazat`, `Upravit záznam`).
- Renderer never reaches SQLite; iPad writes go **direct to Supabase** via the existing `useWorklogMutations` hook — do not add IPC.
- Derived billing fields (`effectiveMinutes` / `resolvedRate` / `earnedAmount`) are computed by the shared `computeWorklogBilling` via `computeDerivedForWrite` — do **not** recompute them ad hoc.
- All mutations respect the offline gate `canEdit(state)` — read-only when unavailable.
- ESM: intra-package imports use `.js` extensions (e.g. `'./WorklogDrawer.js'`), matching the existing files.
- Tests live under top-level `tests/` mirroring `src/` paths, run with `npm test` (Vitest). Full suite must stay green.
- Typecheck gate: `npm run typecheck:ci` must pass.

---

### Task 1: `worklogsForCell` shared helper

Pure function mapping a grid cell to the worklogs it aggregates. This is the only new testable logic.

**Files:**
- Create: `packages/shared/src/billing/records/worklog-cell.ts`
- Test: `tests/shared/billing/records/worklog-cell.test.ts`

**Interfaces:**
- Consumes: `WorklogRow` from `packages/shared/src/billing/types.js`.
- Produces: `worklogsForCell(rows: WorklogRow[], cell: { projectId: number; taskNumber: string | null; workDate: string }): WorklogRow[]` — filters `rows` to entries matching the cell. Task-number matching uses `(taskNumber ?? '')` on both sides so `null` groups the same way `buildTaskGrid`'s key (`${projectId}:${taskNumber ?? ''}`) does.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/billing/records/worklog-cell.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { worklogsForCell } from '../../../../packages/shared/src/billing/records/worklog-cell.js';
import type { WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, projectId: 1, projectName: 'P1', projectColor: '#fff',
    projectKind: 'work', isBillable: true, taskNumber: 'X-1', taskTitle: 'T',
    source: 'manual', ...over,
  };
}

describe('worklogsForCell', () => {
  it('returns only worklogs matching project + taskNumber + workDate', () => {
    const rows = [
      wl({ syncId: 'a', taskNumber: 'X-1', workDate: '2026-06-01' }),
      wl({ syncId: 'b', taskNumber: 'X-1', workDate: '2026-06-01' }),
      wl({ syncId: 'c', taskNumber: 'X-1', workDate: '2026-06-02' }), // wrong day
      wl({ syncId: 'd', taskNumber: 'X-2', workDate: '2026-06-01' }), // wrong task
      wl({ syncId: 'e', projectId: 2, taskNumber: 'X-1', workDate: '2026-06-01' }), // wrong project
    ];
    const got = worklogsForCell(rows, { projectId: 1, taskNumber: 'X-1', workDate: '2026-06-01' });
    expect(got.map((w) => w.syncId)).toEqual(['a', 'b']);
  });

  it('matches null taskNumber cells (buckets same as buildTaskGrid)', () => {
    const rows = [
      wl({ syncId: 'a', taskNumber: null, workDate: '2026-06-05' }),
      wl({ syncId: 'b', taskNumber: 'X-1', workDate: '2026-06-05' }),
    ];
    const got = worklogsForCell(rows, { projectId: 1, taskNumber: null, workDate: '2026-06-05' });
    expect(got.map((w) => w.syncId)).toEqual(['a']);
  });

  it('returns empty array when nothing matches', () => {
    const rows = [wl({ taskNumber: 'X-1', workDate: '2026-06-01' })];
    expect(worklogsForCell(rows, { projectId: 1, taskNumber: 'X-9', workDate: '2026-06-01' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- worklog-cell`
Expected: FAIL — cannot resolve `worklogsForCell` (module not found / not exported).

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/billing/records/worklog-cell.ts`:

```ts
import type { WorklogRow } from '../types.js';

/**
 * Worklogs that a single task-grid cell aggregates. A cell is identified by
 * (projectId, taskNumber, workDate); taskNumber is normalised with `?? ''` on
 * both sides so null-task rows bucket the same way buildTaskGrid keys them.
 */
export function worklogsForCell(
  rows: WorklogRow[],
  cell: { projectId: number; taskNumber: string | null; workDate: string },
): WorklogRow[] {
  const wantTask = cell.taskNumber ?? '';
  return rows.filter(
    (r) =>
      r.projectId === cell.projectId &&
      (r.taskNumber ?? '') === wantTask &&
      r.workDate === cell.workDate,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- worklog-cell`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/billing/records/worklog-cell.ts tests/shared/billing/records/worklog-cell.test.ts
git commit -m "feat(ipad): worklogsForCell shared helper for grid cell → worklogs"
```

---

### Task 2: Extract & generalize `WorklogDrawer`

Move the drawer out of `WorklogListView.tsx` into its own exported module and add a locked-task create mode (task pre-filled + picker hidden) plus a prefilled `initialDate`. `WorklogListView` must behave identically afterward. No new tests — this is a refactor verified by the existing suite + typecheck.

**Files:**
- Create: `apps/ipad/src/components/billing/records/WorklogDrawer.tsx`
- Modify: `apps/ipad/src/components/billing/records/WorklogListView.tsx` (remove the local `WorklogDrawer` definition, import the new one)

**Interfaces:**
- Consumes: `TaskRow`, `WorklogRow`, `ContractRow` from `@watchtower/shared/billing/types.js`; `parseMinutes` from `@watchtower/shared/billing/parseMinutes.js`; `computeDerivedForWrite`, `WorklogWriteInput` from `../../../state/billingWrites.js`; `formatCzk` from `../../../lib/czFormat.js`; `C` from `../reports/tokens.js`.
- Produces: exported `WorklogDrawer` with props:
  ```ts
  {
    title: string;
    tasks: TaskRow[];
    contracts: ContractRow[];
    initial?: WorklogRow;      // edit mode
    lockedTask?: TaskRow;      // create mode: prefill task + hide picker
    initialDate?: string;      // create mode: prefill date (YYYY-MM-DD)
    onClose(): void;
    onSubmit(task: TaskRow, input: WorklogWriteInput): Promise<void>;
    onDelete?(): Promise<void>;
  }
  ```

- [ ] **Step 1: Create the new module**

Create `apps/ipad/src/components/billing/records/WorklogDrawer.tsx` by moving the existing `WorklogDrawer` function body from `WorklogListView.tsx` (lines 131–249) verbatim, adding the imports it needs and the two new props. The full module:

```tsx
import { useState } from 'react';
import type { TaskRow, WorklogRow, ContractRow } from '@watchtower/shared/billing/types.js';
import { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';
import { computeDerivedForWrite, type WorklogWriteInput } from '../../../state/billingWrites.js';
import { formatCzk } from '../../../lib/czFormat.js';
import { C } from '../reports/tokens.js';

export function WorklogDrawer({ title, tasks, contracts, initial, lockedTask, initialDate, onClose, onSubmit, onDelete }: {
  title: string;
  tasks: TaskRow[];
  contracts: ContractRow[];
  initial?: WorklogRow;
  lockedTask?: TaskRow;
  initialDate?: string;
  onClose(): void;
  onSubmit(task: TaskRow, input: WorklogWriteInput): Promise<void>;
  onDelete?(): Promise<void>;
}): JSX.Element {
  const isEdit = initial != null;
  const isLocked = !isEdit && lockedTask != null;
  const showPicker = !isEdit && !isLocked;
  const [taskId, setTaskId] = useState<number | null>(isLocked ? lockedTask!.taskId : null);
  const [taskQuery, setTaskQuery] = useState('');
  const [date, setDate] = useState(initial?.workDate ?? initialDate ?? new Date().toISOString().slice(0, 10));
  const [minutesStr, setMinutesStr] = useState(initial ? String((initial.minutes / 60).toFixed(2)).replace('.', ',') : '');
  const [reportedStr, setReportedStr] = useState(initial?.reportedMinutes != null ? String((initial.reportedMinutes / 60).toFixed(2)).replace('.', ',') : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);

  const minutes = parseMinutes(minutesStr);
  const reported = reportedStr.trim() === '' ? null : parseMinutes(reportedStr);
  const minutesValid = Number.isFinite(minutes) && minutes > 0;
  const reportedValid = reported === null || (Number.isFinite(reported) && reported > 0);

  const pickedTask: TaskRow | null = isLocked
    ? lockedTask!
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

  const fixedTask = isEdit ? initial! : lockedTask;

  async function submit() {
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

        {showPicker && (
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
        {fixedTask && (
          <div style={{ fontSize: 13, color: C.muted }}>
            {fixedTask.taskNumber ? `${fixedTask.taskNumber} · ` : ''}{fixedTask.taskTitle || fixedTask.projectName}
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

Note the changes vs. the original: `isLocked`/`showPicker` flags, `taskId` seeded from `lockedTask`, `date` falls back to `initialDate`, `pickedTask` resolves to `lockedTask` when locked, the picker is gated on `showPicker`, and the fixed-task header renders from `fixedTask` (edit's `initial` or the `lockedTask`).

- [ ] **Step 2: Update `WorklogListView.tsx` to import the drawer**

In `apps/ipad/src/components/billing/records/WorklogListView.tsx`:
1. Delete the entire local `function WorklogDrawer(...) { ... }` definition (the last function in the file, ~lines 131–249).
2. Add an import near the top (after the existing imports):

```tsx
import { WorklogDrawer } from './WorklogDrawer.js';
```

3. Remove now-unused imports from `WorklogListView.tsx` **only if** they are no longer referenced by the remaining code (the list view still uses `parseMinutes`? — no; `computeDerivedForWrite`? — no; `formatCzk`? — check). After deletion, verify usage:

```bash
cd /Users/jan/Projects/Watchtower
grep -n "parseMinutes\|computeDerivedForWrite\|formatCzk\|ContractRow\|WorklogWriteInput" apps/ipad/src/components/billing/records/WorklogListView.tsx
```

Remove any import line whose symbols no longer appear in the file body. (`TaskRow`, `ContractRow`, `WorklogRow`, `contracts`, `tasks` are still used by the list view's `<WorklogDrawer .../>` call sites and `useWorklogMutations`, so keep those.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:ci`
Expected: PASS (no unused-import or type errors). Fix any leftover unused import flagged here.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — same count as before this task (baseline 951+, plus Task 1's 3). The refactor changes no behavior.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/components/billing/records/WorklogDrawer.tsx apps/ipad/src/components/billing/records/WorklogListView.tsx
git commit -m "refactor(ipad): extract WorklogDrawer + add locked-task create mode"
```

---

### Task 3: Make `TaskGridView` cells interactive

Wire each day cell to smart-open: 0 logs → create (task+date locked), 1 log → edit, N logs → a bottom-sheet list (each row → edit, plus **+ Přidat** locked to task+date). Gate everything on `canEdit`.

**Files:**
- Modify: `apps/ipad/src/components/billing/records/TaskGridView.tsx`

**Interfaces:**
- Consumes: `worklogsForCell` (Task 1); `WorklogDrawer` (Task 2); `useWorklogMutations` from `../../../state/useWorklogMutations.js`; `canEdit` from `../../../state/billingWrites.js`; `WorklogRow`, `TaskRow` from `@watchtower/shared/billing/types.js`; `formatHours` from `../../../lib/czFormat.js` (already imported).
- Produces: no exports beyond the existing `TaskGridView`.

- [ ] **Step 1: Add imports and pull the extra data/hook from `useBilling`**

At the top of `TaskGridView.tsx`, add imports:

```tsx
import { worklogsForCell } from '@watchtower/shared/billing/records/worklog-cell.js';
import { useWorklogMutations } from '../../../state/useWorklogMutations.js';
import { canEdit } from '../../../state/billingWrites.js';
import { WorklogDrawer } from './WorklogDrawer.js';
import type { WorklogRow, TaskRow } from '@watchtower/shared/billing/types.js';
```

Change the `useBilling()` destructure and derived locals near the top of the component from:

```tsx
  const { data } = useBilling();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];
```

to:

```tsx
  const { data, state, patchWorklogs } = useBilling();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];
  const tasks = data?.tasks ?? [];
  const contracts = data?.contracts ?? [];
  const editable = canEdit(state);

  const { createWorklog, updateWorklog, deleteWorklog, error } = useWorklogMutations({ worklogs, contracts, patchWorklogs });
```

- [ ] **Step 2: Add the sheet state and cell-open handler**

Immediately after the `useWorklogMutations` line (still inside the component, before `const g = buildTaskGrid(...)`), add:

```tsx
  type Sheet =
    | { mode: 'closed' }
    | { mode: 'list'; entries: WorklogRow[]; task: TaskRow | null; date: string }
    | { mode: 'create'; task: TaskRow; date: string }
    | { mode: 'edit'; worklog: WorklogRow };
  const [sheet, setSheet] = useState<Sheet>({ mode: 'closed' });

  function openCell(row: { projectId: number; taskNumber: string | null }, dayIdx: number): void {
    if (!editable) return;
    const workDate = `${month}-${String(dayIdx + 1).padStart(2, '0')}`;
    const entries = worklogsForCell(worklogs, { projectId: row.projectId, taskNumber: row.taskNumber, workDate });
    const task = tasks.find((t) => t.projectId === row.projectId && (t.taskNumber ?? '') === (row.taskNumber ?? '')) ?? null;
    if (entries.length === 0) {
      if (task) setSheet({ mode: 'create', task, date: workDate });
    } else if (entries.length === 1) {
      setSheet({ mode: 'edit', worklog: entries[0]! });
    } else {
      setSheet({ mode: 'list', entries, task, date: workDate });
    }
  }
```

- [ ] **Step 3: Make cells tappable**

Replace the per-day cell render inside the task-row `.map` — from:

```tsx
                    {t.perDay.map((min, i) => <td key={i} style={{ ...cellBase, padding: '5px 0', color: min ? C.text : C.border }}>{hrs(min)}</td>)}
```

to:

```tsx
                    {t.perDay.map((min, i) => (
                      <td key={i} style={{ ...cellBase, padding: 0, color: min ? C.text : C.border }}>
                        <button
                          onClick={() => openCell(t, i)}
                          disabled={!editable}
                          style={{ width: '100%', minHeight: 26, background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: editable ? 'pointer' : 'default', padding: '5px 0' }}
                        >
                          {hrs(min)}
                        </button>
                      </td>
                    ))}
```

- [ ] **Step 4: Render the read-only notice, error, and sheets**

Add a read-only hint + error line just below the sticky header `</div>` (right before the `{g.tasks.length === 0 ? (` block):

```tsx
      {!editable && (
        <div style={{ padding: '6px 16px', fontSize: 12, color: C.muted }}>jen pro čtení offline</div>
      )}
      {error && (
        <div style={{ padding: '6px 16px', fontSize: 12, color: C.red }}>{error}</div>
      )}
```

Then add the sheet rendering just before the component's final closing `</div>` (after the `)}` that closes the `g.tasks.length === 0 ? … :` block):

```tsx
      {sheet.mode === 'list' && (
        <div onClick={() => setSheet({ mode: 'closed' })} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.ground, borderTopLeftRadius: 16, borderTopRightRadius: 16, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Záznamy</div>
              <button onClick={() => setSheet({ mode: 'closed' })} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            {sheet.entries.map((w) => (
              <button
                key={w.syncId}
                onClick={() => setSheet({ mode: 'edit', worklog: w })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: C.text, width: '100%' }}
              >
                <div style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.description || w.taskTitle || w.projectName}</div>
                <div style={{ fontSize: 12, flexShrink: 0 }}>
                  {formatHours(w.minutes)}
                  {w.effectiveMinutes !== w.minutes && <span style={{ color: C.muted }}> → {formatHours(w.effectiveMinutes)}</span>}
                </div>
              </button>
            ))}
            {sheet.task && (
              <button
                onClick={() => setSheet(sheet.task ? { mode: 'create', task: sheet.task, date: sheet.date } : { mode: 'closed' })}
                style={{ background: C.violet, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginTop: 4 }}
              >
                + Přidat
              </button>
            )}
          </div>
        </div>
      )}

      {sheet.mode === 'create' && (
        <WorklogDrawer
          title="Nový záznam"
          tasks={tasks}
          contracts={contracts}
          lockedTask={sheet.task}
          initialDate={sheet.date}
          onClose={() => setSheet({ mode: 'closed' })}
          onSubmit={async (taskRow, input) => { await createWorklog(taskRow, input); setSheet({ mode: 'closed' }); }}
        />
      )}
      {sheet.mode === 'edit' && (
        <WorklogDrawer
          title="Upravit záznam"
          tasks={tasks}
          contracts={contracts}
          initial={sheet.worklog}
          onClose={() => setSheet({ mode: 'closed' })}
          onSubmit={async (_taskRow, input) => { await updateWorklog(sheet.worklog.syncId, input); setSheet({ mode: 'closed' }); }}
          onDelete={async () => { await deleteWorklog(sheet.worklog.syncId); setSheet({ mode: 'closed' }); }}
        />
      )}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:ci`
Expected: PASS. Common issues to fix: `sheet.entries[0]!` non-null assertion, and the `sheet.task` narrowing inside the `+ Přidat` `onClick` (the ternary above avoids the narrowing pitfall).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — baseline + 3 new (Task 1). No grid/behaviour tests changed.

- [ ] **Step 7: Commit**

```bash
git add apps/ipad/src/components/billing/records/TaskGridView.tsx
git commit -m "feat(ipad): edit/delete/add worklogs from the task grid"
```

---

## Manual verification (device / dev)

After Task 3, verify on the iPad dev build (`npm run dev:ipad` on the Mac, per the dev-ipad-ws-bind note):

1. Tap a cell with **one** entry → edit drawer opens with that worklog; edit time → grid updates; delete → cell empties.
2. Tap a cell with **multiple** entries → list sheet lists them; tap one → edit; **+ Přidat** → create drawer with task + date locked.
3. Tap an **empty** cell in a real-task row → create drawer, task + date locked; save → cell shows the new minutes.
4. Tap an empty cell in the **(bez úkolu)** row → nothing opens (no resolvable task); existing entries in that row still editable.
5. Offline / read-only (`canEdit` false) → cells not tappable, "jen pro čtení offline" shown.

## Self-Review notes

- **Spec coverage:** §1 drawer extract → Task 2; §2 cell mapping → Task 1; §3 smart open (0/1/N) → Task 3; §4 data deps → Task 3 Step 1; §5 styling reuse → Tasks 2–3 (tokens + drawer reuse); testing → Task 1 unit tests + full-suite gates in Tasks 2–3. Known edge (add 2nd log to a 1-log cell via list view) documented in spec, no task needed.
- **Types:** `Sheet` union, `openCell(row, dayIdx)`, `worklogsForCell(rows, cell)`, and `WorklogDrawer` props are consistent across tasks. `createWorklog(task, input)` / `updateWorklog(syncId, input)` / `deleteWorklog(syncId)` match `useWorklogMutations`.
- **Placeholders:** none — every code step is complete.
