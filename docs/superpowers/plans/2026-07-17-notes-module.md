# Notes / Todo Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Notes" module to the desktop app — a unified notes/todo list where each item is Global or linked to a project, backed by a cloud-synced SQLite table.

**Architecture:** Mirror the existing `projects` vertical slice end-to-end — SQLite table + `NotesRepo` → `notes:*` IPC arms in both transports → orchestrator dispatch cases → `useNotes` hook + `notesBus` → `ModuleNotes` two-pane UI. Notes cloud-sync to Postgres; because a note's project link is *nullable* (unlike every existing synced FK), the sync FK-resolution join gains an isolated nullable path used only by notes.

**Tech Stack:** TypeScript, better-sqlite3 (prod) / node:sqlite (tests), Electron IPC (tagged unions), React + MUI v5, vitest, Postgres (cloud sync). New dependency: `react-markdown` + `remark-gfm` for the note body.

## Global Constraints

- **UI text is English.** Date/number formatting stays cs-CZ via existing `formatDate*` helpers. **No i18n.**
- **SQLite migration = v24** (current max is v23; append, never edit past entries). **Postgres migration = v14** (current max PG version is v13; independent stream).
- **ADD COLUMN / defaults:** use `CREATE TABLE IF NOT EXISTS`; keep column DEFAULTs constant literals (no `datetime('now')`) — node:sqlite (tests) vs better-sqlite3 (prod) diverge on non-constant ADD COLUMN defaults.
- **Every `notes:*` kind must be added to BOTH `packages/shared/src/ipcContract.ts` AND `packages/shared/src/messagePort.ts`** (parallel unions, each with its own `Orch*` payload copies).
- **All renderer IPC goes through `invoke` from `apps/desktop/src/state/ipc.ts`** — never `window.watchtower.invoke` directly. A failed `invoke` already raises a global toast; do not add inline error `<Alert>`s.
- **Glass:** `glassFill` (no blur) for repeating list rows, `glassSurface` (blur) for singleton panels; never render an MUI `Paper` inside a `.map()`.
- **Soft-delete everywhere:** every read filters `deleted_at IS NULL`; `delete()` sets `deleted_at`/`updated_at`.
- **Synced-table triad:** `sync_id` (unique index), `updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'`, `deleted_at TEXT`. Writes stamp `sync_id = newSyncId()` and `updated_at = nowIso()`. Mutation handlers call `notifySync()`.
- **Commit after every task.** Stage only the files listed in the task (the working tree carries unrelated untracked WIP — never `git add -A`).
- Verify with `npm test` (full suite, 219+; must stay green) and `npx tsc -p orchestrator/tsconfig.json --noEmit` / `npx tsc -p apps/desktop/tsconfig.json --noEmit` as relevant. `npm test` does NOT typecheck.

---

## File Structure

**Create:**
- `orchestrator/db/repositories/notes.ts` — `NotesRepo` (list/get/create/update/delete, soft-delete).
- `apps/desktop/src/state/useNotes.ts` — renderer hook.
- `apps/desktop/src/state/notesBus.ts` — cross-subtree refresh pub/sub.
- `apps/desktop/src/components/notes/ModuleNotes.tsx` — two-pane shell.
- `apps/desktop/src/components/notes/NoteList.tsx` — left list column (search, scope, filters, rows).
- `apps/desktop/src/components/notes/NoteRow.tsx` — one list row.
- `apps/desktop/src/components/notes/NoteEditor.tsx` — right editor pane.
- `apps/desktop/src/components/notes/noteSort.ts` — pure sort/group helper (unit-tested).
- `tests/orchestrator/notes-repo.test.ts` — repo tests.
- `tests/desktop/noteSort.test.ts` — sort helper tests.
- `tests/orchestrator/sync-notes-fk.test.ts` — nullable-FK sync SELECT-builder test.

**Modify:**
- `orchestrator/db/migrations.ts` — append v24.
- `packages/shared/src/ipcContract.ts` — `notes:*` arms + `Note*Payload` types.
- `packages/shared/src/messagePort.ts` — `notes:*` arms + `OrchNote*` types.
- `orchestrator/index.ts` — `notesRepo()` factory, `noteViewOf`, `case 'notes:*'`.
- `orchestrator/sync/schema.ts` — `notes` entry in `SYNCED_TABLES`.
- `orchestrator/db/pg/schema.ts` — `notes` PG table + RLS, PG migration v14.
- `orchestrator/sync/push.ts` — nullable-FK path + `PUSH_ORDER`.
- `orchestrator/sync/pull.ts` — nullable-FK path + `PULL_ORDER`.
- `apps/desktop/src/components/ModuleRail.tsx` — `ModuleId` union + `ITEMS` entry.
- `apps/desktop/src/state/useActiveModule.ts` — `VALID` set.
- `apps/desktop/src/App.tsx` — render `<ModuleNotes/>`.
- `apps/desktop/package.json` — add `react-markdown`, `remark-gfm`.

---

## Shared type contract (used across tasks)

These names are fixed; every task uses them verbatim.

```ts
// Priority is a fixed union; 'none' is the default (not a todo-priority yet).
type NotePriority = 'none' | 'low' | 'med' | 'high';
// done: null = plain note, 0 = open todo, 1 = completed todo.
type NoteDone = null | 0 | 1;
```

`NoteViewPayload` (read shape, from `noteViewOf`):
```ts
interface NoteViewPayload {
  id: number;
  title: string;
  body: string;
  done: NoteDone;
  doneAt: string | null;
  dueDate: string | null;      // 'YYYY-MM-DD'
  priority: NotePriority;
  pinned: boolean;
  projectId: number | null;    // null = Global
  projectName: string | null;  // joined; null when Global or project soft-deleted
  projectColor: string | null; // joined
  createdAt: string;
  updatedAt: string;
}
```

`NoteInputPayload` (write shape):
```ts
interface NoteInputPayload {
  title?: string;
  body?: string;
  done?: NoteDone;
  dueDate?: string | null;
  priority?: NotePriority;
  pinned?: boolean;
  projectId?: number | null;
}
```

`NoteListFilterPayload`:
```ts
interface NoteListFilterPayload {
  scope?: 'all' | 'global' | 'project';
  projectId?: number;      // required when scope === 'project'
  search?: string;
  openTodosOnly?: boolean;  // done = 0
  dueSoon?: boolean;        // has due_date within 3 days OR overdue, and done != 1
  includeCompleted?: boolean; // default true; false → drop done = 1
}
```

---

### Task 1: `notes` table (migration v24) + `NotesRepo`

**Files:**
- Modify: `orchestrator/db/migrations.ts` (append after the v23 entry, before the closing `]`)
- Create: `orchestrator/db/repositories/notes.ts`
- Test: `tests/orchestrator/notes-repo.test.ts`

**Interfaces:**
- Consumes: `SqliteLike` from `../migrations.js`; `nowIso`, `newSyncId` from `../syncColumns.js`.
- Produces: `class NotesRepo` with `NoteRow`, `NoteInput`, `NoteListFilter`, `NotePriority`, `NoteDone` exported types and methods `list(filter?): NoteRow[]`, `get(id): NoteRow | null`, `create(input): NoteRow`, `update(id, input): NoteRow`, `delete(id): void`.

```ts
// NoteRow (app-facing camelCase)
export interface NoteRow {
  id: number;
  title: string;
  body: string;
  done: NoteDone;
  doneAt: string | null;
  dueDate: string | null;
  priority: NotePriority;
  pinned: boolean;
  projectId: number | null;
  projectName: string | null;
  projectColor: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 1: Write the migration (v24).** In `orchestrator/db/migrations.ts`, append to the `MIGRATIONS` array (after the `version: 23` object):

```ts
  {
    version: 24,
    up: (db) => {
      // Notes module: a unified note/todo. done is tri-state — NULL (plain
      // note), 0 (open todo), 1 (completed todo). project_id is NULLABLE:
      // NULL = a Global note. Synced table → carries the sync_id/updated_at/
      // deleted_at triad. Constant literal defaults only (node:sqlite vs
      // better-sqlite3 ADD COLUMN divergence does not apply to CREATE TABLE,
      // but keep defaults constant for consistency).
      db.exec(`CREATE TABLE IF NOT EXISTS notes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL DEFAULT '',
        body        TEXT    NOT NULL DEFAULT '',
        done        INTEGER,
        done_at     TEXT,
        due_date    TEXT,
        priority    TEXT    NOT NULL DEFAULT 'none',
        pinned      INTEGER NOT NULL DEFAULT 0,
        project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        created_at  TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
        sync_id     TEXT,
        updated_at  TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
        deleted_at  TEXT
      )`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_sync_id ON notes(sync_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_sort ON notes(pinned, due_date)`);
    },
  },
```

- [ ] **Step 2: Write the failing repo test.** Create `tests/orchestrator/notes-repo.test.ts` (setup copied from `tests/orchestrator/projects-repo.test.ts`):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { NotesRepo } from '../../orchestrator/db/repositories/notes.js';
import { ProjectsRepo } from '../../orchestrator/db/repositories/projects.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('NotesRepo', () => {
  let db: SqliteLike;
  let repo: NotesRepo;
  beforeEach(() => {
    db = freshDb();
    repo = new NotesRepo(db);
  });

  it('creates a plain note (done = null, global) with defaults', () => {
    const n = repo.create({ title: 'Idea' });
    expect(n.id).toBeGreaterThan(0);
    expect(n.title).toBe('Idea');
    expect(n.body).toBe('');
    expect(n.done).toBeNull();
    expect(n.priority).toBe('none');
    expect(n.pinned).toBe(false);
    expect(n.projectId).toBeNull();
    expect(n.projectName).toBeNull();
    expect(typeof n.createdAt).toBe('string');
  });

  it('round-trips the tri-state done column (null | 0 | 1)', () => {
    const n = repo.create({ title: 't', done: 0 });
    expect(repo.get(n.id)!.done).toBe(0);
    const u1 = repo.update(n.id, { done: 1 });
    expect(u1.done).toBe(1);
    expect(u1.doneAt).not.toBeNull(); // set when done → 1
    const u2 = repo.update(n.id, { done: null });
    expect(u2.done).toBeNull();
    expect(u2.doneAt).toBeNull(); // cleared when leaving completed
  });

  it('joins project name + color, and reports Global after the project is soft-deleted', () => {
    const p = new ProjectsRepo(db).create({ name: 'Watchtower', color: '#38bdf8' });
    const n = repo.create({ title: 'scoped', projectId: p.id });
    const got = repo.get(n.id)!;
    expect(got.projectId).toBe(p.id);
    expect(got.projectName).toBe('Watchtower');
    expect(got.projectColor).toBe('#38bdf8');
    new ProjectsRepo(db).delete(p.id);
    const after = repo.get(n.id)!;
    expect(after.projectId).toBe(p.id);      // stored id unchanged
    expect(after.projectName).toBeNull();    // join yields nothing → renders Global
  });

  it('filters: scope, openTodosOnly, includeCompleted, search', () => {
    const p = new ProjectsRepo(db).create({ name: 'P' });
    repo.create({ title: 'global note' });
    repo.create({ title: 'open todo', done: 0 });
    const doneOne = repo.create({ title: 'done todo', done: 1 });
    repo.create({ title: 'project note', projectId: p.id });

    expect(repo.list({ scope: 'global' }).every((r) => r.projectId === null)).toBe(true);
    expect(repo.list({ scope: 'project', projectId: p.id }).map((r) => r.title)).toEqual(['project note']);
    expect(repo.list({ openTodosOnly: true }).map((r) => r.title)).toEqual(['open todo']);
    expect(repo.list({ includeCompleted: false }).some((r) => r.id === doneOne.id)).toBe(false);
    expect(repo.list({ search: 'GLOBAL' }).map((r) => r.title)).toEqual(['global note']);
  });

  it('soft-deletes: deleted rows disappear from reads', () => {
    const n = repo.create({ title: 'gone' });
    repo.delete(n.id);
    expect(repo.get(n.id)).toBeNull();
    expect(repo.list().some((r) => r.id === n.id)).toBe(false);
  });

  it('sorts pinned first, then priority high→low, then updated desc', () => {
    const a = repo.create({ title: 'a' });
    const b = repo.create({ title: 'b', pinned: true });
    const c = repo.create({ title: 'c', priority: 'high' });
    const rows = repo.list();
    expect(rows[0].id).toBe(b.id);          // pinned wins
    expect(rows[1].id).toBe(c.id);          // then high priority
    expect(rows[2].id).toBe(a.id);
  });
});
```

- [ ] **Step 3: Run test to verify it fails.**

Run: `npx vitest run tests/orchestrator/notes-repo.test.ts`
Expected: FAIL — cannot find module `notes.js` / `NotesRepo` undefined.

- [ ] **Step 4: Implement `NotesRepo`.** Create `orchestrator/db/repositories/notes.ts`:

```ts
import type { SqliteLike } from '../migrations.js';
import { nowIso, newSyncId } from '../syncColumns.js';

export type NotePriority = 'none' | 'low' | 'med' | 'high';
export type NoteDone = null | 0 | 1;

export interface NoteRow {
  id: number;
  title: string;
  body: string;
  done: NoteDone;
  doneAt: string | null;
  dueDate: string | null;
  priority: NotePriority;
  pinned: boolean;
  projectId: number | null;
  projectName: string | null;
  projectColor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  title?: string;
  body?: string;
  done?: NoteDone;
  dueDate?: string | null;
  priority?: NotePriority;
  pinned?: boolean;
  projectId?: number | null;
}

export interface NoteListFilter {
  scope?: 'all' | 'global' | 'project';
  projectId?: number;
  search?: string;
  openTodosOnly?: boolean;
  dueSoon?: boolean;
  includeCompleted?: boolean;
}

type DbRow = {
  id: number;
  title: string;
  body: string;
  done: number | null;
  done_at: string | null;
  due_date: string | null;
  priority: NotePriority;
  pinned: number;
  project_id: number | null;
  project_name: string | null;
  project_color: string | null;
  created_at: string;
  updated_at: string;
};

function toRow(r: DbRow): NoteRow {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    done: (r.done === null ? null : r.done === 1 ? 1 : 0),
    doneAt: r.done_at,
    dueDate: r.due_date,
    priority: r.priority,
    pinned: r.pinned === 1,
    projectId: r.project_id,
    projectName: r.project_name,
    projectColor: r.project_color,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// LEFT JOIN so Global notes (project_id NULL) and notes whose project was
// soft-deleted both surface with null project name/color.
const LIST_SQL = `
  SELECT
    n.id, n.title, n.body, n.done, n.done_at, n.due_date, n.priority, n.pinned,
    n.project_id, p.name AS project_name, p.color AS project_color,
    n.created_at, n.updated_at
  FROM notes n
  LEFT JOIN projects p ON p.id = n.project_id AND p.deleted_at IS NULL
`;

// priority rank for ORDER BY (high first).
const PRIORITY_RANK = `CASE n.priority WHEN 'high' THEN 3 WHEN 'med' THEN 2 WHEN 'low' THEN 1 ELSE 0 END`;

export class NotesRepo {
  constructor(private db: SqliteLike) {}

  list(filter: NoteListFilter = {}): NoteRow[] {
    const where: string[] = ['n.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filter.scope === 'global') where.push('n.project_id IS NULL');
    if (filter.scope === 'project' && filter.projectId !== undefined) {
      where.push('n.project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.openTodosOnly) where.push('n.done = 0');
    if (filter.includeCompleted === false) where.push('(n.done IS NULL OR n.done = 0)');
    if (filter.dueSoon) {
      where.push("(n.done IS NULL OR n.done != 1) AND n.due_date IS NOT NULL AND n.due_date <= date('now', '+3 days')");
    }
    if (filter.search && filter.search.trim()) {
      where.push("(LOWER(n.title) LIKE '%' || LOWER(?) || '%' OR LOWER(n.body) LIKE '%' || LOWER(?) || '%')");
      params.push(filter.search.trim(), filter.search.trim());
    }

    const sql =
      LIST_SQL +
      ` WHERE ${where.join(' AND ')}` +
      // Completed todos sink; then pinned first; then priority; then due date
      // (nulls last); then most-recently-updated.
      ` ORDER BY (CASE WHEN n.done = 1 THEN 1 ELSE 0 END) ASC,
                 n.pinned DESC,
                 ${PRIORITY_RANK} DESC,
                 (n.due_date IS NULL) ASC, n.due_date ASC,
                 n.updated_at DESC, n.id DESC`;

    return (this.db.prepare(sql).all(...params) as DbRow[]).map(toRow);
  }

  get(id: number): NoteRow | null {
    const row = this.db.prepare(LIST_SQL + ' WHERE n.id = ? AND n.deleted_at IS NULL').get(id) as DbRow | undefined;
    return row ? toRow(row) : null;
  }

  create(input: NoteInput): NoteRow {
    const done = input.done === undefined ? null : input.done;
    const doneAt = done === 1 ? nowIso() : null;
    const ts = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO notes (title, body, done, done_at, due_date, priority, pinned, project_id, created_at, sync_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.title ?? '',
        input.body ?? '',
        done,
        doneAt,
        input.dueDate ?? null,
        input.priority ?? 'none',
        input.pinned ? 1 : 0,
        input.projectId ?? null,
        ts,
        newSyncId(),
        ts,
      ) as { lastInsertRowid: number | bigint };
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, input: Partial<NoteInput>): NoteRow {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown) => {
      sets.push(`${col} = ?`);
      params.push(value);
    };

    if (input.title !== undefined) push('title', input.title);
    if (input.body !== undefined) push('body', input.body);
    if (input.done !== undefined) {
      push('done', input.done);
      // done_at is set when transitioning to completed, cleared otherwise.
      push('done_at', input.done === 1 ? nowIso() : null);
    }
    if (input.dueDate !== undefined) push('due_date', input.dueDate);
    if (input.priority !== undefined) push('priority', input.priority);
    if (input.pinned !== undefined) push('pinned', input.pinned ? 1 : 0);
    if (input.projectId !== undefined) push('project_id', input.projectId);

    push('updated_at', nowIso());
    params.push(id);
    this.db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    const row = this.get(id);
    if (!row) throw new Error(`note ${id} not found after update`);
    return row;
  }

  delete(id: number): void {
    const ts = nowIso();
    this.db.prepare(`UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
  }
}
```

- [ ] **Step 5: Run test to verify it passes.**

Run: `npx vitest run tests/orchestrator/notes-repo.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Full suite + orchestrator typecheck.**

Run: `npm test` → green (count ≥ prior).
Run: `npx tsc -p orchestrator/tsconfig.json --noEmit` → no new errors.

- [ ] **Step 7: Commit.**

```bash
git add orchestrator/db/migrations.ts orchestrator/db/repositories/notes.ts tests/orchestrator/notes-repo.test.ts
git commit -m "feat(notes): notes table (migration v24) + NotesRepo"
```

---

### Task 2: IPC contract + messagePort arms

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (arms in `IpcRequest`/`IpcResponse`, interfaces near the other `*Payload` blocks)
- Modify: `packages/shared/src/messagePort.ts` (arms in `OrchRequest`/`OrchResponse`, `OrchNote*` copies near the other Orch types)

**Interfaces:**
- Consumes: nothing (pure type additions).
- Produces: the `notes:*` request/response kinds + `NoteViewPayload`, `NoteInputPayload`, `NoteListFilterPayload` (ipcContract) and `OrchNoteView`, `OrchNoteInput`, `OrchNoteListFilter` (messagePort). Types match the "Shared type contract" section above verbatim.

- [ ] **Step 1: Add arms + payloads to `ipcContract.ts`.** In `IpcRequest` (near the `projects:*` arms):

```ts
  | { kind: 'notes:list'; payload: NoteListFilterPayload }
  | { kind: 'notes:create'; payload: NoteInputPayload }
  | { kind: 'notes:update'; payload: { id: number; input: Partial<NoteInputPayload> } }
  | { kind: 'notes:delete'; payload: { id: number } }
```

In `IpcResponse`:

```ts
  | { kind: 'notes:list'; payload: { notes: NoteViewPayload[] } }
  | { kind: 'notes:create'; payload: { note: NoteViewPayload } }
  | { kind: 'notes:update'; payload: { note: NoteViewPayload } }
  | { kind: 'notes:delete'; payload: { ok: true } }
```

Add the payload interfaces (near `ProjectViewPayload`):

```ts
export type NotePriority = 'none' | 'low' | 'med' | 'high';
export type NoteDone = null | 0 | 1;

export interface NoteListFilterPayload {
  scope?: 'all' | 'global' | 'project';
  projectId?: number;
  search?: string;
  openTodosOnly?: boolean;
  dueSoon?: boolean;
  includeCompleted?: boolean;
}

export interface NoteInputPayload {
  title?: string;
  body?: string;
  done?: NoteDone;
  dueDate?: string | null;
  priority?: NotePriority;
  pinned?: boolean;
  projectId?: number | null;
}

export interface NoteViewPayload {
  id: number;
  title: string;
  body: string;
  done: NoteDone;
  doneAt: string | null;
  dueDate: string | null;
  priority: NotePriority;
  pinned: boolean;
  projectId: number | null;
  projectName: string | null;
  projectColor: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Mirror into `messagePort.ts`.** In `OrchRequest` (each arm carries an `id: string` like the others):

```ts
  | { id: string; kind: 'notes:list'; payload: OrchNoteListFilter }
  | { id: string; kind: 'notes:create'; payload: OrchNoteInput }
  | { id: string; kind: 'notes:update'; payload: { id: number; input: Partial<OrchNoteInput> } }
  | { id: string; kind: 'notes:delete'; payload: { id: number } }
```

In `OrchResponse`:

```ts
  | { kind: 'notes:list'; payload: { notes: OrchNoteView[] } }
  | { kind: 'notes:create'; payload: { note: OrchNoteView } }
  | { kind: 'notes:update'; payload: { note: OrchNoteView } }
  | { kind: 'notes:delete'; payload: { ok: true } }
```

Add the `OrchNote*` copies near the other Orch types (identical fields to the ipcContract ones — the messagePort file keeps its own copies by convention):

```ts
export type OrchNotePriority = 'none' | 'low' | 'med' | 'high';
export type OrchNoteDone = null | 0 | 1;
export interface OrchNoteListFilter {
  scope?: 'all' | 'global' | 'project';
  projectId?: number;
  search?: string;
  openTodosOnly?: boolean;
  dueSoon?: boolean;
  includeCompleted?: boolean;
}
export interface OrchNoteInput {
  title?: string; body?: string; done?: OrchNoteDone; dueDate?: string | null;
  priority?: OrchNotePriority; pinned?: boolean; projectId?: number | null;
}
export interface OrchNoteView {
  id: number; title: string; body: string; done: OrchNoteDone; doneAt: string | null;
  dueDate: string | null; priority: OrchNotePriority; pinned: boolean;
  projectId: number | null; projectName: string | null; projectColor: string | null;
  createdAt: string; updatedAt: string;
}
```

- [ ] **Step 3: Typecheck shared (build the composite).** Because `@watchtower/shared` is a built composite, build it so downstream sees the new types:

Run: `npm run build -w @watchtower/shared` (or the repo's shared build script; if none, `npx tsc -p packages/shared/tsconfig.json`)
Expected: builds clean; new arms present in `dist`.

- [ ] **Step 4: Commit.**

```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts
git commit -m "feat(notes): notes:* IPC contract + messagePort arms"
```

---

### Task 3: Orchestrator dispatch

**Files:**
- Modify: `orchestrator/index.ts` (import `NotesRepo` + its types; add `notesRepo()` factory near `projectsRepo()`; add `noteViewOf()` near `projectViewOf`; add `case 'notes:*'` blocks in `handleRequest`)
- Test: `tests/orchestrator/notes-repo.test.ts` (already covers the repo; the handler is thin pass-through, so no separate handler harness — verified via typecheck + the manual run in Task 7's verification)

**Interfaces:**
- Consumes: `NotesRepo`, `NoteInput`, `NoteListFilter`, `NoteRow` from `./db/repositories/notes.js`; `NoteViewPayload` shape.
- Produces: the wired `notes:*` request path.

- [ ] **Step 1: Add the factory + adapter.** In `orchestrator/index.ts`, near `projectsRepo()`:

```ts
function notesRepo(): NotesRepo {
  return new NotesRepo(handle!.db);
}

function noteViewOf(r: NoteRow): NoteViewPayload {
  return {
    id: r.id, title: r.title, body: r.body, done: r.done, doneAt: r.doneAt,
    dueDate: r.dueDate, priority: r.priority, pinned: r.pinned,
    projectId: r.projectId, projectName: r.projectName, projectColor: r.projectColor,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
```

Add the import at the top with the other repo imports:
```ts
import { NotesRepo, type NoteInput, type NoteListFilter, type NoteRow } from './db/repositories/notes.js';
```
(Import `NoteViewPayload` from the shared contract alongside the other `*Payload` imports.)

- [ ] **Step 2: Add dispatch cases.** In `handleRequest`'s `switch`, near the `projects:*` cases:

```ts
    case 'notes:list': {
      const rows = notesRepo().list(req.payload as NoteListFilter);
      return { notes: rows.map(noteViewOf) };
    }
    case 'notes:create': {
      const row = notesRepo().create(req.payload as NoteInput);
      notifySync();
      return { note: noteViewOf(row) };
    }
    case 'notes:update': {
      const row = notesRepo().update(req.payload.id, req.payload.input as Partial<NoteInput>);
      notifySync();
      return { note: noteViewOf(row) };
    }
    case 'notes:delete': {
      notesRepo().delete(req.payload.id);
      notifySync();
      return { ok: true };
    }
```

- [ ] **Step 3: Typecheck orchestrator.**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: no errors (the `switch` is exhaustive over the new kinds).

- [ ] **Step 4: Full suite.**

Run: `npm test`
Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add orchestrator/index.ts
git commit -m "feat(notes): orchestrator dispatch for notes:*"
```

---

### Task 4: `useNotes` hook + `notesBus` + markdown dependency

**Files:**
- Create: `apps/desktop/src/state/notesBus.ts`
- Create: `apps/desktop/src/state/useNotes.ts`
- Modify: `apps/desktop/package.json` (add `react-markdown`, `remark-gfm`)

**Interfaces:**
- Consumes: `invoke` from `./ipc`; `NoteViewPayload`, `NoteInputPayload`, `NoteListFilterPayload` from `@watchtower/shared/ipcContract.js`; `subscribeProjects` from `./projectsBus.js`.
- Produces: `useNotes(): NotesState` (below) and `notesBus` (`subscribeNotes`, `broadcastNotesChanged`).

- [ ] **Step 1: Create `notesBus.ts`** (verbatim clone of `projectsBus.ts` with names swapped):

```ts
// Cross-subtree refresh bus for notes (same pattern as projectsBus).
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeNotes(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function broadcastNotesChanged(except?: Listener): void {
  for (const listener of [...listeners]) {
    if (listener !== except) listener();
  }
}
```

- [ ] **Step 2: Create `useNotes.ts`** (modeled on `useProjects.ts`):

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NoteInputPayload, NoteListFilterPayload, NoteViewPayload,
} from '@watchtower/shared/ipcContract.js';
import { broadcastNotesChanged, subscribeNotes } from './notesBus.js';
import { subscribeProjects } from './projectsBus.js';
import { invoke } from './ipc';

export type NoteScope = 'all' | 'global' | 'project';

export interface NotesFilter {
  scope: NoteScope;
  projectId: number | null;
  search: string;
  openTodosOnly: boolean;
  dueSoon: boolean;
}

export interface NotesState {
  notes: NoteViewPayload[];
  loading: boolean;
  error: string | null;
  filter: NotesFilter;
  setFilter(next: Partial<NotesFilter>): void;
  refresh(): Promise<void>;
  create(input: NoteInputPayload): Promise<NoteViewPayload>;
  update(id: number, input: Partial<NoteInputPayload>): Promise<NoteViewPayload>;
  remove(id: number): Promise<void>;
}

function toIpcFilter(f: NotesFilter): NoteListFilterPayload {
  const out: NoteListFilterPayload = { scope: f.scope, includeCompleted: true };
  if (f.scope === 'project' && f.projectId != null) out.projectId = f.projectId;
  if (f.search.trim()) out.search = f.search.trim();
  if (f.openTodosOnly) out.openTodosOnly = true;
  if (f.dueSoon) out.dueSoon = true;
  return out;
}

export function useNotes(): NotesState {
  const [filter, setFilterState] = useState<NotesFilter>({
    scope: 'all', projectId: null, search: '', openTodosOnly: false, dueSoon: false,
  });
  const [notes, setNotes] = useState<NoteViewPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ipcFilter = useMemo(() => toIpcFilter(filter), [filter]);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await invoke('notes:list', ipcFilter);
      setNotes(res.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ipcFilter]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Refresh on any notes mutation elsewhere, and on project edits (so joined
  // project name/color on rows stay fresh — mirrors useProjects' bus usage).
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const listenerRef = useRef<() => void>(() => {});
  useEffect(() => {
    const listener = () => { void refreshRef.current(); };
    listenerRef.current = listener;
    const un1 = subscribeNotes(listener);
    const un2 = subscribeProjects(listener);
    return () => { un1(); un2(); };
  }, []);

  const setFilter = useCallback((next: Partial<NotesFilter>) => {
    setFilterState((prev) => ({ ...prev, ...next }));
  }, []);

  const create = useCallback(async (input: NoteInputPayload) => {
    const res = await invoke('notes:create', input);
    await refresh();
    broadcastNotesChanged(listenerRef.current);
    return res.note;
  }, [refresh]);

  const update = useCallback(async (id: number, input: Partial<NoteInputPayload>) => {
    const res = await invoke('notes:update', { id, input });
    await refresh();
    broadcastNotesChanged(listenerRef.current);
    return res.note;
  }, [refresh]);

  const remove = useCallback(async (id: number) => {
    await invoke('notes:delete', { id });
    await refresh();
    broadcastNotesChanged(listenerRef.current);
  }, [refresh]);

  return { notes, loading, error, filter, setFilter, refresh, create, update, remove };
}
```

- [ ] **Step 3: Add the markdown dependency.**

Run: `npm install react-markdown remark-gfm -w apps/desktop`
Expected: both appear in `apps/desktop/package.json` dependencies; lockfile updates.

- [ ] **Step 4: Typecheck desktop.**

Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit`
Expected: no new errors in the two new files. (Ignore the pre-existing drift noted in CLAUDE.md.)

- [ ] **Step 5: Commit.**

```bash
git add apps/desktop/src/state/notesBus.ts apps/desktop/src/state/useNotes.ts apps/desktop/package.json package-lock.json
git commit -m "feat(notes): useNotes hook + notesBus + react-markdown dep"
```

---

### Task 5: `noteSort` helper + tests

Small pure helper so the "Completed" grouping is unit-testable independent of SQL (the SQL already sorts; this splits the flat list the server returns into open + completed groups for the two-section list UI).

**Files:**
- Create: `apps/desktop/src/components/notes/noteSort.ts`
- Test: `tests/desktop/noteSort.test.ts`

**Interfaces:**
- Produces: `splitNotes(notes: NoteViewPayload[]): { open: NoteViewPayload[]; completed: NoteViewPayload[] }` — preserves server order within each group; `completed` = `done === 1`.

- [ ] **Step 1: Write the failing test.** Create `tests/desktop/noteSort.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitNotes } from '../../apps/desktop/src/components/notes/noteSort.js';
import type { NoteViewPayload } from '@watchtower/shared/ipcContract.js';

const mk = (id: number, done: null | 0 | 1): NoteViewPayload => ({
  id, title: `n${id}`, body: '', done, doneAt: null, dueDate: null,
  priority: 'none', pinned: false, projectId: null, projectName: null,
  projectColor: null, createdAt: '', updatedAt: '',
});

describe('splitNotes', () => {
  it('splits completed (done=1) from open (null | 0), preserving order', () => {
    const { open, completed } = splitNotes([mk(1, 0), mk(2, 1), mk(3, null), mk(4, 1)]);
    expect(open.map((n) => n.id)).toEqual([1, 3]);
    expect(completed.map((n) => n.id)).toEqual([2, 4]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run tests/desktop/noteSort.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement.** Create `apps/desktop/src/components/notes/noteSort.ts`:

```ts
import type { NoteViewPayload } from '@watchtower/shared/ipcContract.js';

/** Split the server-ordered list into open (done null|0) and completed (done 1). */
export function splitNotes(notes: NoteViewPayload[]): {
  open: NoteViewPayload[];
  completed: NoteViewPayload[];
} {
  const open: NoteViewPayload[] = [];
  const completed: NoteViewPayload[] = [];
  for (const n of notes) (n.done === 1 ? completed : open).push(n);
  return { open, completed };
}
```

- [ ] **Step 4: Run to verify it passes.** `npx vitest run tests/desktop/noteSort.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/desktop/src/components/notes/noteSort.ts tests/desktop/noteSort.test.ts
git commit -m "feat(notes): splitNotes open/completed grouping helper"
```

---

### Task 6: Notes UI (`ModuleNotes` + `NoteList` + `NoteRow` + `NoteEditor`) and nav wiring

Build the two-pane UI from `docs/prototypes/desktop-notes-module.html`, in MUI, matching the glass language. This task also wires the three nav touch-points. It ends with a real app run (verify skill), not an automated test (the renderer has no component-test harness; the hook/repo/sort logic is already covered).

**Files:**
- Create: `apps/desktop/src/components/notes/ModuleNotes.tsx`, `NoteList.tsx`, `NoteRow.tsx`, `NoteEditor.tsx`
- Modify: `apps/desktop/src/components/ModuleRail.tsx`, `apps/desktop/src/state/useActiveModule.ts`, `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: `useNotes` (Task 4), `splitNotes` (Task 5), `useProjects` (for the project picker + scope dropdown), glass helpers, `react-markdown` + `remark-gfm`.
- `ModuleNotes` takes props `{ projects: ProjectViewPayload[] }` (passed from App.tsx's shared `useProjects().projects`, so the picker/scope list reuse the app-wide list and stay bus-fresh).

- [ ] **Step 1: `ModuleRail.tsx` — add the module.**
  - Extend the `ModuleId` union: `export type ModuleId = 'dashboard' | 'instances' | 'billing' | 'reviews' | 'notes' | 'settings';`
  - Add an `ITEMS` entry (place it before `settings`): `{ id: 'notes', label: 'Notes', icon: <ChecklistRtlIcon fontSize="inherit" />, enabled: true }` and `import ChecklistRtlIcon from '@mui/icons-material/ChecklistRtl';` (or `NotesIcon` / `StickyNote2Icon` — pick one, keep it consistent). No sub-tabs.

- [ ] **Step 2: `useActiveModule.ts` — allow the id.** Add `'notes'` to the `VALID` set: `new Set(['dashboard', 'instances', 'billing', 'reviews', 'notes', 'settings'])`.

- [ ] **Step 3: `NoteRow.tsx`.** A single list row (uses `glassFill`, never `Paper`). Props: `{ note: NoteViewPayload; selected: boolean; onSelect(): void; onToggleDone(): void }`. Render, matching the prototype:
  - Checkbox (hidden when `note.done === null`; empty when `0`; ticked green when `1`); clicking it calls `onToggleDone()` and must `stopPropagation` so it doesn't also select.
  - Priority dot (skip when `'none'`), title (strike-through when `done === 1`), pin icon (when `pinned`).
  - One-line body preview (`note.body`, `noWrap`).
  - Project tag: colored dot + `projectName` when set, else the "🌐 Global" chip. Use `projectColor` for the dot/tint.
  - Due chip: `formatDate*` from `apps/desktop/src/util/format.ts`; tint red when `dueDate < today`, amber when within 3 days, plain otherwise (compute with dayjs, already a dep).

- [ ] **Step 4: `NoteList.tsx`.** Left column. Props: `{ notes; selectedId; onSelect(id); onToggleDone(id); onNew(); filter; setFilter; projects }`.
  - Header: title + "New" button (`onNew`), search field (bound to `filter.search` via `setFilter({ search })`).
  - Scope selector (segmented): All / 🌐 Global / Projects — when "Projects" is chosen show a project `Select` (from `projects`) that sets `{ scope: 'project', projectId }`.
  - Quick-filter chips: Open todos (`openTodosOnly`), Due soon (`dueSoon`).
  - Body: `splitNotes(notes)` → render `open` rows, then if `completed.length` a collapsible "Completed · N" section with the completed rows.

- [ ] **Step 5: `NoteEditor.tsx`.** Right pane. Props: `{ note: NoteViewPayload | null; projects; onChange(input: Partial<NoteInputPayload>): void; onDelete(): void }`. Debounce title/body edits (~400ms) then call `onChange`. Contains:
  - Big checkbox + title `InputBase` (strike-through when done).
  - Toolbar: Todo toggle (null↔0), Priority menu (none/low/med/high), Due date picker (MUI X DatePicker — `adapterLocale="cs"` already mounted at App root; do not re-mount), Project picker (`Select` incl. a "🌐 Global" / none option), Pin toggle, Delete.
  - Body: render `note.body` with `<ReactMarkdown remarkPlugins={[remarkGfm]}>`; provide an edit affordance (a multiline `TextField` in an "Edit" toggle, or always-editable textarea with a preview tab — keep it simple: an editable `TextField` for the body plus a rendered preview below is acceptable for v1). Footer: "Updated <relative>" + a small "Synced" indicator (static label is fine).
  - Empty state when `note === null`: centered "Select or create a note".

- [ ] **Step 6: `ModuleNotes.tsx`.** Compose the two panes. Owns selection state (`selectedId`), calls `useNotes()`. Handlers:
  - `onNew`: `const n = await create({ done: null, projectId: filter.scope === 'project' ? filter.projectId : null }); setSelectedId(n.id);`
  - `onToggleDone(id)`: look up the note; `update(id, { done: note.done === 1 ? 0 : 1 })`.
  - `onChange(input)`: `update(selectedId, input)`.
  - `onDelete`: `remove(selectedId); setSelectedId(null)`.
  - Layout: `display:flex` full-height; left `NoteList` fixed width (~308), right `NoteEditor` flex. Use `glassSurface` for the two singleton panels.

- [ ] **Step 7: `App.tsx` — render it.**
  - Import: `import { ModuleNotes } from './components/notes/ModuleNotes.js';`
  - Add the render arm alongside reviews/billing: `{activeModule === 'notes' && <ModuleNotes projects={projects} />}` where `projects` is the app-level `useProjects().projects` already in scope (confirm the variable name in App.tsx; if the app-level hook result is named differently, pass that).

- [ ] **Step 8: Typecheck + full suite.**

Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit` → no new errors.
Run: `npm test` → green.

- [ ] **Step 9: Verify in the real app (verify skill / `npm run dev`).**
  - Launch the app, open the Notes module from the rail.
  - Create a note; make it a todo (checkbox appears); complete it (sinks to Completed); set priority/due/pin; assign a project (tag shows project color); switch scope to Global and to a project; type markdown in the body and confirm it renders. Screenshot the module in dark and light mode.

- [ ] **Step 10: Commit.**

```bash
git add apps/desktop/src/components/notes/ModuleNotes.tsx apps/desktop/src/components/notes/NoteList.tsx apps/desktop/src/components/notes/NoteRow.tsx apps/desktop/src/components/notes/NoteEditor.tsx apps/desktop/src/components/ModuleRail.tsx apps/desktop/src/state/useActiveModule.ts apps/desktop/src/App.tsx
git commit -m "feat(notes): Notes module two-pane UI + rail/App wiring"
```

---

### Task 7: Cloud sync — Postgres schema + SYNCED_TABLES + nullable-FK path

The trickiest task: notes are the first synced table with a **nullable** parent FK. Existing FK resolution (`push.ts`/`pull.ts`) uses an INNER JOIN and `continue`s on a null/unresolved parent — which would silently drop every Global note from sync. Add an isolated nullable path used only by tables that declare it; existing tables (epics/tasks/…) keep the exact INNER-JOIN behavior.

**Files:**
- Modify: `orchestrator/db/pg/schema.ts` (add `NOTES` DDL + PG migration v14)
- Modify: `orchestrator/sync/schema.ts` (add `notes` to `SYNCED_TABLES` with `project_sync_id` resolved FK column)
- Modify: `orchestrator/sync/push.ts` (`fkSource` returns `nullable`; LEFT JOIN when nullable; add `notes` to `PUSH_ORDER`)
- Modify: `orchestrator/sync/pull.ts` (`fkSource` returns `nullable`; LEFT JOIN when nullable; null-safe resolve; add `notes` to `PULL_ORDER`)
- Test: `tests/orchestrator/sync-notes-fk.test.ts`

**Interfaces:**
- Consumes: `SyncTable`, `SYNCED_TABLES` from `./schema.js`.
- Produces: the `notes` synced-table descriptor; a `fkSource` that returns `{ col, parentTable, localCol, nullable }`.

- [ ] **Step 1: Add the PG table + migration v14.** In `orchestrator/db/pg/schema.ts`, add a `NOTES` const and append a `PG_MIGRATIONS` entry (version 14). Mirror the synced columns; store the resolved FK as `project_sync_id` (text) — the sync layer converts to/from the local integer id.

```ts
const NOTES = `
CREATE TABLE IF NOT EXISTS notes (
  id             SERIAL PRIMARY KEY,
  sync_id        TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  done           INTEGER,
  done_at        TIMESTAMPTZ,
  due_date       DATE,
  priority       TEXT NOT NULL DEFAULT 'none',
  pinned         BOOLEAN NOT NULL DEFAULT false,
  project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
`;
```

Append to `PG_MIGRATIONS`:
```ts
  { version: 14, up: [
      NOTES,
      // RLS: authenticated clients may read; writes are Mac-only (service role).
      // Mirror the read_authenticated policy pattern used for projects (v4).
      `ALTER TABLE notes ENABLE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS read_authenticated ON notes`,
      `CREATE POLICY read_authenticated ON notes FOR SELECT TO authenticated USING (true)`,
    ],
  },
```
(Copy the exact role/policy names from the existing projects RLS block in this file — match it verbatim rather than the sketch above if it differs.)

- [ ] **Step 2: Add the `SYNCED_TABLES` entry.** In `orchestrator/sync/schema.ts`, after the `projects` entry (order doesn't matter here; PUSH/PULL_ORDER controls sequencing):

```ts
  {
    name: 'notes', pgTable: 'notes', keyCol: 'id',
    columns: [
      { name: 'sync_id', kind: 'text' },
      { name: 'title', kind: 'text' },
      { name: 'body', kind: 'text' },
      { name: 'done', kind: 'int' },
      { name: 'done_at', kind: 'ts' },
      { name: 'due_date', kind: 'date' },
      { name: 'priority', kind: 'text' },
      { name: 'pinned', kind: 'bool' },
      { name: 'project_sync_id', kind: 'text' }, // resolved nullable FK → projects.sync_id
      { name: 'created_at', kind: 'ts' },
      { name: 'updated_at', kind: 'ts' },
      { name: 'deleted_at', kind: 'ts' },
    ],
  },
```

- [ ] **Step 3: Write the failing FK-builder test.** Create `tests/orchestrator/sync-notes-fk.test.ts`. This tests the pure `fkSource` descriptor (exported for test) rather than a live PG round-trip (PG tests self-skip without `WATCHTOWER_PG_URL`):

```ts
import { describe, it, expect } from 'vitest';
import { SYNCED_TABLES } from '../../orchestrator/sync/schema.js';
import { fkSourceForTest as pushFk } from '../../orchestrator/sync/push.js';
import { fkSourceForTest as pullFk } from '../../orchestrator/sync/pull.js';

describe('notes sync FK', () => {
  it('is registered as a synced table with a resolved project FK column', () => {
    const notes = SYNCED_TABLES.find((t) => t.name === 'notes');
    expect(notes).toBeTruthy();
    expect(notes!.columns.some((c) => c.name === 'project_sync_id')).toBe(true);
  });

  it('declares the notes FK as nullable on both push and pull', () => {
    const notes = SYNCED_TABLES.find((t) => t.name === 'notes')!;
    expect(pushFk(notes)).toMatchObject({ col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id', nullable: true });
    expect(pullFk(notes)).toMatchObject({ col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id', nullable: true });
  });

  it('keeps epics FK non-nullable (unchanged behavior)', () => {
    const epics = SYNCED_TABLES.find((t) => t.name === 'epics')!;
    expect(pushFk(epics)).toMatchObject({ localCol: 'project_id' });
    expect(pushFk(epics)!.nullable).toBeFalsy();
  });
});
```

- [ ] **Step 4: Run to verify it fails.** `npx vitest run tests/orchestrator/sync-notes-fk.test.ts` → FAIL (no `fkSourceForTest` export; `notes` not in SYNCED_TABLES yet if Step 2 not saved).

- [ ] **Step 5: Update `push.ts`.**
  - Change `fkSource` to include `nullable` and the `notes` case, and export it under a test alias:

```ts
function fkSource(table: SyncTable): { col: string; parentTable: string; localCol: string; nullable: boolean } | null {
  switch (table.name) {
    case 'epics': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id', nullable: false };
    case 'tasks': return { col: 'epic_sync_id', parentTable: 'epics', localCol: 'epic_id', nullable: false };
    case 'contracts': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id', nullable: false };
    case 'worklogs': return { col: 'task_sync_id', parentTable: 'tasks', localCol: 'task_id', nullable: false };
    case 'notes': return { col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id', nullable: true };
    default: return null;
  }
}
export const fkSourceForTest = fkSource;
```
  - In `pushTable`, make the join LEFT when nullable (so null-FK rows survive the SELECT):

```ts
  if (fk) {
    selectCols.push(`parent.sync_id AS ${fk.col}`);
    const joinKind = fk.nullable ? 'LEFT JOIN' : 'JOIN';
    joinSql = ` ${joinKind} ${fk.parentTable} parent ON parent.id = t.${fk.localCol}`;
  }
```
  - `upsertRow` already handles a null resolved FK correctly: for a Global note `project_sync_id` is NULL, so the parameter is null and `(SELECT id FROM projects WHERE sync_id = $p)` yields NULL → `project_id` inserted as NULL. No change needed there.
  - Add `'notes'` to `PUSH_ORDER` **after** `'projects'`: `['projects', 'notes', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off']`.

- [ ] **Step 6: Update `pull.ts`.**
  - Same `fkSource` change (with `nullable` + `notes` case) and `export const fkSourceForTest = fkSource;`.
  - LEFT JOIN when nullable (mirror push Step 5).
  - Make the resolve null-safe: a Global note has `parentSyncId == null` and must NOT be skipped; only skip when a non-null parent can't be resolved yet:

```ts
    let localFkId: number | null = null;
    if (fk) {
      const parentSyncId = remote[fk.col];
      if (parentSyncId == null) {
        if (!fk.nullable) continue;   // required FK missing → wait for parent
        localFkId = null;             // nullable FK (Global note) → keep, id null
      } else {
        const prow = db.prepare(`SELECT id FROM ${fk.parentTable} WHERE sync_id = ?`).get(parentSyncId) as { id: number } | undefined;
        if (!prow) continue;          // parent not landed yet → next cycle
        localFkId = prow.id;
      }
    }
```
  - Add `'notes'` to `PULL_ORDER` after `'projects'` (parent before child): `['projects', 'notes', 'epics', 'tasks', 'worklogs', 'contracts', 'days_off']`.
  - Confirm the downstream INSERT/UPDATE that writes `localFkId` into the local `project_id` accepts `null` (it does — the column is nullable). If the existing pull code assumes a non-null `localFkId` in a not-null column, guard with the `nullable` flag.

- [ ] **Step 7: Run to verify it passes.** `npx vitest run tests/orchestrator/sync-notes-fk.test.ts` → PASS.

- [ ] **Step 8: Full suite + orchestrator typecheck.**

Run: `npm test` → green.
Run: `npx tsc -p orchestrator/tsconfig.json --noEmit` → clean.

- [ ] **Step 9: (Optional, if a dev PG is available) live round-trip.** With `WATCHTOWER_PG_URL` pointed at a throwaway DB (port 5433 per repo convention), run the sync service once and confirm a Global note (null project) and a project-scoped note both round-trip and that a note whose project is later deleted keeps syncing as Global. Skip if no PG env; note it as unverified.

- [ ] **Step 10: Commit.**

```bash
git add orchestrator/db/pg/schema.ts orchestrator/sync/schema.ts orchestrator/sync/push.ts orchestrator/sync/pull.ts tests/orchestrator/sync-notes-fk.test.ts
git commit -m "feat(notes): cloud-sync notes (PG v14) with nullable project FK path"
```

---

## Self-Review

**Spec coverage:**
- Unified `done` tri-state → Task 1 (schema + repo, tested). ✓
- Fields (title/body/done/due/priority/pinned) → Task 1 columns + repo. ✓
- Nullable `project_id`, Global semantics, soft-deleted-project degrades to Global → Task 1 (LEFT JOIN, test). ✓
- IPC arms both transports → Task 2. ✓
- Orchestrator dispatch + `notifySync` → Task 3. ✓
- `useNotes` + `notesBus` + projectsBus subscription → Task 4. ✓
- Two-pane UI, scope/filters/sort/Completed group, markdown → Tasks 5 (sort) + 6 (UI). ✓
- Nav touch-points (ModuleId/VALID/App) → Task 6. ✓
- Cloud sync (PG table, SYNCED_TABLES, notifySync) → Tasks 3 + 7. ✓
- Nullable-FK sync correctness (the key risk) → Task 7, isolated + tested. ✓
- English UI, cs-CZ dates, no i18n → Global Constraints + Task 6 (formatDate*). ✓
- Testing surface (repo, sort, FK descriptor) → Tasks 1, 5, 7. ✓

**Known limitations (acceptable for v1, from the spec's Out-of-scope):** iPad UI for notes (data syncs, display deferred); Dashboard/Billing surfacing; drag-reorder; the latent `toSqliteValue` DATE back-shift on `due_date` (handled as any other `date` column, not newly fixed here); full-text search (LIKE only).

**Placeholder scan:** No TBD/placeholder steps; every code step has complete code except Task 6's UI, which is specified as component contracts + behavior + the prototype reference (the renderer has no component-test harness, so it ends in an app-run verification rather than a red/green unit test). Task 1's RLS DDL says to match the existing projects policy verbatim if it differs from the sketch — that is a fidelity instruction, not a placeholder.

**Type consistency:** `NoteDone`/`NotePriority` identical across repo, contract, messagePort, hook, sort. `NoteViewPayload` fields match `noteViewOf` and `NoteRow` one-to-one. `fkSource` gains `nullable` uniformly in push + pull; `fkSourceForTest` exported from both.
