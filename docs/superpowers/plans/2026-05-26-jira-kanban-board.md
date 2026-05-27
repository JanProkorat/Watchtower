# Jira Kanban Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth TimeTracker tab "Board" that pulls the user's Skoda Jira board (`assignee = currentUser() AND resolution = Unresolved`) into 3 columns (To Do / Doing / Done), upserting tasks under the right local project + auto-creating epics by area-code prefix (`[TEH]`, `[VYR]`, …).

**Architecture:** A new `JiraBoardService` (orchestrator) reuses `JiraSyncService`'s Keychain-cookie + Playwright-SSO `defaultDeps`. Three new IPC kinds (`board:authPing`, `board:get`, `board:sync`). One SQLite migration (v6) adds four nullable columns to `tasks` (`jira_status`, `jira_estimate_secs`, `jira_component`, `jira_synced_at`). Renderer adds a `BoardTab.tsx` component plus a `useBoard` hook; status mapping is precomputed in the orchestrator so the renderer just renders.

**Tech Stack:** TypeScript, React 18, MUI v5, Node `utilityProcess` orchestrator, `node:sqlite` (`DatabaseSync`), Vitest, Electron MessagePort IPC, Jira on-prem REST `/rest/api/2/search`.

**Source spec:** `docs/superpowers/specs/2026-05-26-jira-kanban-board-design.md`

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `orchestrator/services/jiraRouting.ts` | Pure helpers — `detectAreaCode(summary, epicSummary)`, `pickProjectForKey(key, projects)`. No I/O. |
| `orchestrator/services/jiraBoard.ts` | `JiraBoardService` class — `authPing()`, `getSnapshot()`, `sync()`. Reuses `JiraConfig` + `defaultDeps` from `jiraSync.ts`. |
| `tests/orchestrator/jiraRouting.test.ts` | Unit tests for the two pure functions. |
| `tests/orchestrator/jiraBoard.test.ts` | Fake-deps tests for the service — mirrors `jiraSync.test.ts`. |
| `client/src/state/useBoard.ts` | Hook owning `BoardSnapshotPayload` + `BoardAuthPingPayload`; auto-syncs on mount if stale; exposes manual `sync()`. |
| `client/src/components/timetracker/boardChips.ts` | Area-code → chip colour mapping. Pure function. |
| `client/src/components/timetracker/BoardTab.tsx` | The tab body. Contains `BoardHeader`, `BoardColumns`, `BoardCard` (one file). |
| `tests/client/BoardTab.test.tsx` | RTL test: renders seeded snapshot, button toggles by auth state, Refresh dispatches IPC. |

**Modified files**

| Path | What changes |
|---|---|
| `orchestrator/db/migrations.ts` | Add migration version 6. |
| `tests/orchestrator/migrations.test.ts` | Add v6 forward-path test. |
| `orchestrator/db/repositories/tasks.ts` | Read/write the four `jira_*` columns; add `findByNumber(key)`, `updateJiraFields(taskId, fields)`, `clearJiraStatusExcept(keys)`. |
| `tests/orchestrator/epics-tasks-repo.test.ts` | Extend with tests for the new task-repo methods. |
| `shared/ipcContract.ts` | Add 3 new orchestrator kinds + 1 electron-only kind, plus four payload types. |
| `shared/messagePort.ts` | Mirror the 3 orchestrator kinds. |
| `orchestrator/index.ts` | Wire `board:authPing`, `board:get`, `board:sync` to `JiraBoardService`. |
| `electron/ipc.ts` | Add `openExternalUrl` to `ELECTRON_ONLY_KINDS`; handle via `shell.openExternal` with an https-only guard. |
| `client/src/util/timetrackerUrl.ts` | Add `'board'` to `LIST_TABS`. |
| `tests/client/timetrackerUrl.test.ts` | Add cases covering the new tab. |
| `client/src/components/timetracker/ListMode.tsx` | Add `board: 'Board'` to `TAB_LABELS`; render `<BoardTab />` when active. |

---

## Task 1: Schema migration v6

**Files:**
- Modify: `orchestrator/db/migrations.ts`
- Test:   `tests/orchestrator/migrations.test.ts`

- [ ] **Step 1: Add the v6 test case**

Open `tests/orchestrator/migrations.test.ts` and find the highest existing version test (search `version === 5` or similar). Add immediately after:

```ts
it('v6 adds jira_* columns to tasks and the partial index', () => {
  const db = freshDb();              // helper from this test file
  runMigrations(db);
  const cols = (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map(c => c.name);
  expect(cols).toEqual(expect.arrayContaining(['jira_status', 'jira_estimate_secs', 'jira_component', 'jira_synced_at']));
  // The partial index is queryable:
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_jira_status'"
  ).get();
  expect(idx).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- migrations.test`
Expected: FAIL — `jira_status` column missing.

- [ ] **Step 3: Add the v6 migration**

Open `orchestrator/db/migrations.ts`. Append a new entry to the `MIGRATIONS` array, immediately after the v5 entry (before the closing `];`):

```ts
{
  version: 6,
  up: (db) => {
    // Phase 31 Jira Kanban board — cached per-task Jira metadata that's only
    // populated while a task is "on the board" (i.e. in the latest sync's
    // result set). `jira_status IS NULL` is the "not on board" sentinel.
    db.exec(`ALTER TABLE tasks ADD COLUMN jira_status TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN jira_estimate_secs INTEGER`);
    db.exec(`ALTER TABLE tasks ADD COLUMN jira_component TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN jira_synced_at TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_jira_status
               ON tasks(jira_status) WHERE jira_status IS NOT NULL`);
  },
},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- migrations.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/migrations.ts tests/orchestrator/migrations.test.ts
git commit -m "feat(board): add migration v6 — jira_* columns on tasks"
```

---

## Task 2: TasksRepo additions

**Files:**
- Modify: `orchestrator/db/repositories/tasks.ts`
- Test:   `tests/orchestrator/epics-tasks-repo.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `tests/orchestrator/epics-tasks-repo.test.ts`. Inside the existing `describe('TasksRepo', …)` block, add:

```ts
describe('jira fields', () => {
  it('findByNumber returns null when the key does not exist', () => {
    expect(tasks.findByNumber('FIE1933-99999')).toBeNull();
  });

  it('findByNumber returns the row when it exists', () => {
    const epic = epics.create({ projectId, name: 'TEH' });
    const t = tasks.create({ epicId: epic.id, number: 'FIE1933-19796', title: 'foo' });
    const found = tasks.findByNumber('FIE1933-19796');
    expect(found?.id).toBe(t.id);
    expect(found?.number).toBe('FIE1933-19796');
  });

  it('updateJiraFields persists status/estimate/component/syncedAt and reflects in get', () => {
    const epic = epics.create({ projectId, name: 'TEH' });
    const t = tasks.create({ epicId: epic.id, number: 'FIE1933-19796', title: 'foo' });
    tasks.updateJiraFields(t.id, {
      jiraStatus: 'In Review',
      estimateSeconds: 14400,
      component: 'TEH-Vzory',
      syncedAt: '2026-05-26T14:32:00.000Z',
    });
    const got = tasks.get(t.id)!;
    expect(got.jiraStatus).toBe('In Review');
    expect(got.jiraEstimateSecs).toBe(14400);
    expect(got.jiraComponent).toBe('TEH-Vzory');
    expect(got.jiraSyncedAt).toBe('2026-05-26T14:32:00.000Z');
  });

  it('clearJiraStatusExcept clears rows whose number is NOT in the keep-set', () => {
    const epic = epics.create({ projectId, name: 'TEH' });
    const a = tasks.create({ epicId: epic.id, number: 'A-1', title: 'a' });
    const b = tasks.create({ epicId: epic.id, number: 'A-2', title: 'b' });
    const c = tasks.create({ epicId: epic.id, number: 'A-3', title: 'c' });
    for (const id of [a.id, b.id, c.id]) {
      tasks.updateJiraFields(id, { jiraStatus: 'To Do', estimateSeconds: null, component: null, syncedAt: '2026-05-26T00:00:00Z' });
    }
    const cleared = tasks.clearJiraStatusExcept(['A-1', 'A-2']);
    expect(cleared).toBe(1);
    expect(tasks.get(a.id)?.jiraStatus).toBe('To Do');
    expect(tasks.get(b.id)?.jiraStatus).toBe('To Do');
    expect(tasks.get(c.id)?.jiraStatus).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- epics-tasks-repo`
Expected: FAIL — `findByNumber`, `updateJiraFields`, `clearJiraStatusExcept` not defined.

- [ ] **Step 3: Update the TaskView shape and the SELECT**

In `orchestrator/db/repositories/tasks.ts`, extend the `TaskView` interface (find the existing one):

```ts
export interface TaskView {
  id: number;
  epicId: number;
  number: string;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'done';
  estimatedMinutes: number | null;
  createdAt: string;
  totalMinutes: number;
  // Jira board mirror (nullable, populated only while the task is on the board)
  jiraStatus: string | null;
  jiraEstimateSecs: number | null;
  jiraComponent: string | null;
  jiraSyncedAt: string | null;
}
```

Locate the existing SELECT-list (likely a constant or inlined string) used by `get`, `listForEpic`, `listForProject` and add the four columns. Locate the row-to-view mapper and add the four field assignments (camel-cased from snake_case as elsewhere in the repo).

- [ ] **Step 4: Add the three new methods**

Append inside the `TasksRepo` class:

```ts
findByNumber(number: string): TaskView | null {
  const row = this.db
    .prepare(`${TASK_SELECT} WHERE t.number = ? LIMIT 1`)
    .get(number) as TaskRow | undefined;
  return row ? rowToView(row) : null;
}

updateJiraFields(
  id: number,
  fields: {
    jiraStatus: string | null;
    estimateSeconds: number | null;
    component: string | null;
    syncedAt: string;
  },
): void {
  this.db
    .prepare(
      `UPDATE tasks
         SET jira_status = ?, jira_estimate_secs = ?, jira_component = ?, jira_synced_at = ?
         WHERE id = ?`,
    )
    .run(fields.jiraStatus, fields.estimateSeconds, fields.component, fields.syncedAt, id);
}

clearJiraStatusExcept(keepNumbers: string[]): number {
  if (keepNumbers.length === 0) {
    const r = this.db
      .prepare(`UPDATE tasks SET jira_status = NULL WHERE jira_status IS NOT NULL`)
      .run() as { changes: number };
    return r.changes;
  }
  const placeholders = keepNumbers.map(() => '?').join(',');
  const r = this.db
    .prepare(
      `UPDATE tasks SET jira_status = NULL
         WHERE jira_status IS NOT NULL AND number NOT IN (${placeholders})`,
    )
    .run(...keepNumbers) as { changes: number };
  return r.changes;
}
```

(Replace `TASK_SELECT` / `TaskRow` / `rowToView` with the actual identifiers already used in the file — copy the pattern of the existing `get(id)` method.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- epics-tasks-repo`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/db/repositories/tasks.ts tests/orchestrator/epics-tasks-repo.test.ts
git commit -m "feat(board): TasksRepo support for jira_* mirror fields"
```

---

## Task 3: Pure routing functions

**Files:**
- Create: `orchestrator/services/jiraRouting.ts`
- Test:   `tests/orchestrator/jiraRouting.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/orchestrator/jiraRouting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectAreaCode, pickProjectForKey } from '../../orchestrator/services/jiraRouting.js';

describe('detectAreaCode', () => {
  it('extracts area code from a summary bracket tag', () => {
    expect(detectAreaCode('[TEH] Požadavek na změnu', null)).toBe('TEH');
    expect(detectAreaCode('  [VYR]  foo bar', null)).toBe('VYR');
    expect(detectAreaCode('[INFRA] Update', null)).toBe('INFRA');
  });

  it('falls back to epic-summary prefix when no summary tag', () => {
    expect(detectAreaCode('No tag here', 'TEH-Požadavek na NC program')).toBe('TEH');
    expect(detectAreaCode('No tag', 'VYR Foo')).toBe('VYR');
  });

  it('returns null when nothing matches', () => {
    expect(detectAreaCode('No tag here', null)).toBeNull();
    expect(detectAreaCode('No tag here', 'no prefix lowercase')).toBeNull();
  });

  it('summary tag wins over epic prefix', () => {
    expect(detectAreaCode('[KP] foo', 'TEH-something')).toBe('KP');
  });
});

describe('pickProjectForKey', () => {
  const projects = [
    { id: 1, name: 'PPS',        archived: false, jiraGlobs: ['FIE1933-*'] } as any,
    { id: 2, name: 'WT-Local',   archived: false, jiraGlobs: ['WT-*']       } as any,
    { id: 3, name: 'Archived',   archived: true,  jiraGlobs: ['FIE1933-*'] } as any,
  ];

  it('picks the project whose glob matches the key', () => {
    expect(pickProjectForKey('FIE1933-19796', projects)?.id).toBe(1);
    expect(pickProjectForKey('WT-42', projects)?.id).toBe(2);
  });

  it('skips archived projects', () => {
    const only = [projects[2]];
    expect(pickProjectForKey('FIE1933-19796', only)).toBeNull();
  });

  it('returns null when no glob matches', () => {
    expect(pickProjectForKey('UNKNOWN-1', projects)).toBeNull();
  });

  it('returns null on projects with no globs', () => {
    const noglobs = [{ id: 9, name: 'X', archived: false, jiraGlobs: [] } as any];
    expect(pickProjectForKey('X-1', noglobs)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- jiraRouting`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the routing module**

Create `orchestrator/services/jiraRouting.ts`:

```ts
import type { ProjectViewPayload } from '../../shared/ipcContract.js';

const SUMMARY_TAG = /^\s*\[([A-Z][A-Z0-9]*)\]/;
const EPIC_PREFIX = /^([A-Z][A-Z0-9]*)[-\s]/;

/**
 * Extract an area code (`TEH`, `VYR`, `KP`, …) from a Jira ticket.
 *
 * Signals are tried in order — summary bracket tag, then epic-summary
 * prefix. Same precedence as the `jira-fetch` skill, so a mislabelled
 * ticket routes the same way in both tools.
 */
export function detectAreaCode(summary: string, epicSummary: string | null): string | null {
  const m1 = SUMMARY_TAG.exec(summary);
  if (m1) return m1[1];
  if (epicSummary) {
    const m2 = EPIC_PREFIX.exec(epicSummary);
    if (m2) return m2[1];
  }
  return null;
}

/**
 * Match a Jira issue key against each active project's `jiraGlobs`,
 * returning the first project whose glob matches. Archived projects
 * are skipped. Globs use a tiny shell-style matcher (`*` only).
 */
export function pickProjectForKey(
  key: string,
  projects: ProjectViewPayload[],
): ProjectViewPayload | null {
  for (const p of projects) {
    if (p.archived) continue;
    for (const g of p.jiraGlobs) {
      if (matchesGlob(key, g)) return p;
    }
  }
  return null;
}

function matchesGlob(value: string, pattern: string): boolean {
  // Escape regex specials except `*`, then turn `*` into `.*`.
  const re = new RegExp(
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return re.test(value);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- jiraRouting`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/jiraRouting.ts tests/orchestrator/jiraRouting.test.ts
git commit -m "feat(board): pure routing helpers — area code + key→project"
```

---

## Task 4: IPC contract additions

**Files:**
- Modify: `shared/ipcContract.ts`
- Modify: `shared/messagePort.ts`

- [ ] **Step 1: Add the four payload types**

Open `shared/ipcContract.ts`. After the existing `JiraSyncResultPayload` interface, add:

```ts
// ─── Board (Jira Kanban) ───
export interface BoardAuthPingPayload {
  configured: boolean;
  cookiePresent: boolean;
  baseUrl: string | null;
}

export type BoardColumn = 'todo' | 'doing' | 'done';

export interface BoardCardPayload {
  taskId: number;
  jiraKey: string;
  title: string;
  jiraStatus: string;
  column: BoardColumn;
  estimateSeconds: number | null;
  component: string | null;
  projectId: number;
  projectName: string;
  projectColor: string;
  epicId: number;
  epicName: string;
  syncedAt: string | null;
}

export interface BoardSnapshotPayload {
  cards: BoardCardPayload[];
  syncedAt: string | null;
  lastSyncResult: BoardSyncResultPayload | null;
}

export interface BoardSyncResultPayload {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  fetched: number;
  upserted: number;
  created: number;
  unrouted: number;
  unroutedKeys: string[];
  removedFromBoard: number;
  neededBrowserRefresh: boolean;
  error?: string;
}
```

- [ ] **Step 2: Add the four new IPC kinds**

In `shared/ipcContract.ts`, extend the `IpcRequest` union with three orchestrator kinds and one electron-only kind. Find the line ending `| { kind: 'jira:sync'; payload: JiraSyncRequestPayload };` and add immediately before the `;`:

```ts
  | { kind: 'board:authPing'; payload: Record<string, never> }
  | { kind: 'board:get';      payload: Record<string, never> }
  | { kind: 'board:sync';     payload: Record<string, never> }
  | { kind: 'openExternalUrl'; payload: { url: string } }
```

Mirror in `IpcResponse` (find the closing `;` of the union and add before it):

```ts
  | { kind: 'board:authPing'; payload: BoardAuthPingPayload }
  | { kind: 'board:get';      payload: BoardSnapshotPayload }
  | { kind: 'board:sync';     payload: { snapshot: BoardSnapshotPayload; result: BoardSyncResultPayload } }
  | { kind: 'openExternalUrl'; payload: { ok: boolean; error?: string } }
```

- [ ] **Step 3: Mirror the three orchestrator kinds into `messagePort.ts`**

Open `shared/messagePort.ts`. Locate `OrchRequest` / `OrchResponse` (the wire-type unions used between electron-main and the orchestrator child). Mirror the `board:*` kinds (NOT `openExternalUrl` — that's electron-only). Add to the request union:

```ts
  | { kind: 'board:authPing'; payload: Record<string, never> }
  | { kind: 'board:get';      payload: Record<string, never> }
  | { kind: 'board:sync';     payload: Record<string, never> }
```

And to the response union:

```ts
  | { kind: 'board:authPing'; payload: BoardAuthPingPayload }
  | { kind: 'board:get';      payload: BoardSnapshotPayload }
  | { kind: 'board:sync';     payload: { snapshot: BoardSnapshotPayload; result: BoardSyncResultPayload } }
```

If the file does not currently import these types, add:

```ts
import type {
  BoardAuthPingPayload,
  BoardSnapshotPayload,
  BoardSyncResultPayload,
} from './ipcContract.js';
```

- [ ] **Step 4: Verify typecheck still passes**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit` and `npx tsc -p client/tsconfig.json --noEmit`
Expected: no new errors. (Existing known drift OK per CLAUDE.md.)

- [ ] **Step 5: Commit**

```bash
git add shared/ipcContract.ts shared/messagePort.ts
git commit -m "feat(board): IPC contracts for board:authPing/get/sync + openExternalUrl"
```

---

## Task 5: JiraBoardService — `authPing` + `getSnapshot`

**Files:**
- Create: `orchestrator/services/jiraBoard.ts`
- Test:   `tests/orchestrator/jiraBoard.test.ts`

- [ ] **Step 1: Write the failing tests for authPing + getSnapshot**

Create `tests/orchestrator/jiraBoard.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';
import { EpicsRepo } from '../../orchestrator/db/repositories/epics.js';
import { TasksRepo } from '../../orchestrator/db/repositories/tasks.js';
import { JiraBoardService, type BoardSyncDeps } from '../../orchestrator/services/jiraBoard.js';
import type { JiraConfig } from '../../orchestrator/services/jiraSync.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

const CONFIG: JiraConfig = {
  baseUrl: 'https://jira.test',
  keychainService: 'test-service',
  keychainAccount: 'test-account',
  refreshScript: '/tmp/refresh.js',
};

function fakeDeps(overrides: Partial<BoardSyncDeps> = {}): BoardSyncDeps {
  return {
    readCookie: () => 'session=abc',
    runRefresh: async () => {},
    fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    now: () => new Date('2026-05-26T14:32:00Z'),
    ...overrides,
  };
}

describe('JiraBoardService.authPing', () => {
  it('reports configured + cookiePresent when env and Keychain are set', () => {
    const svc = new JiraBoardService(freshDb(), { config: CONFIG, deps: fakeDeps() });
    const r = svc.authPing();
    expect(r.configured).toBe(true);
    expect(r.cookiePresent).toBe(true);
    expect(r.baseUrl).toBe('https://jira.test');
  });

  it('reports cookiePresent=false when Keychain entry is missing', () => {
    const svc = new JiraBoardService(freshDb(), {
      config: CONFIG,
      deps: fakeDeps({ readCookie: () => '' }),
    });
    expect(svc.authPing().cookiePresent).toBe(false);
  });

  it('reports configured=false when baseUrl or account is empty', () => {
    const svc = new JiraBoardService(freshDb(), {
      config: { ...CONFIG, baseUrl: '' },
      deps: fakeDeps(),
    });
    const r = svc.authPing();
    expect(r.configured).toBe(false);
    expect(r.baseUrl).toBeNull();
  });
});

describe('JiraBoardService.getSnapshot', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo;
  let epics: EpicsRepo;
  let tasks: TasksRepo;

  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
  });

  it('returns only tasks with jira_status set, mapped to columns', () => {
    const p = projects.create({ name: 'PPS', color: '#7aa7ff' });
    const e = epics.create({ projectId: p.id, name: 'TEH' });
    const a = tasks.create({ epicId: e.id, number: 'FIE-1', title: 'a' });
    const b = tasks.create({ epicId: e.id, number: 'FIE-2', title: 'b' });
    const c = tasks.create({ epicId: e.id, number: 'FIE-3', title: 'c' });
    tasks.updateJiraFields(a.id, { jiraStatus: 'To Do',       estimateSeconds: 21600, component: 'TEH-X', syncedAt: '2026-05-26T14:32:00Z' });
    tasks.updateJiraFields(b.id, { jiraStatus: 'In Progress', estimateSeconds: 7200,  component: null,    syncedAt: '2026-05-26T14:32:00Z' });
    // c left without jira_status — should be omitted

    const svc = new JiraBoardService(db, { config: CONFIG, deps: fakeDeps() });
    const snap = svc.getSnapshot();
    expect(snap.cards.map(x => x.jiraKey).sort()).toEqual(['FIE-1', 'FIE-2']);
    const m = Object.fromEntries(snap.cards.map(x => [x.jiraKey, x.column]));
    expect(m['FIE-1']).toBe('todo');
    expect(m['FIE-2']).toBe('doing');
    expect(snap.syncedAt).toBe('2026-05-26T14:32:00Z');
  });

  it('maps every documented Jira status to the right column', () => {
    const p = projects.create({ name: 'PPS', color: '#7aa7ff' });
    const e = epics.create({ projectId: p.id, name: 'TEH' });
    const cases: Array<[string, 'todo' | 'doing' | 'done']> = [
      ['To Do', 'todo'],
      ['In Progress', 'doing'],
      ['Waiting', 'doing'],
      ['In Review', 'doing'],
      ['In Test', 'done'],
      ['To Accept', 'done'],
      ['Done', 'done'],
    ];
    for (const [i, [status]] of cases.entries()) {
      const t = tasks.create({ epicId: e.id, number: `K-${i}`, title: status });
      tasks.updateJiraFields(t.id, { jiraStatus: status, estimateSeconds: null, component: null, syncedAt: '2026-05-26T14:32:00Z' });
    }
    const svc = new JiraBoardService(db, { config: CONFIG, deps: fakeDeps() });
    const snap = svc.getSnapshot();
    const byKey = Object.fromEntries(snap.cards.map(x => [x.jiraStatus, x.column]));
    for (const [status, col] of cases) expect(byKey[status]).toBe(col);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- jiraBoard`
Expected: FAIL — `JiraBoardService` not exported.

- [ ] **Step 3: Skeleton + the two methods**

Create `orchestrator/services/jiraBoard.ts` with the constants, the service shell, and the two read methods:

```ts
import type { SqliteLike } from '../db/migrations.js';
import {
  defaultDeps,
  loadJiraConfigFromEnv,
  type JiraConfig,
  type JiraSyncDeps,
} from './jiraSync.js';
import type {
  BoardAuthPingPayload,
  BoardCardPayload,
  BoardColumn,
  BoardSnapshotPayload,
  BoardSyncResultPayload,
} from '../../shared/ipcContract.js';

export type BoardSyncDeps = JiraSyncDeps;

export const STATUS_TO_COLUMN: Record<string, BoardColumn> = {
  'To Do':       'todo',
  'In Progress': 'doing',
  'Waiting':     'doing',
  'In Review':   'doing',
  'In Test':     'done',
  'To Accept':   'done',
  'Done':        'done',
};

export const COLUMN_TO_LOCAL_STATUS: Record<BoardColumn, 'open' | 'in_progress' | 'done'> = {
  todo:  'open',
  doing: 'in_progress',
  done:  'done',
};

interface SnapshotRow {
  task_id: number;
  jira_key: string;
  title: string;
  jira_status: string;
  jira_estimate_secs: number | null;
  jira_component: string | null;
  jira_synced_at: string | null;
  project_id: number;
  project_name: string;
  project_color: string;
  epic_id: number;
  epic_name: string;
}

const SNAPSHOT_SQL = `
  SELECT
    t.id            AS task_id,
    t.number        AS jira_key,
    t.title         AS title,
    t.jira_status   AS jira_status,
    t.jira_estimate_secs AS jira_estimate_secs,
    t.jira_component AS jira_component,
    t.jira_synced_at AS jira_synced_at,
    p.id            AS project_id,
    p.name          AS project_name,
    p.color         AS project_color,
    e.id            AS epic_id,
    e.name          AS epic_name
  FROM tasks t
  JOIN epics    e ON e.id = t.epic_id
  JOIN projects p ON p.id = e.project_id
  WHERE t.jira_status IS NOT NULL
  ORDER BY t.jira_estimate_secs DESC NULLS LAST, t.number ASC
`;

export interface JiraBoardServiceOptions {
  config?: JiraConfig;
  deps?: BoardSyncDeps;
}

export class JiraBoardService {
  private readonly cfg: JiraConfig;
  private readonly deps: BoardSyncDeps;

  constructor(
    private readonly db: SqliteLike,
    opts: JiraBoardServiceOptions = {},
  ) {
    this.cfg  = opts.config ?? loadJiraConfigFromEnv();
    this.deps = opts.deps   ?? defaultDeps;
  }

  authPing(): BoardAuthPingPayload {
    const configured = Boolean(this.cfg.baseUrl) && Boolean(this.cfg.keychainAccount);
    const cookiePresent = configured ? Boolean(this.deps.readCookie(this.cfg)) : false;
    return {
      configured,
      cookiePresent,
      baseUrl: this.cfg.baseUrl || null,
    };
  }

  getSnapshot(): BoardSnapshotPayload {
    const rows = this.db.prepare(SNAPSHOT_SQL).all() as SnapshotRow[];
    const cards: BoardCardPayload[] = rows.map((r) => ({
      taskId: r.task_id,
      jiraKey: r.jira_key,
      title: r.title,
      jiraStatus: r.jira_status,
      column: STATUS_TO_COLUMN[r.jira_status] ?? 'doing',
      estimateSeconds: r.jira_estimate_secs,
      component: r.jira_component,
      projectId: r.project_id,
      projectName: r.project_name,
      projectColor: r.project_color,
      epicId: r.epic_id,
      epicName: r.epic_name,
      syncedAt: r.jira_synced_at,
    }));
    const syncedAt = cards.reduce<string | null>((max, c) => {
      if (!c.syncedAt) return max;
      if (!max || c.syncedAt > max) return c.syncedAt;
      return max;
    }, null);
    return { cards, syncedAt, lastSyncResult: null };
  }

  async sync(): Promise<BoardSyncResultPayload> {
    // implemented in Task 6
    throw new Error('not implemented');
  }
}
```

> If SQLite refuses `NULLS LAST`, replace the ORDER BY with
> `ORDER BY (t.jira_estimate_secs IS NULL), t.jira_estimate_secs DESC, t.number ASC`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- jiraBoard`
Expected: PASS for the `authPing` + `getSnapshot` blocks.

- [ ] **Step 5: Commit**

```ts
git add orchestrator/services/jiraBoard.ts tests/orchestrator/jiraBoard.test.ts
git commit -m "feat(board): JiraBoardService.authPing + getSnapshot"
```

---

## Task 6: JiraBoardService — `sync` (with fake-deps tests)

**Files:**
- Modify: `orchestrator/services/jiraBoard.ts`
- Test:   `tests/orchestrator/jiraBoard.test.ts`

- [ ] **Step 1: Write the failing sync tests**

Append to `tests/orchestrator/jiraBoard.test.ts`:

```ts
function makeFetchDeps(opts: {
  cookies: string[];
  responses: Array<{ status: number; body?: unknown }>;
  refresh?: () => Promise<void>;
  calls?: Array<{ url: string; body?: any }>;
}): BoardSyncDeps {
  let ci = 0, fi = 0;
  return {
    readCookie: () => opts.cookies[Math.min(ci++, opts.cookies.length - 1)],
    runRefresh: opts.refresh ?? (async () => {}),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const r = opts.responses[Math.min(fi, opts.responses.length - 1)];
      fi += 1;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      opts.calls?.push({ url: String(input), body });
      return new Response(r.body !== undefined ? JSON.stringify(r.body) : null, { status: r.status });
    }) as typeof fetch,
    now: () => new Date('2026-05-26T14:32:00Z'),
  };
}

function jiraIssue(key: string, summary: string, status: string, estimateSecs: number | null, labels: string[] = []) {
  return {
    key,
    fields: {
      summary,
      status: { name: status },
      timeoriginalestimate: estimateSecs,
      labels,
      components: [],
    },
  };
}

describe('JiraBoardService.sync', () => {
  let db: SqliteLike;
  let projects: ProjectsRepo;
  let epics: EpicsRepo;
  let tasks: TasksRepo;
  let pps: ReturnType<ProjectsRepo['create']>;

  beforeEach(() => {
    db = freshDb();
    projects = new ProjectsRepo(db);
    epics = new EpicsRepo(db);
    tasks = new TasksRepo(db);
    pps = projects.create({ name: 'PPS', color: '#7aa7ff', jiraGlobs: ['FIE1933-*'] });
  });

  it('creates new tasks under auto-created epics by area code', async () => {
    const calls: any[] = [];
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        calls,
        responses: [
          {
            status: 200,
            body: {
              issues: [
                jiraIssue('FIE1933-19796', '[VYR] Požadavky na Materiál', 'In Review', 14400, ['VYR-Logistika']),
                jiraIssue('FIE1933-19845', '[TEH] Požadavek na Změnu',    'To Do',     21600, ['TEH-Změny']),
              ],
            },
          },
        ],
      }),
    });

    const r = await svc.sync();
    expect(r.ok).toBe(true);
    expect(r.fetched).toBe(2);
    expect(r.created).toBe(2);
    expect(r.unrouted).toBe(0);
    expect(r.removedFromBoard).toBe(0);
    // JQL/search URL was hit:
    expect(calls[0].url).toContain('/rest/api/2/search');

    // Tasks created under the right epics:
    const vyr = tasks.findByNumber('FIE1933-19796')!;
    const teh = tasks.findByNumber('FIE1933-19845')!;
    expect(vyr.jiraStatus).toBe('In Review');
    expect(vyr.jiraEstimateSecs).toBe(14400);
    expect(vyr.jiraComponent).toBe('VYR-Logistika');
    expect(teh.jiraStatus).toBe('To Do');
    // Epics are present and named after the area code:
    const allEpics = epics.listForProject(pps.id);
    expect(allEpics.map(e => e.name).sort()).toEqual(['TEH', 'VYR']);
  });

  it('updates an existing task without re-routing its epic', async () => {
    const original = epics.create({ projectId: pps.id, name: 'PreExisting' });
    const t = tasks.create({ epicId: original.id, number: 'FIE1933-1', title: 'old title' });

    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          { status: 200, body: { issues: [jiraIssue('FIE1933-1', '[TEH] new title', 'In Progress', 3600)] } },
        ],
      }),
    });
    const r = await svc.sync();
    expect(r.created).toBe(0);
    expect(r.upserted).toBe(1);
    const updated = tasks.get(t.id)!;
    expect(updated.title).toBe('[TEH] new title');
    expect(updated.epicId).toBe(original.id);  // epic unchanged
    expect(updated.jiraStatus).toBe('In Progress');
  });

  it('counts and lists unrouted keys when no project glob matches', async () => {
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [
          { status: 200, body: { issues: [jiraIssue('OTHER-1', '[X] foo', 'To Do', null)] } },
        ],
      }),
    });
    const r = await svc.sync();
    expect(r.unrouted).toBe(1);
    expect(r.unroutedKeys).toEqual(['OTHER-1']);
    expect(tasks.findByNumber('OTHER-1')).toBeNull();
  });

  it('clears jira_status on tasks that fell off the board', async () => {
    const epic = epics.create({ projectId: pps.id, name: 'TEH' });
    const t = tasks.create({ epicId: epic.id, number: 'FIE1933-OLD', title: 'old' });
    tasks.updateJiraFields(t.id, { jiraStatus: 'To Do', estimateSeconds: null, component: null, syncedAt: '2026-05-25T10:00:00Z' });

    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['session=abc'],
        responses: [{ status: 200, body: { issues: [jiraIssue('FIE1933-NEW', '[TEH] new', 'To Do', null)] } }],
      }),
    });
    const r = await svc.sync();
    expect(r.removedFromBoard).toBe(1);
    expect(tasks.get(t.id)!.jiraStatus).toBeNull();
  });

  it('refreshes the cookie on 401 and retries once', async () => {
    let refreshed = 0;
    const svc = new JiraBoardService(db, {
      config: CONFIG,
      deps: makeFetchDeps({
        cookies: ['stale', 'fresh'],
        refresh: async () => { refreshed += 1; },
        responses: [
          { status: 401 },
          { status: 200, body: { issues: [jiraIssue('FIE1933-1', '[TEH] x', 'To Do', null)] } },
        ],
      }),
    });
    const r = await svc.sync();
    expect(refreshed).toBe(1);
    expect(r.neededBrowserRefresh).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('returns ok=false and an error when not configured', async () => {
    const svc = new JiraBoardService(db, {
      config: { ...CONFIG, baseUrl: '' },
      deps: makeFetchDeps({ cookies: [''], responses: [{ status: 200 }] }),
    });
    const r = await svc.sync();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- jiraBoard`
Expected: FAIL — sync still throws `not implemented`.

- [ ] **Step 3: Implement `sync`**

In `orchestrator/services/jiraBoard.ts`, replace the `sync` stub with the full implementation. Also import `ProjectsRepo` / `EpicsRepo` / `TasksRepo` and `detectAreaCode` / `pickProjectForKey` at the top:

```ts
import { ProjectsRepo } from '../db/repositories/projects.js';
import { EpicsRepo }    from '../db/repositories/epics.js';
import { TasksRepo }    from '../db/repositories/tasks.js';
import { detectAreaCode, pickProjectForKey } from './jiraRouting.js';
```

Constants near the top of the file:

```ts
const JQL = 'assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC, updated DESC';
const SEARCH_FIELDS = 'summary,status,timeoriginalestimate,labels,components';
const MAX_RESULTS = 200;

interface JiraIssueHit {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    timeoriginalestimate: number | null;
    labels?: string[];
    components?: Array<{ name: string }>;
  };
}

function pickComponent(hit: JiraIssueHit): string | null {
  const comp = hit.fields.components?.[0]?.name;
  if (comp) return comp;
  const label = hit.fields.labels?.[0];
  return label ?? null;
}

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403 || status === 302 || status === 303;
}

function notConfiguredResult(now: Date): BoardSyncResultPayload {
  const iso = now.toISOString();
  return {
    ok: false,
    startedAt: iso,
    finishedAt: iso,
    fetched: 0, upserted: 0, created: 0,
    unrouted: 0, unroutedKeys: [], removedFromBoard: 0,
    neededBrowserRefresh: false,
    error: 'Jira board is not configured — set JIRA_BASE_URL and JIRA_KEYCHAIN_ACCOUNT.',
  };
}
```

Replace the `sync` body with:

```ts
async sync(): Promise<BoardSyncResultPayload> {
  const now = this.deps.now();
  const startedAt = now.toISOString();
  if (!this.cfg.baseUrl || !this.cfg.keychainAccount) {
    return notConfiguredResult(now);
  }

  let cookie = this.deps.readCookie(this.cfg);
  let neededBrowserRefresh = false;
  const ensureCookie = async () => {
    neededBrowserRefresh = true;
    await this.deps.runRefresh(this.cfg);
    cookie = this.deps.readCookie(this.cfg);
    if (!cookie) throw new Error('Cookie refresh ran but no cookie was stored');
  };
  if (!cookie) {
    try { await ensureCookie(); }
    catch (err) {
      return {
        ok: false,
        startedAt, finishedAt: this.deps.now().toISOString(),
        fetched: 0, upserted: 0, created: 0,
        unrouted: 0, unroutedKeys: [], removedFromBoard: 0,
        neededBrowserRefresh,
        error: (err as Error).message,
      };
    }
  }

  // Fetch (with one auth-retry).
  const url = `${this.cfg.baseUrl}/rest/api/2/search`;
  const body = JSON.stringify({ jql: JQL, fields: SEARCH_FIELDS.split(','), maxResults: MAX_RESULTS });
  const callOnce = async () =>
    this.deps.fetch(url, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });
  let res = await callOnce();
  if (isAuthFailure(res.status)) {
    try { await ensureCookie(); }
    catch (err) {
      return {
        ok: false,
        startedAt, finishedAt: this.deps.now().toISOString(),
        fetched: 0, upserted: 0, created: 0,
        unrouted: 0, unroutedKeys: [], removedFromBoard: 0,
        neededBrowserRefresh,
        error: (err as Error).message,
      };
    }
    res = await callOnce();
  }
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      startedAt, finishedAt: this.deps.now().toISOString(),
      fetched: 0, upserted: 0, created: 0,
      unrouted: 0, unroutedKeys: [], removedFromBoard: 0,
      neededBrowserRefresh,
      error: `Jira HTTP ${res.status}: ${text.slice(0, 400)}`,
    };
  }
  const data = (await res.json()) as { issues?: JiraIssueHit[] };
  const issues = data.issues ?? [];

  // Upsert each hit.
  const projectsRepo = new ProjectsRepo(this.db);
  const epicsRepo    = new EpicsRepo(this.db);
  const tasksRepo    = new TasksRepo(this.db);
  const allProjects  = projectsRepo.list({});

  const syncedAt = this.deps.now().toISOString();
  let created = 0, upserted = 0, unrouted = 0;
  const unroutedKeys: string[] = [];
  const seenKeys: string[] = [];

  for (const hit of issues) {
    seenKeys.push(hit.key);
    const status = hit.fields.status.name;
    const column = STATUS_TO_COLUMN[status];
    const localStatus = column ? COLUMN_TO_LOCAL_STATUS[column] : 'open';

    const existing = tasksRepo.findByNumber(hit.key);
    if (existing) {
      tasksRepo.update(existing.id, { title: hit.fields.summary, status: localStatus });
      tasksRepo.updateJiraFields(existing.id, {
        jiraStatus: status,
        estimateSeconds: hit.fields.timeoriginalestimate ?? null,
        component: pickComponent(hit),
        syncedAt,
      });
      upserted += 1;
      continue;
    }

    const project = pickProjectForKey(hit.key, allProjects);
    if (!project) {
      unrouted += 1;
      unroutedKeys.push(hit.key);
      continue;
    }
    const areaCode = detectAreaCode(hit.fields.summary, null);
    const epicName = areaCode ?? 'Other';
    const existingEpics = epicsRepo.listForProject(project.id);
    const epic = existingEpics.find(e => e.name === epicName)
      ?? epicsRepo.create({ projectId: project.id, name: epicName });
    const newTask = tasksRepo.create({
      epicId: epic.id,
      number: hit.key,
      title: hit.fields.summary,
      status: localStatus,
    });
    tasksRepo.updateJiraFields(newTask.id, {
      jiraStatus: status,
      estimateSeconds: hit.fields.timeoriginalestimate ?? null,
      component: pickComponent(hit),
      syncedAt,
    });
    created += 1;
    upserted += 1;
  }

  const removedFromBoard = tasksRepo.clearJiraStatusExcept(seenKeys);
  return {
    ok: true,
    startedAt,
    finishedAt: this.deps.now().toISOString(),
    fetched: issues.length,
    upserted,
    created,
    unrouted,
    unroutedKeys,
    removedFromBoard,
    neededBrowserRefresh,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- jiraBoard`
Expected: PASS for the full file.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/jiraBoard.ts tests/orchestrator/jiraBoard.test.ts
git commit -m "feat(board): JiraBoardService.sync — JQL fetch + upsert + stale clear"
```

---

## Task 7: Orchestrator IPC handlers

**Files:**
- Modify: `orchestrator/index.ts`

- [ ] **Step 1: Import the service**

Near the existing `JiraSyncService` import, add:

```ts
import { JiraBoardService } from './services/jiraBoard.js';
```

- [ ] **Step 2: Wire the three new cases**

Find the existing `case 'jira:sync':` handler and add immediately after the surrounding `}` of the request switch (but before the function's closing `}`):

```ts
    case 'board:authPing':
      return new JiraBoardService(handle!.db).authPing();

    case 'board:get':
      return new JiraBoardService(handle!.db).getSnapshot();

    case 'board:sync': {
      const svc = new JiraBoardService(handle!.db);
      const result = await svc.sync();
      const snapshot: BoardSnapshotPayload = { ...svc.getSnapshot(), lastSyncResult: result };
      return { snapshot, result };
    }
```

Also add at the top of the file (near other `import type`s):

```ts
import type { BoardSnapshotPayload } from '../shared/ipcContract.js';
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(board): orchestrator IPC handlers for board:authPing/get/sync"
```

---

## Task 8: Electron `openExternalUrl`

**Files:**
- Modify: `electron/ipc.ts`

- [ ] **Step 1: Add the handler**

In `electron/ipc.ts`, extend `ELECTRON_ONLY_KINDS`:

```ts
const ELECTRON_ONLY_KINDS = new Set<IpcRequest['kind']>([
  'chooseDirectory',
  'sendTestNotification',
  'openInVSCode',
  'openExternalUrl',
]);
```

And add the branch inside the `ipcMain.handle('watchtower:invoke', …)` block, immediately after the `openInVSCode` handler:

```ts
if (kind === 'openExternalUrl') {
  const { url } = payload as { url: string };
  // https-only guard: refuse anything else so a malicious payload can't
  // launch local apps via custom URL schemes.
  if (!/^https:\/\//.test(url)) {
    return { ok: false, error: 'openExternalUrl: only https:// URLs are allowed' };
  }
  await shell.openExternal(url);
  return { ok: true };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p electron/tsconfig.json --noEmit` (or whichever tsconfig covers electron — fall back to `npx tsc --noEmit` on the file if needed).
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/ipc.ts
git commit -m "feat(board): openExternalUrl IPC (https-only, shell.openExternal)"
```

---

## Task 9: Tab plumbing + chip palette

**Files:**
- Modify: `client/src/util/timetrackerUrl.ts`
- Test:   `tests/client/timetrackerUrl.test.ts`
- Create: `client/src/components/timetracker/boardChips.ts`

- [ ] **Step 1: Failing test for the new tab**

In `tests/client/timetrackerUrl.test.ts`, add:

```ts
it('parses the new board tab', () => {
  expect(parseTimeTrackerHash('#timetracker/board')).toEqual({ mode: 'list', tab: 'board' });
});

it('round-trips the board hash', () => {
  expect(timetrackerHash({ mode: 'list', tab: 'board' })).toBe('#timetracker/board');
});
```

- [ ] **Step 2: Run, see fail**

Run: `npm test -- timetrackerUrl`
Expected: FAIL — `'board'` is not a valid tab.

- [ ] **Step 3: Add `'board'` to LIST_TABS**

In `client/src/util/timetrackerUrl.ts`, change:

```ts
export const LIST_TABS = ['projects', 'worklogs', 'grid', 'timeoff', 'reports', 'board'] as const;
```

- [ ] **Step 4: Run, see pass**

Run: `npm test -- timetrackerUrl`
Expected: PASS.

- [ ] **Step 5: Create the chip palette**

Create `client/src/components/timetracker/boardChips.ts`:

```ts
/** Returns a (background, text) colour pair for a given area-code prefix. */
export function areaCodeColours(areaCode: string | null): { bg: string; fg: string } {
  switch (areaCode) {
    case 'TEH':      return { bg: '#7c3aed', fg: '#ffffff' };
    case 'VYR':      return { bg: '#d97706', fg: '#1f1300' };
    case 'KP':       return { bg: '#2563eb', fg: '#ffffff' };
    case 'INFRA':    return { bg: '#0ea5e9', fg: '#ffffff' };
    case 'LOG':      return { bg: '#16a34a', fg: '#ffffff' };
    case 'KONTROLA': return { bg: '#ef4444', fg: '#ffffff' };
    case 'STR':      return { bg: '#6366f1', fg: '#ffffff' };
    default:         return { bg: '#4b5563', fg: '#ffffff' };
  }
}

/** Pull the area-code prefix off a component label like "TEH-Technologický postup". */
export function areaCodeFromComponent(component: string | null): string | null {
  if (!component) return null;
  const m = /^([A-Z][A-Z0-9]*)/.exec(component);
  return m?.[1] ?? null;
}
```

- [ ] **Step 6: Commit**

```bash
git add client/src/util/timetrackerUrl.ts \
        tests/client/timetrackerUrl.test.ts \
        client/src/components/timetracker/boardChips.ts
git commit -m "feat(board): add 'board' tab to LIST_TABS + chip palette helper"
```

---

## Task 10: `useBoard` hook

**Files:**
- Create: `client/src/state/useBoard.ts`

- [ ] **Step 1: Implement the hook**

Create `client/src/state/useBoard.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BoardAuthPingPayload,
  BoardSnapshotPayload,
  BoardSyncResultPayload,
} from '../../../shared/ipcContract.js';

const STALE_MS = 5 * 60 * 1000;

export interface BoardState {
  loading: boolean;
  syncing: boolean;
  snapshot: BoardSnapshotPayload | null;
  auth: BoardAuthPingPayload | null;
  syncError: string | null;
  lastSyncResult: BoardSyncResultPayload | null;
}

export interface UseBoard extends BoardState {
  sync(): Promise<void>;
}

function isStale(snapshot: BoardSnapshotPayload | null, now: number): boolean {
  if (!snapshot?.syncedAt) return true;
  return now - Date.parse(snapshot.syncedAt) > STALE_MS;
}

export function useBoard(active: boolean): UseBoard {
  const [state, setState] = useState<BoardState>({
    loading: true,
    syncing: false,
    snapshot: null,
    auth: null,
    syncError: null,
    lastSyncResult: null,
  });
  const autoSyncedOnceRef = useRef(false);

  const refreshSnapshot = useCallback(async () => {
    const [snapshot, auth] = await Promise.all([
      window.watchtower.invoke('board:get', {}),
      window.watchtower.invoke('board:authPing', {}),
    ]);
    setState((s) => ({ ...s, snapshot, auth, loading: false }));
    return { snapshot, auth };
  }, []);

  const sync = useCallback(async () => {
    setState((s) => ({ ...s, syncing: true, syncError: null }));
    try {
      const { snapshot, result } = await window.watchtower.invoke('board:sync', {});
      const auth = await window.watchtower.invoke('board:authPing', {});
      setState((s) => ({
        ...s,
        snapshot,
        auth,
        syncing: false,
        lastSyncResult: result,
        syncError: result.error ?? null,
      }));
    } catch (err) {
      setState((s) => ({ ...s, syncing: false, syncError: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  // On tab activation: load DB + auth. If signed in and stale, auto-sync once.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      const { snapshot, auth } = await refreshSnapshot();
      if (cancelled) return;
      if (!autoSyncedOnceRef.current && auth.cookiePresent && isStale(snapshot, Date.now())) {
        autoSyncedOnceRef.current = true;
        await sync();
      }
    })();
    return () => { cancelled = true; };
  }, [active, refreshSnapshot, sync]);

  return { ...state, sync };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/state/useBoard.ts
git commit -m "feat(board): useBoard hook — auto-sync on mount if stale"
```

---

## Task 11: `BoardTab` component

**Files:**
- Create: `client/src/components/timetracker/BoardTab.tsx`
- Modify: `client/src/components/timetracker/ListMode.tsx`

- [ ] **Step 1: Implement `BoardTab.tsx`**

Create `client/src/components/timetracker/BoardTab.tsx`:

```tsx
import { useMemo } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Typography,
} from '@mui/material';
import RefreshIcon       from '@mui/icons-material/Refresh';
import VpnKeyIcon        from '@mui/icons-material/VpnKey';
import LaunchIcon        from '@mui/icons-material/Launch';
import ScheduleIcon      from '@mui/icons-material/Schedule';
import WarningAmberIcon  from '@mui/icons-material/WarningAmber';
import { useBoard } from '../../state/useBoard.js';
import { useToast } from '../../state/useToast.js';
import { areaCodeColours, areaCodeFromComponent } from './boardChips.js';
import type { BoardCardPayload, BoardColumn } from '../../../../shared/ipcContract.js';

const COLUMNS: Array<{ id: BoardColumn; label: string }> = [
  { id: 'todo',  label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'done',  label: 'Done' },
];

function formatSecs(secs: number | null): string | null {
  if (secs == null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatSynced(iso: string | null): string {
  if (!iso) return 'Never synced';
  const d = new Date(iso);
  return `Synced ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface Props { active: boolean; }

export function BoardTab({ active }: Props) {
  const { snapshot, auth, syncing, syncError, lastSyncResult, sync } = useBoard(active);
  const { showError } = useToast();

  const byCol = useMemo(() => {
    const map: Record<BoardColumn, BoardCardPayload[]> = { todo: [], doing: [], done: [] };
    snapshot?.cards.forEach((c) => map[c.column].push(c));
    return map;
  }, [snapshot]);

  const handleClickCard = (c: BoardCardPayload) => {
    if (!auth?.baseUrl) return;
    void window.watchtower
      .invoke('openExternalUrl', { url: `${auth.baseUrl}/browse/${c.jiraKey}` })
      .catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
  };

  const handleBoardLink = () => {
    if (!auth?.baseUrl) return;
    void window.watchtower
      .invoke('openExternalUrl', { url: `${auth.baseUrl}/secure/RapidBoard.jspa?rapidView=51682` })
      .catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
  };

  const unrouted = lastSyncResult?.unroutedKeys ?? [];

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2, gap: 2 }}>

      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Board</Typography>
        {auth?.baseUrl && (
          <Button size="small" onClick={handleBoardLink} startIcon={<LaunchIcon sx={{ fontSize: 16 }} />}>
            Open in Jira
          </Button>
        )}
        <Typography variant="caption" color="text.secondary">·</Typography>
        <Typography variant="caption" color="text.secondary">
          <ScheduleIcon sx={{ fontSize: 13, verticalAlign: -2, mr: 0.5 }} />
          {auth?.configured === false ? 'Not configured'
            : auth?.cookiePresent ? formatSynced(snapshot?.syncedAt ?? null)
            : 'Not signed in'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {lastSyncResult?.neededBrowserRefresh && (
          <Chip size="small" color="info" label="Re-authenticated" />
        )}
        {auth?.configured && auth.cookiePresent && (
          <Button
            variant="contained" size="small"
            onClick={() => void sync()}
            disabled={syncing}
            startIcon={syncing ? <CircularProgress size={14} /> : <RefreshIcon />}
          >
            {syncing ? 'Syncing…' : 'Refresh'}
          </Button>
        )}
        {auth?.configured && !auth.cookiePresent && (
          <Button
            variant="contained" size="small"
            onClick={() => void sync()}
            disabled={syncing}
            startIcon={syncing ? <CircularProgress size={14} /> : <VpnKeyIcon />}
          >
            {syncing ? 'Opening…' : 'Sign in to Jira'}
          </Button>
        )}
      </Stack>

      {auth && !auth.configured && (
        <Alert severity="info">
          Jira sync isn't configured. Set <code>JIRA_BASE_URL</code> and{' '}
          <code>JIRA_KEYCHAIN_ACCOUNT</code> and restart Watchtower.
        </Alert>
      )}

      {syncError && <Alert severity="error">{syncError}</Alert>}

      {unrouted.length > 0 && (
        <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />}>
          <strong>{unrouted.length} tickets couldn't be slotted into any local project.</strong>
          <Box sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, mt: 0.5 }}>
            {unrouted.join(', ')} · Add a matching glob to a project's Jira keys to include them.
          </Box>
        </Alert>
      )}

      {/* Columns */}
      <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, minHeight: 0 }}>
        {COLUMNS.map((col) => (
          <Box
            key={col.id}
            sx={{
              display: 'flex', flexDirection: 'column',
              bgcolor: 'background.paper',
              border: 1, borderColor: 'divider',
              borderRadius: 2, overflow: 'hidden',
              minHeight: 0,
            }}
          >
            <Stack
              direction="row" alignItems="center" justifyContent="space-between"
              sx={{
                px: 1.5, py: 1.25,
                fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase',
                fontWeight: 600, color: 'text.secondary',
                borderBottom: 1, borderColor: 'divider',
                bgcolor: 'background.default',
              }}
            >
              <span>{col.label}</span>
              <Chip size="small" label={byCol[col.id].length} sx={{ height: 20, fontSize: 11 }} />
            </Stack>
            <Box sx={{ flex: 1, p: 1, display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto' }}>
              {byCol[col.id].length === 0 && (
                <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'center', py: 3, fontStyle: 'italic' }}>
                  Nothing here
                </Typography>
              )}
              {byCol[col.id].map((c) => {
                const code = areaCodeFromComponent(c.component);
                const { bg, fg } = areaCodeColours(code);
                const est = formatSecs(c.estimateSeconds);
                return (
                  <Box
                    key={c.taskId}
                    onClick={() => handleClickCard(c)}
                    sx={{
                      bgcolor: 'background.default',
                      border: 1, borderColor: 'divider',
                      borderRadius: 1.25,
                      px: 1.25, py: 1,
                      cursor: 'pointer',
                      transition: 'border-color 120ms, transform 120ms',
                      '&:hover': { borderColor: 'primary.main', transform: 'translateY(-1px)' },
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                      <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 600 }} title={`Jira status: ${c.jiraStatus}`}>
                        {c.jiraKey}
                      </Typography>
                      {est && <Typography variant="caption" color="text.disabled">⏱ {est}</Typography>}
                    </Stack>
                    <Typography variant="body2" sx={{
                      lineHeight: 1.35,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      mb: c.component ? 0.75 : 0,
                    }}>
                      {c.title}
                    </Typography>
                    {c.component && (
                      <Box sx={{
                        display: 'inline-block',
                        fontSize: 10.5, fontWeight: 600,
                        px: 1, py: '2px', borderRadius: 1,
                        bgcolor: bg, color: fg,
                        letterSpacing: '0.02em',
                      }}>
                        {c.component}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Wire it into `ListMode.tsx`**

In `client/src/components/timetracker/ListMode.tsx`, add the import:

```tsx
import { BoardTab } from './BoardTab.js';
```

Update `TAB_LABELS`:

```tsx
const TAB_LABELS: Record<ListTab, string> = {
  projects: 'Projects',
  worklogs: 'Worklogs',
  grid: 'Task grid',
  timeoff: 'Time off',
  reports: 'Reports',
  board: 'Board',
};
```

Add a render branch alongside the existing tab branches:

```tsx
{tab === 'board' && <BoardTab active={tab === 'board'} />}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/timetracker/BoardTab.tsx client/src/components/timetracker/ListMode.tsx
git commit -m "feat(board): BoardTab component + ListMode wiring"
```

---

## Task 12: BoardTab tests (RTL)

**Files:**
- Create: `tests/client/BoardTab.test.tsx`

- [ ] **Step 1: Write the tests**

Create `tests/client/BoardTab.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../client/src/theme.js';
import { ToastProvider } from '../../client/src/state/useToast.js';
import { BoardTab } from '../../client/src/components/timetracker/BoardTab.js';
import type { BoardSnapshotPayload, BoardAuthPingPayload } from '../../shared/ipcContract.js';

declare global {
  // eslint-disable-next-line no-var
  var watchtower: any;
}

function withProviders(node: React.ReactNode) {
  return (
    <ThemeProvider theme={darkTheme}>
      <ToastProvider>{node}</ToastProvider>
    </ThemeProvider>
  );
}

const SEEDED_SNAPSHOT: BoardSnapshotPayload = {
  syncedAt: '2026-05-26T14:32:00Z',
  lastSyncResult: null,
  cards: [
    { taskId: 1, jiraKey: 'FIE-1', title: 'Card one', jiraStatus: 'To Do',     column: 'todo',  estimateSeconds: 21600, component: 'TEH-X', projectId: 1, projectName: 'PPS', projectColor: '#7aa7ff', epicId: 1, epicName: 'TEH', syncedAt: '2026-05-26T14:32:00Z' },
    { taskId: 2, jiraKey: 'FIE-2', title: 'Card two', jiraStatus: 'In Review', column: 'doing', estimateSeconds: 14400, component: 'VYR-Y', projectId: 1, projectName: 'PPS', projectColor: '#7aa7ff', epicId: 2, epicName: 'VYR', syncedAt: '2026-05-26T14:32:00Z' },
  ],
};

let invokeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeSpy = vi.fn(async (kind: string) => {
    if (kind === 'board:get')      return SEEDED_SNAPSHOT;
    if (kind === 'board:authPing') return { configured: true, cookiePresent: true, baseUrl: 'https://jira.test' } satisfies BoardAuthPingPayload;
    if (kind === 'board:sync')     return { snapshot: SEEDED_SNAPSHOT, result: { ok: true, fetched: 2, upserted: 2, created: 0, unrouted: 0, unroutedKeys: [], removedFromBoard: 0, neededBrowserRefresh: false, startedAt: '', finishedAt: '' } };
    if (kind === 'openExternalUrl') return { ok: true };
    return null;
  });
  globalThis.watchtower = { invoke: invokeSpy };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).watchtower = globalThis.watchtower;
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).watchtower;
});

describe('<BoardTab>', () => {
  it('renders 3 columns and the seeded cards', async () => {
    render(withProviders(<BoardTab active={true} />));
    await waitFor(() => expect(screen.getByText('To do')).toBeInTheDocument());
    expect(screen.getByText('Doing')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('FIE-1')).toBeInTheDocument();
    expect(screen.getByText('FIE-2')).toBeInTheDocument();
  });

  it('shows the Refresh button when cookiePresent', async () => {
    render(withProviders(<BoardTab active={true} />));
    expect(await screen.findByRole('button', { name: /Refresh/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign in to Jira/i })).toBeNull();
  });

  it('shows the Sign-in button when cookie is absent', async () => {
    invokeSpy.mockImplementation(async (kind: string) => {
      if (kind === 'board:get')      return SEEDED_SNAPSHOT;
      if (kind === 'board:authPing') return { configured: true, cookiePresent: false, baseUrl: 'https://jira.test' };
      return null;
    });
    render(withProviders(<BoardTab active={true} />));
    expect(await screen.findByRole('button', { name: /Sign in to Jira/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refresh/i })).toBeNull();
  });

  it('fires board:sync when Refresh is clicked', async () => {
    render(withProviders(<BoardTab active={true} />));
    const btn = await screen.findByRole('button', { name: /Refresh/i });
    invokeSpy.mockClear();
    invokeSpy.mockImplementation(async (kind: string) => {
      if (kind === 'board:sync')     return { snapshot: SEEDED_SNAPSHOT, result: { ok: true, fetched: 0, upserted: 0, created: 0, unrouted: 0, unroutedKeys: [], removedFromBoard: 0, neededBrowserRefresh: false, startedAt: '', finishedAt: '' } };
      if (kind === 'board:authPing') return { configured: true, cookiePresent: true, baseUrl: 'https://jira.test' };
      return null;
    });
    fireEvent.click(btn);
    await waitFor(() => expect(invokeSpy).toHaveBeenCalledWith('board:sync', {}));
  });

  it('shows the unrouted warning when lastSyncResult includes unrouted keys', async () => {
    invokeSpy.mockImplementation(async (kind: string) => {
      if (kind === 'board:get')      return { ...SEEDED_SNAPSHOT, lastSyncResult: { ok: true, fetched: 0, upserted: 0, created: 0, unrouted: 2, unroutedKeys: ['X-1','X-2'], removedFromBoard: 0, neededBrowserRefresh: false, startedAt: '', finishedAt: '' } };
      if (kind === 'board:authPing') return { configured: true, cookiePresent: true, baseUrl: 'https://jira.test' };
      return null;
    });
    render(withProviders(<BoardTab active={true} />));
    expect(await screen.findByText(/couldn't be slotted/i)).toBeInTheDocument();
    expect(screen.getByText(/X-1, X-2/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, see pass**

Run: `npm test -- BoardTab`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/client/BoardTab.test.tsx
git commit -m "test(board): BoardTab RTL coverage — columns, auth toggles, refresh"
```

---

## Task 13: Smoke verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green; new test count ≈ existing + 25-30.

- [ ] **Step 2: Typecheck both sides**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit` → no new errors.
Run: `npx tsc -p client/tsconfig.json --noEmit` → no new errors beyond known drift (per CLAUDE.md).

- [ ] **Step 3: Dev server smoke**

Run: `npm run dev`

In the app:
1. Click TimeTracker module → click **Board** tab.
2. If not signed in (or no Keychain entry yet), click **Sign in to Jira**. A Chromium window pops up; complete SSO. The board re-renders populated.
3. Click any card → opens `https://jira.skoda.vwgroup.com/browse/<key>` in your default browser.
4. Click **Refresh** → cards update; the "Synced HH:MM" indicator refreshes.
5. Toggle staleness by removing the cookie:
   `security delete-generic-password -s jira-skoda-cookie -a "$JIRA_KEYCHAIN_ACCOUNT"`
   Then click Refresh → re-auth flow runs again.

- [ ] **Step 4: No further commit**

The smoke run shouldn't produce code changes. If any tweak is needed, capture it as a follow-up task.

---

## Self-review

- **Spec coverage:** Each spec section maps to at least one task:
  - Architecture → Tasks 5–8
  - Schema delta → Task 1
  - IPC surface → Tasks 4, 7, 8
  - Orchestrator service → Tasks 3, 5, 6, 7
  - Renderer → Tasks 9, 10, 11, 12
  - Error UX → Task 11 (alerts, warning strip, configure banner)
  - Testing → Tasks 1, 2, 3, 5, 6, 9, 12
  - Verification → Task 13
- **Placeholders:** none — every step has concrete code, paths, and commands.
- **Type consistency:** `BoardSnapshotPayload`, `BoardCardPayload`,
  `BoardSyncResultPayload`, `BoardAuthPingPayload`, `BoardColumn`,
  `BoardSyncDeps`, `STATUS_TO_COLUMN`, `COLUMN_TO_LOCAL_STATUS`,
  `detectAreaCode`, `pickProjectForKey`, `areaCodeColours`,
  `areaCodeFromComponent`, `findByNumber`, `updateJiraFields`,
  `clearJiraStatusExcept` — names are used consistently across
  declaration, tests, and call sites.
- **Scope:** This produces one focused feature shippable on its own.
  The optional follow-ups (drag-to-transition, polling, inbox project)
  remain explicitly out of scope per the spec.
