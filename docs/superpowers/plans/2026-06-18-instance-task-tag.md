# Instance → Task Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users tag a managed Watchtower instance (session) to a TimeTracker task, stored as a nullable FK on the `instances` table, set/cleared via the instance tab context menu.

**Architecture:** Migration v12 adds `task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL` to `instances`. A new IPC kind `instances:setTask` writes the tag and pushes a `stateChanged` event so the renderer refreshes. The renderer's `useInstances` hook gains a `setTask` method; the `SessionTabBar` gains a right-click context menu with "Přiřadit k úkolu…" / "Zrušit přiřazení" items that open a `InstanceTaskPickerDialog` (new component).

**Tech Stack:** TypeScript/Node (orchestrator), React/MUI v5 (renderer), SQLite via `node:sqlite` in tests and `better-sqlite3` in production.

## Global Constraints

- Locale: Czech. All UI strings in Czech. No i18n library.
- Dates/numbers: `client/src/util/format.ts` helpers only.
- IPC pattern: `shared/ipcContract.ts` → `shared/messagePort.ts` → `orchestrator/index.ts` handler → thin hook in `client/src/state/`.
- Fire-and-forget mutations use `useToast().showError`; no silent `void state.foo()`.
- Schema: additive only. Do not rename `project_rates` → `contracts` or drop `is_billable`.
- Migration: v12 (current is v11). Defensive check (idempotent re-run must not fail).
- Tests: Full suite must stay green (`npm test`, baseline 552 passing). Add new tests.
- Typecheck: `npx tsc -p orchestrator/tsconfig.json --noEmit` must pass. `npx tsc -p client/tsconfig.json --noEmit` must not introduce NEW errors beyond the pre-existing drift (rootDir for `dev/`, slotProps on MUI v6 TextField, `useInstances.spawn` return type).
- Commits: On branch `feat/session-bridge-and-config-tools`. Co-Authored-By line required.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `orchestrator/db/migrations.ts` | Modify | Add v12 migration |
| `shared/stateModel.ts` | Modify | Add `taskId: number \| null` to `InstanceRow` |
| `orchestrator/db/repositories/instances.ts` | Modify | Add `task_id` to `DbInstanceRow`, `toRow`, all SELECTs; add `setTask()` |
| `shared/ipcContract.ts` | Modify | Add `instances:setTask` to `IpcRequest` + `IpcResponse` |
| `shared/messagePort.ts` | Modify | Add `instances:setTask` to `OrchRequest` + `OrchResponse` |
| `orchestrator/index.ts` | Modify | Add `instances:setTask` handler (calls `repo().setTask`, pushes `stateChanged`) |
| `client/src/state/useInstances.ts` | Modify | Add `setTask(instanceId, taskId \| null)` method |
| `client/src/components/instances/SessionTabBar.tsx` | Modify | Add right-click context menu with "Přiřadit k úkolu…" / "Zrušit přiřazení" items + `taskId` / `onSetTask` props |
| `client/src/components/instances/InstanceTaskPickerDialog.tsx` | Create | New dialog: project auto-selected by cwd longest-prefix, epic → task cascade, confirm → calls `onSetTask` |
| `client/src/components/instances/LeafView.tsx` | Modify | Pass `taskId` and `onSetTask` down to `SessionTabBar` |
| `client/src/components/instances/WorkspaceRoot.tsx` | Modify | Pass `taskId` and `onSetTask` down to `LeafView` |
| `client/src/App.tsx` | Modify | Wire `onSetTask` from `useInstances().setTask` into `WorkspaceRoot` |
| `tests/orchestrator/instancesRepo.test.ts` | Modify | Add `setTask` round-trip and `ON DELETE SET NULL` tests |
| `tests/orchestrator/migrations.test.ts` | Modify | Add v12 idempotency test |

---

### Task 1: Schema migration v12 + `InstanceRow.taskId`

**Files:**
- Modify: `orchestrator/db/migrations.ts` — append v12 to MIGRATIONS array
- Modify: `shared/stateModel.ts` — add `taskId: number | null` to `InstanceRow`
- Modify: `orchestrator/db/repositories/instances.ts` — add `task_id` to `DbInstanceRow`, `toRow`, and every SELECT

**Interfaces:**
- Produces: `InstanceRow.taskId: number | null` (used by all subsequent tasks)

- [ ] **Step 1: Write failing tests for migration v12 and repo taskId**

Add a new `describe('v12 task_id migration', ...)` block to `tests/orchestrator/migrations.test.ts`:

```typescript
// at top of file, near existing imports:
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';

describe('v12 task_id migration', () => {
  it('adds task_id column to instances', () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
    const db = new DatabaseSync(dbPath);
    runMigrations(db as unknown as SqliteLike);
    const cols = db.prepare('PRAGMA table_info(instances)').all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'task_id')).toBe(true);
  });

  it('is idempotent — running migrations twice does not throw', () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
    const db = new DatabaseSync(dbPath);
    runMigrations(db as unknown as SqliteLike);
    expect(() => runMigrations(db as unknown as SqliteLike)).not.toThrow();
  });
});
```

Add a new `describe('InstancesRepo taskId', ...)` block to `tests/orchestrator/instancesRepo.test.ts`:

```typescript
describe('InstancesRepo taskId', () => {
  let db: SqliteLike;
  let repo: InstancesRepo;

  beforeEach(() => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA foreign_keys = ON');
    runMigrations(raw as unknown as SqliteLike);
    db = raw as unknown as SqliteLike;
    repo = new InstancesRepo(db);
  });

  it('defaults task_id to null on insert', () => {
    repo.insert(baseRow({ id: 'i-default' }));
    expect(repo.get('i-default')?.taskId).toBeNull();
  });

  it('setTask round-trips a non-null taskId', () => {
    // Seed a task row so the FK is satisfiable
    db.prepare(`INSERT INTO projects (name, color, archived, is_billable, kind, is_default)
      VALUES ('P', '#fff', 0, 1, 'work', 0)`).run();
    const projId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    db.prepare(`INSERT INTO epics (project_id, name, status) VALUES (?, 'E', 'active')`).run(projId);
    const epicId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    db.prepare(`INSERT INTO tasks (epic_id, number, title, status) VALUES (?, '1', 'T', 'open')`).run(epicId);
    const taskId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;

    repo.insert(baseRow({ id: 'i-tagged' }));
    repo.setTask('i-tagged', taskId as number);
    expect(repo.get('i-tagged')?.taskId).toBe(taskId);
  });

  it('setTask clears to null', () => {
    repo.insert(baseRow({ id: 'i-clear' }));
    repo.setTask('i-clear', null);
    expect(repo.get('i-clear')?.taskId).toBeNull();
  });

  it('ON DELETE SET NULL: deleting the tagged task nulls the instance task_id', () => {
    db.prepare(`INSERT INTO projects (name, color, archived, is_billable, kind, is_default)
      VALUES ('P2', '#000', 0, 1, 'work', 0)`).run();
    const projId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    db.prepare(`INSERT INTO epics (project_id, name, status) VALUES (?, 'E2', 'active')`).run(projId);
    const epicId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    db.prepare(`INSERT INTO tasks (epic_id, number, title, status) VALUES (?, '2', 'T2', 'open')`).run(epicId);
    const taskId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;

    repo.insert(baseRow({ id: 'i-fk' }));
    repo.setTask('i-fk', taskId as number);
    expect(repo.get('i-fk')?.taskId).toBe(taskId);

    // Delete the task — FK ON DELETE SET NULL should fire
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId as number);
    expect(repo.get('i-fk')?.taskId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jan/Projects/Watchtower && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|task_id|taskId" | head -30
```

Expected: Tests fail because `task_id` column doesn't exist yet.

- [ ] **Step 3: Add migration v12 to `orchestrator/db/migrations.ts`**

Append after the closing `}` of the v11 entry (before the `];`):

```typescript
  {
    version: 12,
    up: (db) => {
      const cols = db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === 'task_id')) return; // fresh install already has it
      // Phase A: tag an instance to a TimeTracker task. ON DELETE SET NULL so
      // deleting a task doesn't orphan or block instance rows.
      db.exec(
        `ALTER TABLE instances ADD COLUMN task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL`,
      );
    },
  },
```

- [ ] **Step 4: Add `taskId` to `shared/stateModel.ts`**

In the `InstanceRow` interface, append after `kind: InstanceKind;`:

```typescript
  taskId: number | null;
```

- [ ] **Step 5: Update `orchestrator/db/repositories/instances.ts`**

Add `task_id: number | null;` to `DbInstanceRow` type after `kind`:

```typescript
  kind: InstanceKind;
  task_id: number | null;
```

Add `taskId: r.task_id,` to `toRow()` after `kind: r.kind,`:

```typescript
    kind: r.kind,
    taskId: r.task_id,
```

Add a `setTask` method to `InstancesRepo` after `setTermination`:

```typescript
  setTask(id: string, taskId: number | null): void {
    this.db.prepare(`UPDATE instances SET task_id = ? WHERE id = ?`).run(taskId, id);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/jan/Projects/Watchtower && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|task_id|taskId|v12" | head -30
```

Expected: All new tests pass; existing suite still green.

- [ ] **Step 7: Run orchestrator typecheck**

```bash
cd /Users/jan/Projects/Watchtower && npx tsc -p orchestrator/tsconfig.json --noEmit
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/jan/Projects/Watchtower && git add \
  orchestrator/db/migrations.ts \
  shared/stateModel.ts \
  orchestrator/db/repositories/instances.ts \
  tests/orchestrator/instancesRepo.test.ts \
  tests/orchestrator/migrations.test.ts && \
git commit -m "$(cat <<'EOF'
feat(timetracker): add task_id to instances table (migration v12)

Phase A prerequisite: instances can now be tagged to a TimeTracker task via
a nullable FK with ON DELETE SET NULL semantics.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: IPC wiring — `instances:setTask`

**Files:**
- Modify: `shared/ipcContract.ts` — add to `IpcRequest` and `IpcResponse`
- Modify: `shared/messagePort.ts` — add to `OrchRequest` and `OrchResponse`
- Modify: `orchestrator/index.ts` — add handler

**Interfaces:**
- Consumes: `repo().setTask(instanceId, taskId)` (from Task 1)
- Consumes: `api?.push({ kind: 'stateChanged', payload: { instanceId, status } })` pattern (existing)
- Produces: `instances:setTask` IPC kind usable from renderer

- [ ] **Step 1: Add `instances:setTask` to `shared/ipcContract.ts`**

In `IpcRequest`, append after the `instances:findByCwd` line:

```typescript
  | { kind: 'instances:setTask'; payload: { instanceId: string; taskId: number | null } }
```

In `IpcResponse`, append after the `instances:findByCwd` response line:

```typescript
  | { kind: 'instances:setTask'; payload: { ok: true } }
```

- [ ] **Step 2: Add `instances:setTask` to `shared/messagePort.ts`**

In `OrchRequest`, append after the `instances:findByCwd` line:

```typescript
  | { id: string; kind: 'instances:setTask'; payload: { instanceId: string; taskId: number | null } }
```

In `OrchResponse`, append after the `instances:findByCwd` response line:

```typescript
  | { kind: 'instances:setTask'; payload: { ok: true } }
```

- [ ] **Step 3: Add handler in `orchestrator/index.ts`**

Find the `case 'instances:findByCwd':` block (around line 912). After its closing `}` and before the next `case`, insert:

```typescript
    case 'instances:setTask': {
      const { instanceId, taskId } = req.payload;
      repo().setTask(instanceId, taskId);
      const inst = repo().get(instanceId);
      if (inst) {
        api?.push({ kind: 'stateChanged', payload: { instanceId, status: inst.status } });
      }
      return { ok: true as const };
    }
```

- [ ] **Step 4: Run full typecheck (orchestrator + client)**

```bash
cd /Users/jan/Projects/Watchtower && npx tsc -p orchestrator/tsconfig.json --noEmit && npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "rootDir\|slotProps\|spawn"
```

Expected: No new errors.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/jan/Projects/Watchtower && npm test 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/jan/Projects/Watchtower && git add \
  shared/ipcContract.ts \
  shared/messagePort.ts \
  orchestrator/index.ts && \
git commit -m "$(cat <<'EOF'
feat(timetracker): add instances:setTask IPC kind

Wires the full orchestrator path: IpcRequest/IpcResponse, OrchRequest/OrchResponse,
and the orchestrator handler that calls setTask and pushes stateChanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Renderer state hook — `useInstances.setTask`

**Files:**
- Modify: `client/src/state/useInstances.ts` — add `setTask` to hook return

**Interfaces:**
- Consumes: `window.watchtower.invoke('instances:setTask', { instanceId, taskId })`
- Produces: `setTask(instanceId: string, taskId: number | null): Promise<void>` (used by UI components)

- [ ] **Step 1: Add `taskId` to `InstanceView`**

In `client/src/state/useInstances.ts`, add `taskId: number | null;` to the `InstanceView` interface:

```typescript
export interface InstanceView {
  id: string;
  cwd: string;
  status: string;
  lastActivityAt: number;
  kind: 'claude' | 'shell';
  taskId: number | null;
}
```

- [ ] **Step 2: Update `refresh()` to populate `taskId`**

The `listInstances` IPC response currently doesn't include `taskId`. We need to add it.

First, update `IpcResponse['listInstances']` payload in `shared/ipcContract.ts` — change the `instances` array element type to include `taskId`:

```typescript
  | {
      kind: 'listInstances';
      payload: {
        instances: Array<{
          id: string;
          cwd: string;
          status: string;
          lastActivityAt: number;
          kind: import('./stateModel.js').InstanceKind;
          taskId: number | null;
        }>;
      };
    }
```

Also update the matching entry in `OrchResponse` in `shared/messagePort.ts`:

```typescript
  | {
      kind: 'listInstances';
      payload: {
        instances: Array<{
          id: string;
          cwd: string;
          status: string;
          lastActivityAt: number;
          kind: import('./stateModel.js').InstanceKind;
          taskId: number | null;
        }>;
      };
    }
```

Then update the `listInstances` handler in `orchestrator/index.ts` (find `case 'listInstances':`) to include `taskId`:

```typescript
    case 'listInstances': {
      const rows = repo().listAll();
      return {
        instances: rows.map((r) => ({
          id: r.id,
          cwd: r.cwd,
          status: r.status,
          lastActivityAt: r.lastActivityAt,
          kind: r.kind,
          taskId: r.taskId,
        })),
      };
    }
```

- [ ] **Step 3: Add `setTask` to `useInstances` hook**

In `client/src/state/useInstances.ts`, add a `setTask` callback after `reorder`:

```typescript
  const setTask = useCallback(
    async (instanceId: string, taskId: number | null) => {
      await window.watchtower.invoke('instances:setTask', { instanceId, taskId });
      // stateChanged push from the orchestrator will trigger refresh()
    },
    [],
  );
```

Update the return type annotation and returned object:

```typescript
export function useInstances(): {
  instances: InstanceView[];
  activeId: string | null;
  loaded: boolean;
  setActive(id: string | null): void;
  spawn(cwd: string, args?: string[], kind?: 'claude' | 'shell'): Promise<{ instanceId: string | null; error?: string }>;
  kill(instanceId: string): Promise<void>;
  refresh(): Promise<void>;
  remove(instanceId: string): Promise<void>;
  reorder(orderedIds: string[]): Promise<void>;
  setTask(instanceId: string, taskId: number | null): Promise<void>;
}
```

And add `setTask` to the return object:

```typescript
  return { instances, activeId, loaded, setActive: setActiveId, spawn, kill, remove, reorder, refresh, setTask };
```

Also update the `setInstances` call inside `refresh` to include `taskId`:

```typescript
  const refresh = useCallback(async () => {
    const res = await window.watchtower.invoke('listInstances', {});
    setInstances(res.instances.map((i) => ({ ...i, taskId: i.taskId ?? null })));
    setLoaded(true);
  }, []);
```

- [ ] **Step 4: Typecheck client**

```bash
cd /Users/jan/Projects/Watchtower && npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "rootDir\|slotProps\|spawn"
```

Expected: No new errors.

- [ ] **Step 5: Also typecheck orchestrator**

```bash
cd /Users/jan/Projects/Watchtower && npx tsc -p orchestrator/tsconfig.json --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/jan/Projects/Watchtower && git add \
  client/src/state/useInstances.ts \
  shared/ipcContract.ts \
  shared/messagePort.ts \
  orchestrator/index.ts && \
git commit -m "$(cat <<'EOF'
feat(timetracker): expose taskId in listInstances and add setTask to useInstances

InstanceView now carries taskId; listInstances includes it; useInstances.setTask
invokes instances:setTask IPC.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `InstanceTaskPickerDialog` component

Create a new React component that:
1. Shows a project autocomplete preselected by longest cwd prefix match.
2. When a project is selected, loads its epics; when an epic is selected, loads its tasks.
3. On confirm, calls `onSetTask(taskId)`.
4. Has a separate "Zrušit přiřazení" / clear button.

**Files:**
- Create: `client/src/components/instances/InstanceTaskPickerDialog.tsx`

**Interfaces:**
- Consumes: `projects:list`, `epics:list`, `tasks:listForEpic` IPC kinds
- Consumes: `ProjectViewPayload`, `EpicViewPayload`, `TaskViewPayload` from `shared/ipcContract.ts`
- Produces: `InstanceTaskPickerDialog` component with props:
  ```typescript
  interface Props {
    open: boolean;
    instanceCwd: string;       // used for preselecting project
    currentTaskId: number | null;
    onSetTask(taskId: number | null): void;
    onClose(): void;
  }
  ```

- [ ] **Step 1: Write the component**

Create `/Users/jan/Projects/Watchtower/client/src/components/instances/InstanceTaskPickerDialog.tsx`:

```typescript
import { useEffect, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { homedir } from '../../util/homedir.js';
import type { EpicViewPayload, ProjectViewPayload, TaskViewPayload } from '../../../../shared/ipcContract.js';

interface Props {
  open: boolean;
  /** Instance cwd — used to pre-select the matching project by longest folder_path prefix. */
  instanceCwd: string;
  currentTaskId: number | null;
  onSetTask(taskId: number | null): void;
  onClose(): void;
}

/**
 * Expands a leading `~` to the home directory.
 * Mirrors the `~` expansion in orchestrator's instances:findByCwd handler.
 */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return homedir() + p.slice(1);
  return p;
}

/**
 * Returns the project whose folder_path is the longest prefix of `cwd`,
 * or null if none matches.
 */
function matchProject(cwd: string, projects: ProjectViewPayload[]): ProjectViewPayload | null {
  const expanded = expandHome(cwd);
  let best: ProjectViewPayload | null = null;
  let bestLen = 0;
  for (const p of projects) {
    if (!p.folderPath) continue;
    const fp = expandHome(p.folderPath);
    if (expanded.startsWith(fp) && fp.length > bestLen) {
      best = p;
      bestLen = fp.length;
    }
  }
  return best;
}

export function InstanceTaskPickerDialog({ open, instanceCwd, currentTaskId, onSetTask, onClose }: Props) {
  const [projects, setProjects] = useState<ProjectViewPayload[]>([]);
  const [project, setProject] = useState<ProjectViewPayload | null>(null);
  const [epics, setEpics] = useState<EpicViewPayload[]>([]);
  const [epic, setEpic] = useState<EpicViewPayload | null>(null);
  const [tasks, setTasks] = useState<TaskViewPayload[]>([]);
  const [task, setTask] = useState<TaskViewPayload | null>(null);
  const [loading, setLoading] = useState(false);

  // Load projects when dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await window.watchtower.invoke('projects:list', { archived: false });
        if (cancelled) return;
        setProjects(res.projects);
        const matched = matchProject(instanceCwd, res.projects);
        setProject(matched);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, instanceCwd]);

  // Load epics when project changes
  useEffect(() => {
    if (!project) {
      setEpics([]);
      setEpic(null);
      setTasks([]);
      setTask(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.watchtower.invoke('epics:list', { projectId: project.id });
        if (cancelled) return;
        setEpics(res.epics);
        setEpic(null);
        setTasks([]);
        setTask(null);
      } catch {
        if (!cancelled) setEpics([]);
      }
    })();
    return () => { cancelled = true; };
  }, [project]);

  // Load tasks when epic changes
  useEffect(() => {
    if (!epic) {
      setTasks([]);
      setTask(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.watchtower.invoke('tasks:listForEpic', { epicId: epic.id });
        if (cancelled) return;
        setTasks(res.tasks);
        setTask(null);
      } catch {
        if (!cancelled) setTasks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [epic]);

  const handleConfirm = () => {
    if (!task) return;
    onSetTask(task.id);
    onClose();
  };

  const handleClear = () => {
    onSetTask(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Přiřadit k úkolu</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Autocomplete<ProjectViewPayload>
            options={projects}
            getOptionLabel={(p) => p.name}
            value={project}
            onChange={(_, v) => setProject(v)}
            loading={loading}
            renderInput={(params) => (
              <TextField {...params} label="Projekt" size="small" />
            )}
            isOptionEqualToValue={(a, b) => a.id === b.id}
          />
          <Autocomplete<EpicViewPayload>
            options={epics}
            getOptionLabel={(e) => e.name}
            value={epic}
            onChange={(_, v) => setEpic(v)}
            disabled={!project}
            renderInput={(params) => (
              <TextField {...params} label="Epic" size="small" />
            )}
            isOptionEqualToValue={(a, b) => a.id === b.id}
          />
          <Autocomplete<TaskViewPayload>
            options={tasks}
            getOptionLabel={(t) => `${t.number} — ${t.title}`}
            value={task}
            onChange={(_, v) => setTask(v)}
            disabled={!epic}
            renderInput={(params) => (
              <TextField {...params} label="Úkol" size="small" />
            )}
            isOptionEqualToValue={(a, b) => a.id === b.id}
          />
          {currentTaskId != null && (
            <Typography variant="caption" color="text.secondary">
              Aktuálně přiřazeno: ID {currentTaskId}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {currentTaskId != null && (
          <Button color="warning" onClick={handleClear} sx={{ mr: 'auto' }}>
            Zrušit přiřazení
          </Button>
        )}
        <Button onClick={onClose}>Zrušit</Button>
        <Button variant="contained" disabled={!task} onClick={handleConfirm}>
          Přiřadit
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

Note: `homedir` is a browser-side utility we need. Create `client/src/util/homedir.ts`:

```typescript
/**
 * Returns the user's home directory path as reported by the operating system.
 * In the renderer process, we read it from a window global injected by the
 * electron preload (window.__homeDir). Falls back to '~' if not available.
 */
export function homedir(): string {
  return (window as unknown as { __homeDir?: string }).__homeDir ?? '~';
}
```

Then expose `homeDir` from the electron preload. Check how the preload is set up:

```bash
grep -rn "__homeDir\|contextBridge\|preload" /Users/jan/Projects/Watchtower/electron/ | head -20
```

If `__homeDir` is not already set, add it to the preload's `contextBridge.exposeInMainWorld` call. Look at `electron/preload.ts` or similar — add:

```typescript
window.__homeDir = require('os').homedir();
```

Or equivalently in the preload file that does `contextBridge.exposeInMainWorld`.

- [ ] **Step 2: Check and update the electron preload for `__homeDir`**

```bash
find /Users/jan/Projects/Watchtower/electron -name "preload*" | xargs grep -l "contextBridge\|exposeInMainWorld" 2>/dev/null
```

Read the preload file found. If it already exposes `homedir`, skip this sub-step. If not, add `__homeDir` exposure.

- [ ] **Step 3: Typecheck client**

```bash
cd /Users/jan/Projects/Watchtower && npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "rootDir\|slotProps\|spawn"
```

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jan/Projects/Watchtower && git add \
  client/src/components/instances/InstanceTaskPickerDialog.tsx \
  client/src/util/homedir.ts \
  electron/preload.ts && \
git commit -m "$(cat <<'EOF'
feat(timetracker): add InstanceTaskPickerDialog component

Project→epic→task cascade picker with cwd-based project preselection.
Czech UI strings. Used by the instance tab context menu (Task 5).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire context menu into `SessionTabBar` + propagate through component tree

**Files:**
- Modify: `client/src/components/instances/SessionTabBar.tsx` — right-click context menu
- Modify: `client/src/components/instances/LeafView.tsx` — pass props down
- Modify: `client/src/components/instances/WorkspaceRoot.tsx` — pass props down
- Modify: `client/src/App.tsx` — wire `setTask` from `useInstances`

**Interfaces:**
- Consumes: `InstanceView.taskId` (from Task 3) and `useInstances().setTask` (from Task 3)
- Consumes: `InstanceTaskPickerDialog` (from Task 4)
- Produces: Context menu on right-click of session tab; "Přiřadit k úkolu…" opens picker; tag shown in Tooltip

- [ ] **Step 1: Update `SessionTabBar` props and add context menu**

In `client/src/components/instances/SessionTabBar.tsx`, update `SessionInfo` and `Props`:

```typescript
export interface SessionInfo {
  id: string;
  status: string;
  kind: 'claude' | 'shell';
  cwd: string;
  taskId: number | null;
}

interface Props {
  sessions: SessionInfo[];
  hiddenSessions: SessionInfo[];
  focusedId: string | null;
  accent: string;
  columnSizes?: number[];
  onSelect(id: string): void;
  onClose(id: string): void;
  onRestart?(id: string): void;
  onHide(id: string): void;
  onUnhide(id: string): void;
  onAddSession(): void;
  onSetTask(instanceId: string, taskId: number | null): void;
}
```

Import `InstanceTaskPickerDialog`:

```typescript
import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { InstanceTaskPickerDialog } from './InstanceTaskPickerDialog.js';
```

Add state for context menu and picker inside the component:

```typescript
  const [contextMenu, setContextMenu] = useState<{ anchor: HTMLElement; sessionId: string } | null>(null);
  const [pickerSessionId, setPickerSessionId] = useState<string | null>(null);
```

Add `onContextMenu` handler to each tab `<Box>`:

```typescript
onContextMenu={(e: ReactMouseEvent<HTMLElement>) => {
  e.preventDefault();
  setContextMenu({ anchor: e.currentTarget, sessionId: s.id });
}}
```

After the `sessions.map(...)` JSX, add the context menu and picker:

```typescript
      <Menu
        open={Boolean(contextMenu)}
        anchorEl={contextMenu?.anchor ?? null}
        onClose={() => setContextMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <MenuItem
          onClick={() => {
            const id = contextMenu!.sessionId;
            setContextMenu(null);
            setPickerSessionId(id);
          }}
        >
          Přiřadit k úkolu…
        </MenuItem>
        {contextMenu && sessions.find((s) => s.id === contextMenu.sessionId)?.taskId != null && (
          <MenuItem
            onClick={() => {
              onSetTask(contextMenu!.sessionId, null);
              setContextMenu(null);
            }}
          >
            Zrušit přiřazení
          </MenuItem>
        )}
      </Menu>
      {pickerSessionId != null && (() => {
        const sess = sessions.find((s) => s.id === pickerSessionId) ?? hiddenSessions.find((s) => s.id === pickerSessionId);
        return (
          <InstanceTaskPickerDialog
            open
            instanceCwd={sess?.cwd ?? ''}
            currentTaskId={sess?.taskId ?? null}
            onSetTask={(taskId) => onSetTask(pickerSessionId, taskId)}
            onClose={() => setPickerSessionId(null)}
          />
        );
      })()}
```

Update the tab `<Box>` to include a Tooltip showing the task ID when tagged:

Replace the existing plain `<Box>` wrapping "Session {idx + 1}" with a Tooltip:

```typescript
            <Tooltip
              title={s.taskId != null ? `Úkol #${s.taskId}` : ''}
              placement="bottom"
            >
              <Box
                sx={{
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Session {idx + 1}
                {s.taskId != null && (
                  <Box
                    component="span"
                    sx={{ ml: 0.5, opacity: 0.6, fontSize: 10 }}
                  >
                    #
                  </Box>
                )}
              </Box>
            </Tooltip>
```

- [ ] **Step 2: Update `LeafView.tsx` to pass `cwd`, `taskId`, and `onSetTask`**

Add `onSetTask` to `Props`:

```typescript
  onSetTask(instanceId: string, taskId: number | null): void;
```

Update `sessionInfos` and `hiddenSessionInfos` to include `cwd` and `taskId`:

```typescript
  const sessionInfos = tab.columnOrder.map((id) => {
    const inst = instances.find((i) => i.id === id);
    return {
      id,
      status: inst?.status ?? 'unknown',
      kind: inst?.kind ?? 'claude' as const,
      cwd: inst?.cwd ?? '',
      taskId: inst?.taskId ?? null,
    };
  });
  const hiddenSessionInfos = tab.hiddenInstanceIds.map((id) => {
    const inst = instances.find((i) => i.id === id);
    return {
      id,
      status: inst?.status ?? 'unknown',
      kind: inst?.kind ?? 'claude' as const,
      cwd: inst?.cwd ?? '',
      taskId: inst?.taskId ?? null,
    };
  });
```

Pass `onSetTask` to both `SessionTabBar` usages:

```typescript
onSetTask={onSetTask}
```

- [ ] **Step 3: Update `WorkspaceRoot.tsx` to pass `onSetTask`**

Add `onSetTask(instanceId: string, taskId: number | null): void;` to Props interface.

Pass it down to each `LeafView` usage:

```typescript
onSetTask={props.onSetTask}
```

- [ ] **Step 4: Update `App.tsx` to wire `useInstances().setTask`**

Destructure `setTask` from `useInstances()`:

```typescript
const { instances, activeId, loaded, setActive, spawn, kill, remove, reorder, refresh, setTask } = useInstances();
```

Pass `onSetTask` to `WorkspaceRoot`:

```typescript
onSetTask={async (instanceId, taskId) => {
  try {
    await setTask(instanceId, taskId);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}}
```

(Import `useToast` in App.tsx if not already imported, or use the existing pattern.)

- [ ] **Step 5: Typecheck client**

```bash
cd /Users/jan/Projects/Watchtower && npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -v "rootDir\|slotProps\|spawn"
```

Expected: No new errors.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/jan/Projects/Watchtower && npm test 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/jan/Projects/Watchtower && git add \
  client/src/components/instances/SessionTabBar.tsx \
  client/src/components/instances/LeafView.tsx \
  client/src/components/instances/WorkspaceRoot.tsx \
  client/src/App.tsx && \
git commit -m "$(cat <<'EOF'
feat(timetracker): add task tag context menu to instance session tabs

Right-click on a session tab shows Přiřadit k úkolu… / Zrušit přiřazení.
Picker opens InstanceTaskPickerDialog (project preselected by cwd prefix match).
Tagged session shows a # indicator and task tooltip.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### 1. Spec coverage check

| Spec requirement | Covered by task |
|---|---|
| Migration v12 with ON DELETE SET NULL | Task 1 |
| `InstanceRow.taskId: number | null` | Task 1 |
| `InstancesRepo.setTask(id, taskId)` | Task 1 |
| `task_id` in every row-read (SELECT * + toRow) | Task 1 |
| `instances:setTask` IPC kind | Task 2 |
| Mirror in `messagePort.ts` | Task 2 |
| Handler pushes `stateChanged` | Task 2 |
| `useInstances.setTask` thin hook method | Task 3 |
| `listInstances` includes `taskId` | Task 3 |
| Context menu "Tag to task…" | Task 5 |
| Context menu "Clear tag" | Task 5 |
| Project preselected by cwd longest-prefix | Task 4 |
| Epic → task cascade | Task 4 |
| Tagged task shown in tab tooltip | Task 5 |
| Tests: setTask round-trip | Task 1 |
| Tests: ON DELETE SET NULL | Task 1 |
| Tests: migration v12 idempotency | Task 1 |

All requirements covered.

### 2. Placeholder scan

No TBD, TODO, or incomplete steps found. All code blocks are complete.

### 3. Type consistency check

- `InstanceRow.taskId: number | null` defined in Task 1, used in Tasks 2–5 consistently.
- `SessionInfo.taskId: number | null` and `SessionInfo.cwd: string` added consistently in Tasks 5.
- `onSetTask(instanceId: string, taskId: number | null): void` signature consistent across LeafView, WorkspaceRoot, App.
- `InstanceTaskPickerDialog` props consistent between creation (Task 4) and usage (Task 5).
- IPC kind `instances:setTask` payload is `{ instanceId: string; taskId: number | null }` consistently in ipcContract and messagePort.

One note: Step 2 of Task 3 also modifies `shared/ipcContract.ts` and `shared/messagePort.ts` (to add `taskId` to `listInstances`). These files are also modified in Task 2. The commit in Task 2 happens before Task 3, so the commit in Task 3 step 6 should add both `ipcContract.ts` and `messagePort.ts` changes together. The git add command in Task 3 step 6 already includes them.

**Important:** The `homedir()` utility in Task 4 relies on a `window.__homeDir` global. Check the actual preload file path before implementing — it may need a different injection mechanism depending on how the preload is structured.
