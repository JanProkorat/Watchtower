# Watchtower — Claude Code working notes

Project-specific guidance that complements the global config at
`~/.claude/CLAUDE.md`. Read once per session; the rules here override the
default behaviour where they conflict.

## What this codebase is

A macOS Electron app with three cooperating processes:

- **Renderer** (`client/src/`) — React + MUI v5 + xterm.js. Two modules:
  Instances (Phase 1–11) and TimeTracker (Phase 12–22).
- **Electron main** (`electron/`) — windowing, tray, macOS notifications,
  bridge to the orchestrator. Thin.
- **Orchestrator** (`orchestrator/`) — Node `utilityProcess` child. Owns
  the pty sessions, the localhost HTTP listener that hook events POST to,
  the SQLite store, and the per-instance state machine.

Plus a bundled `watchtower-hook` helper (`helper/`) installed into
`~/.claude/settings.json`.

## Build / run / test

- `npm run dev` — Vite renderer + tsc-watch on main/orch; launches the app.
- `npm run build` — builds main, orch, renderer, and helper for packaging.
- `npm run dist:mac` — full `electron-builder` → unsigned `.dmg` / `.app`.
- `npm test` — vitest. **Always 219+ tests; if a phase adds code, add
  tests.**
- `npx tsc -p orchestrator/tsconfig.json --noEmit` — orchestrator typecheck.
- `npx tsc -p client/tsconfig.json --noEmit` — client typecheck. There is
  some pre-existing drift (rootDir for `dev/`, slotProps on MUI v6 TextField,
  `useInstances.spawn` return type). **Don't try to fix these as a side
  quest.**

## Schema (Watchtower SQLite, `~/Library/Application Support/Watchtower/data.db`)

Migration source of truth: `orchestrator/db/migrations.ts`. Current
version: v5.

| Table | Purpose | Notes |
|---|---|---|
| `instances` | One row per Claude Code session under management | `display_order` for the tab strip; `live` is derived from `status`. |
| `hook_events` | Raw payloads from Claude hook scripts | Pruned by `pruneOlderThan(ts)`. |
| `notifications` | Logged macOS notifications | `dismissed_at` set on click. |
| `settings` | Key-value store (TEXT) | One row per setting key. Also holds the `timetracker_migration_status` marker. |
| `projects` | TimeTracker — project | Ported verbatim from TT. `kind` ∈ `work` / `personal` / `time-off`; `folder_path` is what the launch bridge reads. |
| `project_rates` | Per-project rate history (contracts) | Overlapping windows are caller-validated, not DB-enforced. |
| `epics` | Project → epics | Plain hierarchy. |
| `tasks` | Epic → tasks | `number` is the Jira-key-ish suffix; `(epic_id, number)` unique. |
| `worklogs` | Time entries | `(source, external_id)` unique — used by auto-imports to dedupe re-runs. `reported_minutes` is the billable-rounded variant of `minutes`. |
| `days_off` | TimeTracker — vacation / sick / other | `(date)` PK; Czech public holidays are computed at request time, not stored. |
| `public_holidays` | Reserved | Currently unused — holidays computed in `orchestrator/services/czechHolidays.ts`. |

**Schema-change rule:** verbatim from TT first, refactor later (see
PROTOTYPE.md decision #13). Don't rename `project_rates` → `contracts`
or drop `is_billable` until the absorption has run on enough dogfood data.

## IPC namespaces

Two transports:

1. **`shared/ipcContract.ts`** — renderer ↔ electron-main, tagged-union
   request/response. Tools: `window.watchtower.invoke(kind, payload)`.
2. **`shared/messagePort.ts`** — electron-main ↔ orchestrator (Node child),
   MessagePort RPC. Same tagged-union shape.

Most kinds round-trip from renderer → main → orchestrator → main →
renderer. A small set are electron-only (handled by `electron/ipc.ts`):
file picker, `openInVSCode`, `triggerNewInstance`, etc. — see
`ELECTRON_ONLY_KINDS` in that file.

Naming convention is `<noun>:<verb>`, e.g. `projects:list`,
`worklogs:create`, `instances:findByCwd`. Pushes (orchestrator → renderer
events, no response) live in `IpcPush`: `ptyData`, `stateChanged`,
`orchestratorCrashed`, `activateInstance`, etc.

When adding a new kind:

1. Add it to `IpcRequest` (and the matching response in `IpcResponse`).
2. Mirror it into `shared/messagePort.ts` if the orchestrator needs to
   handle it.
3. Add the handler in `orchestrator/index.ts` (or `electron/ipc.ts` if
   electron-only, and add to `ELECTRON_ONLY_KINDS`).
4. Build a thin hook in `client/src/state/` rather than calling
   `window.watchtower.invoke` from components.

## Locale

Czech. **Don't add i18n.**

- Dates: `D. M. YYYY` (cs-CZ), via `formatDate*` helpers in
  `client/src/util/format.ts`.
- Numbers: NBSP thousand separator (`1 234,56 Kč`), via the same helpers.
- dayjs imports must `import 'dayjs/locale/cs'`.
- MUI X DatePicker mounts `<LocalizationProvider … adapterLocale="cs">`
  once at App.tsx; don't re-mount inside subtrees.
- Public holidays: `orchestrator/services/czechHolidays.ts` (Anonymous
  Gregorian Easter + 11 fixed dates from Act 245/2000 Sb.).

## Theme

`client/src/theme.ts` exports a dark + light pair (TT-derived purple /
cyan). `useThemeMode` persists the choice. Chart components read from
`useChartColors` (`client/src/components/timetracker/charts/chartTheme.ts`),
which already wraps `useTheme()` — chart adapters Just Work across both
modes. The xterm Terminal pane stays dark in both — conventional.

## Surfacing IPC errors

- Read paths set their hook's `error` field and render an inline
  `<Alert severity="error">`. Pattern: see `useProjects` + `ProjectsList`.
- Drawer mutations use their own `error` state surfaced inside the drawer.
- Fire-and-forget mutations (archive, delete, snooze, VS Code launch,
  time-off toggle) use the global toast: `const { showError } = useToast();`.
  Pattern: see Phase 22 in `ProjectsList` / `TimeOffTab` / `ContractsTab`.
- **No silent `void state.foo()`.** Either `.catch(err => showError(...))`
  or hoist to a drawer that surfaces its own error.

## Things to NOT do

- Don't add CRUD that bypasses the IPC contract. Renderer never reaches
  into SQLite directly.
- Don't add i18n.
- Don't refactor schema (`project_rates` → `contracts`, etc.) before the
  follow-up issue lands.
- Don't reach across modules (Instances ↔ TimeTracker) without going
  through an App.tsx-level callback. The launch bridge in Phase 21 is the
  reference pattern.
- Don't bypass `pre-commit` hooks or signing — the global config covers
  this; restating because Watchtower's hooks now also run typecheck.
- Don't rename / delete `/Applications/TimeTracker.app` — kept as a
  dogfood safety net.
