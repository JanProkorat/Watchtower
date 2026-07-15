# Watchtower — Claude Code working notes

Project-specific guidance that complements the global config at
`~/.claude/CLAUDE.md`. Read once per session; the rules here override the
default behaviour where they conflict.

## What this codebase is

A macOS Electron app with three cooperating processes:

- **Renderer** (`client/src/`) — React + MUI v5 + xterm.js. Three modules:
  Instances (Phase 1–11), TimeTracker (Phase 12–22), Settings (Phase 23–29).
- **Electron main** (`electron/`) — windowing, tray, macOS notifications,
  bridge to the orchestrator. Thin.
- **Orchestrator** (`orchestrator/`) — Node `utilityProcess` child. Owns
  the pty sessions, the localhost HTTP listener that hook events POST to,
  the SQLite store, the per-instance state machine, and read/write
  helpers for `~/.claude/` config files (`orchestrator/services/`).

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
| `contracts` | Per-project rate history (contracts) | Overlapping windows are caller-validated, not DB-enforced. |
| `epics` | Project → epics | Plain hierarchy. |
| `tasks` | Epic → tasks | `number` is the Jira-key-ish suffix; `(epic_id, number)` unique. |
| `worklogs` | Time entries | `(source, external_id)` unique — used by auto-imports to dedupe re-runs. `reported_minutes` is the billable-rounded variant of `minutes`. |
| `days_off` | TimeTracker — vacation / sick / other | `(date)` PK; Czech public holidays are computed at request time, not stored. |
| `public_holidays` | Reserved | Currently unused — holidays computed in `orchestrator/services/czechHolidays.ts`. |

**Schema-change rule:** verbatim from TT first, refactor later (see
PROTOTYPE.md decision #13). Don't rename `project_rates` → `contracts`
or drop `is_billable` until the absorption has run on enough dogfood data.

## ~/.claude/ filesystem layout (Settings module reads this)

| Path | Purpose |
|---|---|
| `~/.claude/settings.json` | Global Claude Code config. Keys: `permissions`, `hooks`, `mcpServers`, `enabledPlugins`, `extraKnownMarketplaces`, `statusLine`, `skipAutoPermissionPrompt`, `alwaysThinking`, `telemetry`, `autoApprove`. |
| `~/.claude/settings.local.json` | Local-machine overrides. Not currently edited by Watchtower — touch with the raw editor if needed. |
| `<cwd>/.claude/settings.json` | Per-project override (Settings module's "Project" scope). Created on first write to a project that doesn't have one. |
| `~/.claude/skills/<name>/SKILL.md` | User-installed skill. Frontmatter (`---name`, `---description`) + markdown body. |
| `~/.claude/agents/<name>.md` | User-installed agent. Frontmatter (`---name`, `---description`, `---model`, `---tools`) + prompt body. |
| `~/.claude/plugins/installed_plugins.json` | Index of installed plugins. Each entry has an `installPath` — skills/agents live at `<installPath>/skills/` and `<installPath>/agents/`. |
| `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` | Plugin install root. Walked by `claudeSkills.listSkills()` + `claudeAgents.listAgents()`. |

**Backup convention** for any file Watchtower writes: copy the existing
file to `<path>.bak.<YYYYMMDD-HHMMSS>` before overwriting. Backups
accumulate, never deleted, so manual rollback is always possible (same
pattern as the TT absorption migration).

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
`worklogs:create`, `instances:findByCwd`, `claudeSettings:read`,
`skills:list`. Pushes (orchestrator → renderer events, no response)
live in `IpcPush`: `ptyData`, `stateChanged`, `orchestratorCrashed`,
`activateInstance`, etc.

Settings module's read/write surface is:
- `claudeSettings:read` / `claudeSettings:write` — `~/.claude/settings.json`
  (or per-project) with the backup convention above.
- `skills:list` — walks user + plugin skill dirs, parses SKILL.md
  frontmatter (`orchestrator/services/claudeSkills.ts`).
- `agents:list` — walks user + plugin agent dirs, parses the .md
  frontmatter (`orchestrator/services/claudeAgents.ts`).
- Hooks + MCP servers are edited via the `claudeSettings:write` IPC —
  the renderer mutates the parsed `hooks` / `mcpServers` key in the
  draft, then saves the whole file.

When adding a new kind:

1. Add it to `IpcRequest` (and the matching response in `IpcResponse`).
2. Mirror it into `shared/messagePort.ts` if the orchestrator needs to
   handle it.
3. Add the handler in `orchestrator/index.ts` (or `electron/ipc.ts` if
   electron-only, and add to `ELECTRON_ONLY_KINDS`).
4. Build a thin hook in `client/src/state/` rather than calling
   `window.watchtower.invoke` from components.

## Locale

**UI text is English.** (Switched from Czech app-wide, 2026-07.) Still a
single-language app — **don't add i18n**. Date / number / currency
**formatting** stays Czech (`cs-CZ`, CZK `Kč`) — the app bills in CZK, so the
`formatDate*` helpers, `dayjs/locale/cs`, and `adapterLocale="cs"` are
unchanged. New user-facing strings: write them in English.

- Dates: `D. M. YYYY` (cs-CZ) numeric formatting, via `formatDate*` helpers in
  `apps/desktop/src/util/format.ts`.
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

**All renderer IPC goes through `invoke()` in `state/ipc.ts`, not
`window.watchtower.invoke` directly.** On rejection it raises a global error
toast and re-throws, so *every* failed IPC surfaces app-wide with no extra
code. `contextBridge` freezes the preload bridge, so this is a helper call
sites import — not a monkey-patch.

- **Default: do nothing.** A failed `invoke()` already toasts. Local `try/catch`
  is only for control flow (keep a drawer open, stop a spinner) — don't add an
  inline `<Alert>` for the IPC error; it double-surfaces with the toast.
- **Opt-out of the toast** for background/poll/probe calls via `SILENT_KINDS`
  in `state/ipc.ts` (e.g. `prWatch:list`, `tokens:usage`), or per-call with
  `invoke(kind, payload, { silent: true })` when the caller handles the failure.
- **Structured `warnings`** on a list payload → `toast.showWarning(...)` per
  entry (pattern: `useReviews`).
- **Keep an inline `<Alert>` only** when the message is NOT an `invoke`
  rejection: a resolved-payload business error (`res.error` / `res.lockedThrough`
  — the call succeeded), a `SILENT_KIND`'s sole surface (`TokenUsageCard`,
  PR-watch inbox), form validation, or a JSON-parse error.
- Toasts are FIFO-queued and expose `showError/showWarning/showSuccess/showInfo`
  via `useToast()` (React) or the module-level `toast` bridge (non-React).

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
