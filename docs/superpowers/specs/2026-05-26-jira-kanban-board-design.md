# Jira Kanban Board — TimeTracker tab

**Status:** approved (verbally, in-conversation 2026-05-26)
**Owner:** Jan Prokorát
**Phase:** Watchtower Phase 31 (Jira read-side, complements Phase 30's worklog write-side)

## Goal

Add a sixth tab to the TimeTracker module that mirrors the user's
Skoda Jira board (RapidView 51682, assignee = currentUser) as a 3-column
Kanban view. The board is a **read-only** mirror — the local Watchtower DB
is the source of truth for the UI, and a Jira sync writes into it on
demand. Existing tasks already attached to local epics/projects get their
status and metadata refreshed; brand-new Jira tickets get auto-routed into
the right project (by `jiraGlobs` key match) and epic (by area-code prefix
`[TEH]`, `[VYR]`, etc., auto-created if absent).

## Out of scope

- Drag-and-drop status transitions (no writes to Jira from this tab).
- Full board (all assignees / swimlanes). Only `assignee = currentUser()`.
- Background polling. Sync runs on tab open (with 5-min staleness gate)
  and on explicit Refresh / Sign-in clicks.
- Per-card logged-vs-estimated bar. Cards show key, title, area-code chip,
  estimate only.
- i18n. Czech-only, like the rest of TimeTracker.

## Decisions captured

| Axis | Choice | Why |
|---|---|---|
| **Placement** | New `board` tab inside TimeTracker (sixth list-mode tab) | Closest to the `tasks` data it mirrors. |
| **Scope** | `assignee = currentUser() AND resolution = Unresolved` | Matches the swimlane in the screenshot; smallest payload. |
| **Slotting** | Route by `projects.jiraGlobs` matching the Jira key, auto-create epic per area code | Reuses an existing per-project field; no new config; same routing semantics as the `jira-fetch` skill uses. |
| **Auth UX** | Reuse `jiraSync.defaultDeps` (Playwright Chromium SSO refresh into Keychain) | Zero new auth code; same Keychain entry as worklog sync. |
| **Interactivity** | Read-only mirror, cards open in browser on click | Smallest surface; status changes still happen in Jira. |
| **Refresh** | On tab open if stale (>5 min) + manual Refresh button | No background polling; predictable network behaviour. |
| **Card content** | Key, title (3-line clamp), area-code chip, estimate (top-right) | Matches the user's screenshot. |

## Status mapping (Jira → Watchtower → column)

| Jira status | `tasks.status` | Column |
|---|---|---|
| `To Do` | `open` | **To Do** |
| `In Progress`, `Waiting`, `In Review` | `in_progress` | **Doing** |
| `In Test`, `To Accept`, `Done` | `done` | **Done** |
| anything else (`Closed`, `Cancelled`, etc.) | untouched; row hidden from board | — |

`In Review` placed in **Doing** ("still being worked on, not yet handed
back"); flag for redirect if that's wrong.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Renderer (BoardTab.tsx + useBoard hook)                             │
│  • mount: Promise.all([board:get, board:authPing])                  │
│  • if cookiePresent && stale → fire board:sync (background)         │
│  • Refresh button → board:sync                                      │
│  • Sign-in button → board:sync (orchestrator pops Chromium first)   │
└──────────────┬──────────────────────────────────────────────────────┘
               │ IPC (existing tagged-union contract)
┌──────────────▼──────────────────────────────────────────────────────┐
│ Orchestrator: JiraBoardService                                      │
│  • shares JiraConfig + defaultDeps with JiraSyncService             │
│  • authPing()   → read Keychain + env, no network                   │
│  • getSnapshot()→ SQL query, joins tasks/epics/projects             │
│  • sync()       → cookie → refresh? → JQL → upsert → clear stale    │
└──────────────┬──────────────────────────────────────────────────────┘
               │
       Watchtower SQLite (v6 migration adds 4 nullable columns)
```

**Invariants:**
- Local DB is source of truth for the UI. Sync writes; UI reads.
- `tasks.jira_status IS NOT NULL` ⇔ row is on the board right now.
- Existing `tasks.status` (3-state) stays in sync with the merged
  mapping so other TimeTracker views (grid, worklogs, jiraSync write-side)
  keep working unchanged.
- `tasks.epic_id` is never re-routed on re-sync; only set at creation.

## Schema delta — migration v6

```sql
ALTER TABLE tasks ADD COLUMN jira_status        TEXT;      -- raw Jira status
ALTER TABLE tasks ADD COLUMN jira_estimate_secs INTEGER;   -- timeoriginalestimate, seconds
ALTER TABLE tasks ADD COLUMN jira_component     TEXT;      -- first label or component name
ALTER TABLE tasks ADD COLUMN jira_synced_at     TEXT;      -- ISO timestamp of last sync
CREATE INDEX idx_tasks_jira_status ON tasks(jira_status) WHERE jira_status IS NOT NULL;
```

No backfill — existing rows get NULL until first sync; board is empty
on first load.

## IPC surface

Three new kinds, mirrored into `shared/messagePort.ts`:

| Kind | Side | Purpose |
|---|---|---|
| `board:authPing` | orch ← renderer | Cheap probe: env configured? cookie in Keychain? baseUrl for "Open in Jira"? No network. |
| `board:get` | orch ← renderer | DB read; returns current snapshot from `tasks WHERE jira_status IS NOT NULL`. |
| `board:sync` | orch ← renderer | Heavyweight: cookie → maybe Playwright refresh → JQL search → upsert → return `BoardSyncResultPayload`. |

Payload shapes verbatim from the conversation:

```ts
export interface BoardCardPayload {
  taskId: number;
  jiraKey: string;
  title: string;
  jiraStatus: string;
  column: 'todo' | 'doing' | 'done';
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
  cards: BoardCardPayload[];     // sorted by (column, estimate desc, key)
  syncedAt: string | null;       // newest jira_synced_at across cards
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

export interface BoardAuthPingPayload {
  configured: boolean;
  cookiePresent: boolean;
  baseUrl: string | null;
}
```

## Orchestrator service — `orchestrator/services/jiraBoard.ts`

Mirrors `jiraSync.ts` structure: env-loaded `JiraConfig`, injectable
`BoardSyncDeps` (reuses `jiraSync.JiraSyncDeps`), `JiraBoardService` class.

Routing functions live in the same file (or a sibling `jiraRouting.ts`
if size becomes a concern), pure, no DB I/O:

```ts
export function detectAreaCode(summary: string, epicSummary: string | null): string | null
export function pickProjectForKey(key: string, projects: ProjectViewPayload[]): ProjectViewPayload | null
```

Sync algorithm (sequential, single-page, single 200-hit POST):

1. Read cookie from Keychain (`deps.readCookie(cfg)`).
2. If missing, `deps.runRefresh(cfg)`; re-read; set `neededBrowserRefresh`.
3. Ensure Epic-Link custom-field id is cached (same disk cache as
   `jira-fetch` at `~/.claude/skills/jira-fetch/.cache/epic_field_id`).
4. `POST /rest/api/2/search` with JQL
   `assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC, updated DESC`,
   fields `summary,status,timeoriginalestimate,labels,components,<epicLinkId>`,
   `maxResults = 200`.
5. On 401/403/302/303 once, `runRefresh` + retry exactly once
   (same pattern as `jiraSync.postOne`).
6. For each hit: `routeAndUpsert(db, projects, hit, now)` →
   counts `created` / `upserted` / `unrouted`.
7. `UPDATE tasks SET jira_status = NULL WHERE jira_status IS NOT NULL AND number NOT IN (...seen)`
   → `removedFromBoard`.
8. Return `BoardSyncResultPayload`.

## Renderer

- **`client/src/util/timetrackerUrl.ts:18`** — add `'board'` to `LIST_TABS`.
- **`client/src/components/timetracker/ListMode.tsx:19`** — add
  `board: 'Board'` to `TAB_LABELS` and render `<BoardTab />` when active.
- **`client/src/state/useBoard.ts`** — new hook, loads + caches
  `BoardSnapshotPayload` and `BoardAuthPingPayload`, exposes `sync()`.
  Auto-syncs on mount only if `cookiePresent` and
  `snapshot.syncedAt` is missing or older than 5 minutes (gate lives
  in the hook, not the orchestrator).
- **`client/src/components/timetracker/BoardTab.tsx`** — three components
  in one file: `BoardTab` (orchestration), `BoardHeader`, `BoardColumns`
  (with embedded `BoardCard`).
- Card click → opens Jira URL (`<baseUrl>/browse/<key>`) via a new
  `openExternalUrl` electron-only IPC kind (added to `ELECTRON_ONLY_KINDS`
  in `electron/ipc.ts`; one-liner `shell.openExternal(url)` with an
  https-only scheme guard).
- Area-code chip colour: a small switch over known area codes
  (`TEH`, `VYR`, `KP`, `INFRA`, `LOG`, `KONTROLA`, `STR`) → a curated
  palette that matches the prototype. Unknown codes fall back to a
  neutral grey. Lives in `client/src/components/timetracker/boardChips.ts`.
- Layout/visuals match the prototype scene **TimeTracker · Board**
  in `prototype.html`.

## Error & edge UX

- `result.error` → `useToast.showError()`. Header keeps previous data.
- `unroutedKeys.length > 0` → persistent warning strip with key list.
- `neededBrowserRefresh === true` → momentary "Re-authenticated" chip.
- `!authPing.configured` → inline `<Alert>` with env var names;
  no Refresh / Sign-in button rendered.

## Testing

- `tests/orchestrator/jiraBoard.test.ts` — same fake-deps pattern as
  `tests/orchestrator/jiraSync.test.ts`:
  - status mapping (every Jira status → expected column)
  - routing (key glob → project; ambiguous → null; longest glob wins)
  - area-code detection (summary tag wins; fallback to epic prefix; null → "Other")
  - sync upsert (new ticket creates task+epic; existing updates fields,
    leaves `epic_id` alone)
  - stale clearing (`removedFromBoard` semantics)
  - auth refresh on 401, retries once, succeeds
  - unrouted ticket → counted + returned in `unroutedKeys`
- `tests/orchestrator/migrations.test.ts` — extend with v6 forward path
  (existing rows get NULL columns; index exists).
- Renderer test (RTL): `tests/client/BoardTab.test.tsx` — three columns
  from seeded snapshot; auth state toggles button; click Refresh dispatches IPC.

## Verification

- `npm test` — full suite stays green; new tests added (target ~30 new).
- `npx tsc -p orchestrator/tsconfig.json --noEmit` clean.
- `npx tsc -p client/tsconfig.json --noEmit` no new errors beyond known drift.
- `npm run dev` smoke: click TimeTracker → Board → Refresh; verify cards render,
  open one in browser, toggle auth state by clearing the Keychain entry
  (`security delete-generic-password -s jira-skoda-cookie -a $JIRA_KEYCHAIN_ACCOUNT`).

## Non-goals later worth revisiting

- Drag-to-transition (write-side Jira). Adds a new
  `POST /rest/api/2/issue/{key}/transitions` flow + transition-id resolution.
- Background polling while tab is visible (simple `setInterval` in the hook).
- A "Jira inbox" fallback project for unrouted tickets (current spec
  surfaces a warning so the user fixes routing manually).
- Showing logged-vs-estimated progress bar on cards (data is already
  in `worklogs`; just a UI add).
