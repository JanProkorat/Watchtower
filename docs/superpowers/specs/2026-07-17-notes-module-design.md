# Notes / Todo module — design

**Date:** 2026-07-17
**Status:** Approved (design), pending implementation plan
**Prototype:** `docs/prototypes/desktop-notes-module.html`

## Summary

A new **Notes** module in the desktop app's left rail. A *unified item* model: every
entry is a note that can also be a todo. Notes are **Global** or linked to an existing
in-app **project**. Two-pane layout — a filterable list on the left, a markdown editor
on the right (Bear / Apple-Notes style). Notes cloud-sync to Postgres so the data plane
carries them to other devices; the iPad UI to display them is a follow-up.

## Motivation

There is no lightweight place in Watchtower to jot down todos, reminders, or free-form
notes tied to the work in front of you. Ideas, follow-ups, and "fix this later" items
currently live outside the app. Because Watchtower already models **projects** (shared
across Billing and Instances), a note can be scoped to the project it concerns and shown
in that project's color — turning the app into the single place where per-project context
lives alongside the terminals and time entries.

## The unified item model

A single entity — a *note* — that can optionally be a *todo*. Rather than a separate
`is_todo` boolean, this is encoded in the `done` column being **tri-state**:

| `done` value | Meaning | UI |
|---|---|---|
| `NULL` | Plain note (not a todo) | No checkbox shown |
| `0` | Open todo | Empty checkbox |
| `1` | Completed todo | Ticked checkbox, struck-through, sinks to "Completed" group |

"Make this a todo" sets `done = 0`; "no longer a todo" sets it back to `NULL`. This keeps
one table, one list, one editor while cleanly expressing all three states.

## Data model

New table `notes` (SQLite migration **v24**), cloud-synced. Follows `ProjectsRepo`
conventions: `INTEGER` PK, snake_case columns, soft-delete, sync columns.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Identifier (integer, matching `projects.id`). |
| `title` | `TEXT NOT NULL DEFAULT ''` | Short title. |
| `body` | `TEXT NOT NULL DEFAULT ''` | Markdown source. |
| `done` | `INTEGER` (nullable) | Tri-state: `NULL` / `0` / `1` (see above). |
| `done_at` | `TEXT` (ISO, nullable) | Set when `done` transitions to `1`, cleared otherwise. |
| `due_date` | `TEXT` (`YYYY-MM-DD`, nullable) | Optional. Overdue/soon drive row highlight. |
| `priority` | `TEXT NOT NULL DEFAULT 'none'` | CHECK `('none','low','med','high')`. |
| `pinned` | `INTEGER NOT NULL DEFAULT 0` | `0/1`. Pinned floats to top. |
| `project_id` | `INTEGER` (nullable) | `REFERENCES projects(id)`; `NULL` = Global note. |
| `created_at` | `TEXT NOT NULL` | ISO timestamp. |
| `sync_id` | `TEXT` | Unique index; from `newSyncId()`. |
| `updated_at` | `TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'` | Stamped on every write. |
| `deleted_at` | `TEXT` (nullable) | Soft-delete tombstone. |

**Migration rules honored:** `CREATE TABLE IF NOT EXISTS` (replay-safe); constant-only
column defaults (no `datetime('now')` in the create, to avoid the better-sqlite3 ↔
node:sqlite divergence); indexes on `project_id` and `(done, due_date)` for the list sort.

**Project reference & soft-delete:** projects are soft-deleted (never physically removed),
so a `FK CASCADE` won't fire. `project_id` is nullable and reads join `projects` filtered
on `projects.deleted_at IS NULL`. When a note's project is soft-deleted, the stored
`project_id` is **left unchanged** (not rewritten) but the join yields no row, so the note
renders as Global (🌐, no project tag) — and if the project is later restored, the tag
returns automatically. Deleting a project does **not** delete or re-home its notes.

## IPC contract

Add to **both** `packages/shared/src/ipcContract.ts` (`IpcRequest`/`IpcResponse`) and
`packages/shared/src/messagePort.ts` (`OrchRequest`/`OrchResponse`). Naming follows the
`…InputPayload` / `…ViewPayload` / `…ListFilterPayload` convention.

| Kind | Payload (request) | Payload (response) |
|---|---|---|
| `notes:list` | `NoteListFilterPayload` | `{ notes: NoteViewPayload[] }` |
| `notes:create` | `NoteInputPayload` | `{ note: NoteViewPayload }` |
| `notes:update` | `{ id: number; input: Partial<NoteInputPayload> }` | `{ note: NoteViewPayload }` |
| `notes:delete` | `{ id: number }` | `{ id: number }` |

- `NoteInputPayload`: `title`, `body`, `done` (`null|0|1`), `dueDate` (`string|null`),
  `priority`, `pinned`, `projectId` (`number|null`).
- `NoteViewPayload`: the row (camelCase) + joined `projectName` / `projectColor` (nullable)
  for rendering the project tag without a second fetch.
- `NoteListFilterPayload`: `scope` (`'all' | 'global' | 'project'`), `projectId?`,
  `search?`, `openTodosOnly?`, `dueSoon?`, `includeCompleted?` (default true).

`notes:*` are **not** electron-only — they round-trip renderer → main → orchestrator and
are safe over the remote WS bridge, so they are **not** added to `ELECTRON_ONLY_KINDS`.

No push kind is required for v1: the module is single-mounted; cross-subtree freshness is
handled by a local `notesBus` (below), and cloud-sync pulls refresh on the existing cadence.

## Orchestrator

- **`orchestrator/db/repositories/notes.ts`** — `NotesRepo` modeled on `ProjectsRepo`:
  `NoteRow` (app-facing camelCase), `DbRow` (raw), `toRow()` mapper (0/1 → bool where
  relevant, tri-state `done` preserved), `list(filter)` building a dynamic `WHERE` with
  bound params + the sort, `create()`, `update()`, and a soft-delete `delete()` that sets
  `deleted_at`/`updated_at`. All reads filter `deleted_at IS NULL`. Writes stamp
  `sync_id = newSyncId()` and `updated_at = nowIso()`.
- **`orchestrator/index.ts`** — a `notesRepo()` per-request factory and `case 'notes:*'`
  arms in `handleRequest`. Each mutation calls `notifySync()` (notes is a synced table).
  The `list` case joins project name/color into `NoteViewPayload`.

## Cloud-sync

- Register `notes` in `orchestrator/sync/schema.ts` → `SYNCED_TABLES` with `keyCol: 'id'`
  and typed columns (`text`/`int`/`date`/`ts`; `done` is a nullable `int`, `due_date` is
  `date`, `priority`/`title`/`body` are `text`).
- Add the matching Postgres table to `orchestrator/db/pg/schema.ts`.
- **Date coercion caveat:** the known `toSqliteValue` DATE back-shift bug (TZ ahead of UTC)
  affects `due_date` on pull. It is latent under single-Mac LWW today; note it and use the
  same handling as other `date` columns. No new mitigation is in scope here.
- **iPad UI is out of scope** — this module ships the desktop UI + the synced data plane.
  Displaying notes on iPad is a tracked follow-up.

## Renderer

- **`apps/desktop/src/state/useNotes.ts`** — hook modeled on `useProjects.ts`: `{ items,
  loading, error, filter, setFilter, refresh, create, update, remove, toggleDone }`. Uses
  `invoke` from `state/ipc.ts` (never `window.watchtower` directly), so failures surface via
  the global toast automatically. Each mutation `await`s the write then `refresh()`.
- **`apps/desktop/src/state/notesBus.ts`** — a tiny React-free pub/sub (copy of
  `projectsBus.ts`) so any second-mounted `useNotes` stays fresh after a mutation.
  Also **subscribe to `projectsBus`** so a project recolor/rename/delete refreshes the
  project tags shown on note rows.
- **`apps/desktop/src/components/notes/ModuleNotes.tsx`** (+ children: `NoteList.tsx`,
  `NoteRow.tsx`, `NoteEditor.tsx`) — the two-pane UI from the prototype. Glass surfaces via
  the existing `glass.ts` helpers (`glassFill` for the repeating list rows, `glassSurface`
  for the singleton panels — never `Paper` inside a `.map()`).
- **Markdown rendering:** render the body with the markdown library already used elsewhere
  in the renderer if one exists; otherwise a minimal renderer is acceptable for v1. (Plan
  step resolves which — do not add a heavy new dependency without checking.)
- **Three nav touch-points:**
  - `components/ModuleRail.tsx` — add `'notes'` to the `ModuleId` union and an `ITEMS`
    entry (label "Notes", a checklist/note MUI icon). No rail sub-tabs (in-page filtering).
  - `state/useActiveModule.ts` — add `'notes'` to the `VALID` set so it survives reload.
  - `App.tsx` — render `{activeModule === 'notes' && <ModuleNotes … />}` alongside the
    other modules; pass the shared `useProjects` items for the project picker.

## UI / behavior

- **Layout:** left list column (~308px) + editor pane. Single module, no rail sub-tabs.
- **List controls:** search; scope selector **All · 🌐 Global · Projects ▾**; quick filters
  **Open todos · Due soon · Has project**.
- **Row:** checkbox (hidden when `done === null`), priority dot, title, pin, one-line body
  preview, project color tag (or 🌐 Global), due-date chip (red = overdue, amber = due soon).
- **Editor:** big checkbox + title; toolbar (Todo toggle, Priority, Due date, Project
  picker, Pin, Delete); rendered markdown body; footer shows updated-time + sync status.
- **Sort:** pinned → priority (high→low) → due date (overdue first, then soonest) →
  `updated_at` desc. Completed todos (`done === 1`) sink into a collapsible "Completed"
  group at the bottom.
- **New note:** creates a plain note (`done = null`) scoped to the current scope selection
  (Global, or the selected project) and opens it in the editor.

## Locale

UI text is **English** (desktop convention). Date formatting stays cs-CZ via the existing
`formatDate*` helpers. No i18n.

## Out of scope (follow-ups)

- iPad / iPhone UI for notes (data syncs; display is a separate module task).
- Cross-module surfacing: a "due today / open todos" widget on the Dashboard; an open-todo
  count on a project in Billing/Instances. Nice-to-have, not v1.
- Manual drag-reorder (priority + pin + due cover ordering).
- Rich-text/WYSIWYG editing, attachments, note linking, reminders/notifications.
- Full-text search index (v1 does a `LIKE` over title/body).

## Testing

- **`NotesRepo`** unit tests (vitest, node:sqlite migration path): create/list/update/
  soft-delete; the tri-state `done` round-trip; the list sort ordering; scope + quick-filter
  `WHERE` construction; project join (incl. a note whose project is soft-deleted); that
  `delete()` is soft and reads exclude tombstoned rows.
- **Migration v24** applies cleanly on an empty DB and is replay-safe.
- **Sync round-trip** for `notes` if the existing sync test harness covers other tables
  (mirror a `projects`-style case), including the `due_date` date coercion.
- Keep the suite green (219+; add tests for the new code).

## Files to touch

1. `orchestrator/db/migrations.ts` — v24 `notes` table.
2. `orchestrator/db/repositories/notes.ts` — `NotesRepo` (new).
3. `orchestrator/index.ts` — `notesRepo()` + `notes:*` cases.
4. `orchestrator/sync/schema.ts` + `orchestrator/db/pg/schema.ts` — register `notes`.
5. `packages/shared/src/ipcContract.ts` — `notes:*` arms + `Note*Payload` types.
6. `packages/shared/src/messagePort.ts` — mirror the arms.
7. `apps/desktop/src/state/useNotes.ts` + `notesBus.ts` — hook + bus (new).
8. `apps/desktop/src/components/notes/ModuleNotes.tsx` (+ `NoteList`/`NoteRow`/`NoteEditor`).
9. `apps/desktop/src/components/ModuleRail.tsx` — rail entry + `ModuleId`.
10. `apps/desktop/src/state/useActiveModule.ts` — `VALID` set.
11. `apps/desktop/src/App.tsx` — render `<ModuleNotes />`.
