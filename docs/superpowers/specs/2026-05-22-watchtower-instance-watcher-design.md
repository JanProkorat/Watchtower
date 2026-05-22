# Watchtower — Instance Watcher MVP

Date: 2026-05-22
Status: Approved design, pending implementation plan

## 1. Context & motivation

Today I run multiple Claude Code instances in VS Code integrated terminals. When an instance needs my input (permission prompt, end-of-turn idle), it sits silently. I often forget to check that terminal for hours or days, losing real work time.

I want a macOS platform that, as its first capability, **watches my Claude Code instances and notifies me when one of them is waiting for me** — and, later, hosts more modules (TimeTracker, settings/hooks/skills editors, etc.) under the same shell.

This spec covers only the MVP: a standalone Electron app — **Watchtower** — with embedded terminals, an instance state tracker, and macOS notifications.

## 2. Scope

### In scope (MVP)

- A standalone Electron app, separate from TimeTracker
- Multi-tab embedded terminals (one Claude Code instance per tab) via `xterm.js` + `node-pty`
- Orchestrator running as a `utilityProcess` Node child of Electron, owning pty + hook listener + state + SQLite
- Hook scripts installed into `~/.claude/settings.json` that POST structured events to the orchestrator
- macOS notifications + tray badge when an instance needs attention
- Snooze + clear-on-focus behavior
- Quit-with-suspend, restart-with-resume across app restarts and crashes
- A platform shell with a left module rail (Instances is the only filled module at MVP; Dashboard / TimeTracker / Settings slots are stubs)

### Out of scope (deferred)

- Other modules: settings / hooks / skills / agents / MCP editors, memory inspector, cron dashboard
- TimeTracker integration (auto-log work when an instance touches a Jira key)
- Slack / email notification fallbacks
- Token / cost tracking per instance
- Promoting orchestrator to a launchd LaunchAgent
- Cross-instance message routing
- Plugin / skill marketplace browser
- Session transcript browser / search
- Templates for new instances (CLAUDE.md / skills / MCP profile)
- Tear-off windows, split panes inside a tab
- Persistent terminal scrollback across app restarts
- In-app auto-update

## 3. Architecture

### 3.1 Processes

```
┌──────────────────────────────────────────────────────────────┐
│  Watchtower.app (Electron)                                   │
│                                                              │
│  ┌─────────────────┐    IPC     ┌──────────────────────┐     │
│  │ Renderer        │ ◄────────► │ Electron main        │     │
│  │  React + MUI +  │            │  • window / tray     │     │
│  │  xterm.js       │            │  • macOS Notification│     │
│  │                 │            │  • thin proxy to     │     │
│  │  ▲ data stream  │            │    orchestrator      │     │
│  │  ▼ user input   │            └────────┬─────────────┘     │
│  └─────────────────┘                     │ utilityProcess    │
│                                          │ MessagePort + IPC │
│                                 ┌────────▼─────────────┐     │
│                                 │ Orchestrator         │     │
│                                 │  Node child process  │     │
│                                 │  • node-pty sessions │     │
│                                 │  • hook HTTP listener│     │
│                                 │    127.0.0.1 only    │     │
│                                 │  • SQLite store      │     │
│                                 │  • state machine +   │     │
│                                 │    notif rules       │     │
│                                 └────────┬─────────────┘     │
│                                          │ spawn pty         │
└──────────────────────────────────────────┼───────────────────┘
                                           ▼
                                   ┌────────────────┐
                                   │ claude (pty)   │  ◄──┐
                                   │  …per instance │     │ hook scripts
                                   └────────────────┘     │ (~/.claude/
                                           │              │  settings.json)
                                           ▼              │
                                   curl POST localhost ───┘
```

### 3.2 Components

1. **Orchestrator** (Node child via `utilityProcess.fork`) — single source of truth. Owns all pty sessions, the localhost HTTP listener for hook callbacks, the SQLite store, and the per-instance state machine. Communicates with Electron main over a `MessagePort` (request/response + push events).
2. **Electron main** — windowing, tray icon, native notifications, app lifecycle, deep-link handling. Stays thin: forwards UI commands to the orchestrator and orchestrator events to the renderer.
3. **Renderer** — React + MUI (same stack as TimeTracker). Hosts xterm.js terminal panes, the tab strip, the Dashboard tab, the platform's left module rail. Talks to main via `contextBridge`-exposed IPC.
4. **Hook helper binary** (`watchtower-hook`) — small bundled binary in `Resources/`. Installed at absolute path in `~/.claude/settings.json`. Reads Claude Code's hook payload from stdin, the auth token from disk, the orchestrator's listener port from a sidecar config file, and POSTs to the orchestrator. ≤200 ms timeout; never blocks Claude.
5. **SQLite store** — at `~/Library/Application Support/Watchtower/data.db` via `better-sqlite3`.

### 3.3 Data flow (one instance, happy path)

1. User clicks "+" in the tab strip; modal collects working directory and optional args.
2. Renderer → main → orchestrator: `spawnInstance({cwd, args})`.
3. Orchestrator allocates an instance row in SQLite, sets `WATCHTOWER_INSTANCE_ID` env var, spawns `claude` under node-pty, returns the instance ID and stream handle.
4. Pty `data` events flow orchestrator → main → renderer → xterm.js; keystrokes flow back the same path.
5. Inside `claude`, the `SessionStart` hook fires; the helper POSTs `{event: "SessionStart", session_id, cwd, instance_id}` to the orchestrator. The orchestrator pairs `session_id` to the row (by instance ID; falls back to cwd + recency).
6. Subsequent `Notification` / `UserPromptSubmit` / `Stop` / `SessionEnd` events update the state machine.
7. When the state machine decides "needs attention" (rules in §6), orchestrator emits an event → main fires macOS notification + tray badge update + pushes the event to the renderer (so the tab dot glows).

### 3.4 Why this shape

- **Single brain (orchestrator):** UI is replaceable; brain is unit-testable in isolation; promotable to a launchd daemon later without rewriting boundaries.
- **Hooks over pty stdout scraping:** full terminal fidelity from the pty for the user; state transitions come from structured signals, not stdout regex.
- **`MessagePort` (not HTTP) between main and orchestrator:** HTTP is only used by the hook helper → orchestrator path. Main ↔ orchestrator is in-process IPC: faster, no extra port to expose, no auth surface beyond local IPC.

## 4. Instance lifecycle & state machine

### 4.1 States

| State | Meaning |
|---|---|
| `spawning` | pty started; no `SessionStart` hook yet |
| `working` | Claude is actively producing output (recent pty data or `UserPromptSubmit`) |
| `waiting-permission` | `Notification` hook fired — Claude wants user input now |
| `waiting-input` | `Stop` hook fired — turn ended, awaiting next prompt; `quietTimer` running |
| `idle-notify` | `quietTimer` expired while still in `waiting-input` and tab unfocused |
| `finished` | pty exited cleanly (or `SessionEnd` hook fired) |
| `crashed` | pty exited non-zero, or resume failed, or orchestrator detected orphan |
| `suspended` | persisted-only state used between quit and next-start resume |
| `resuming` | pty being respawned via `claude --resume <session_id>` after quit/crash |

### 4.2 Transition triggers

- pty `data` event (debounced) → `working`
- pty `exit` → `finished` (code 0) or `crashed` (code ≠ 0)
- Hooks: `SessionStart`, `UserPromptSubmit`, `Notification`, `Stop`, `SessionEnd`
- Timers: `quietTimer` (default 90 s) fires while in `waiting-input` → `idle-notify`
- Renderer events: tab focused → clears any pending notification for that instance and cancels its `quietTimer`
- Lifecycle: app quit → live states → `suspended`; app start → `suspended` → `resuming` → live states

### 4.3 Rules of thumb

- Only one state per instance at a time. `waiting-permission` trumps `waiting-input` if both somehow co-occur.
- All transitions emit a `state-changed` event over the MessagePort so the renderer and tray can re-render.

## 5. Hook contract

### 5.1 Hooks installed

```jsonc
"hooks": {
  "SessionStart":     [{"hooks": [{"type": "command", "command": "<abs>/watchtower-hook SessionStart"}]}],
  "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "<abs>/watchtower-hook UserPromptSubmit"}]}],
  "Notification":     [{"hooks": [{"type": "command", "command": "<abs>/watchtower-hook Notification"}]}],
  "Stop":             [{"hooks": [{"type": "command", "command": "<abs>/watchtower-hook Stop"}]}],
  "SessionEnd":       [{"hooks": [{"type": "command", "command": "<abs>/watchtower-hook SessionEnd"}]}]
}
```

### 5.2 Helper behavior

1. Read Claude Code's JSON payload from stdin (`{session_id, cwd, hook_event_name, …}`).
2. Read the auth token from `~/Library/Application Support/Watchtower/hook-token` (chmod 600).
3. Read the orchestrator's listener port from `~/Library/Application Support/Watchtower/listener.json` (port + heartbeat timestamp).
4. Read `WATCHTOWER_INSTANCE_ID` env var (set by orchestrator when spawning the pty).
5. POST to `http://127.0.0.1:<port>/hooks/<event>` with the payload, instance ID header, and bearer token.
6. Hard timeout 200 ms. Exit 0 on success, log-and-exit-0 on every failure mode. Never blocks Claude.

### 5.3 Listener safety

- Binds to `127.0.0.1` only.
- Requires bearer token on every request.
- Refuses unknown event names with 400.
- Rejects payloads larger than 32 KB.
- Walks ports 7421 → 7430; writes the chosen port + token to `listener.json` on bind; refreshes on every orchestrator restart.

### 5.4 Pairing rule

- Primary: `WATCHTOWER_INSTANCE_ID` env-var header (deterministic).
- Fallback: `session_id` + `cwd` + most-recent-pty-spawn (for legacy rows or future ad-hoc launches).
- Unknown events are stored as `event_unknown` with raw payload but cause no state transition.

## 6. Notification rules (MVP defaults)

| Trigger | Action | Debounce |
|---|---|---|
| `Notification` hook + instance's tab not focused | Fire macOS notification immediately; tray badge++; tab dot → `waiting-permission` color | none (these are explicit asks) |
| `Stop` hook + tab not focused | Start `quietTimer` (90 s). If still in `waiting-input` when it fires → fire notification, badge++ | per `(instance, hook_event_id)` |
| User focuses a flagged tab | Clear notification, decrement badge, cancel `quietTimer` | — |
| User clicks notification | Open Watchtower window, activate the instance's tab | — |
| Tray "Snooze 5 m / 30 m / 1 h" | Suppress notifications for the chosen scope and duration | — |

- Notification body (MVP): `"Claude in <cwd-basename> is waiting"`.
- Focus Mode / DND is honored automatically by Electron's `Notification` API.
- Snooze applies per-instance or "all instances" depending on which menu it was triggered from.

## 7. UI surface

### 7.1 Tray (menu bar)

- Icon states: neutral / number-badge / alert-tint when any `waiting-permission` is outstanding.
- Click: toggles main window.
- Right-click menu:
  - Header line: `3 running · 1 waiting`
  - One entry per instance: `● capacity-planning — waiting 1m` → click opens window + activates tab
  - `New instance…`
  - `Snooze all ► 5m / 30m / 1h`
  - `Settings…`
  - `Quit Watchtower` (becomes `Quit (suspend N sessions)` when live instances exist)

### 7.2 Main window

```
┌──────────────────────────────────────────────────────────────┐
│ Watchtower                                            ─ □ × │
├────┬─────────────────────────────────────────────────────────┤
│    │  Dashboard │ capacity-pln ● │ technology ◐ │ machinery ○ │ + │
│ ⏱  │─────────────────────────────────────────────────────────│
│ ▶  │                                                          │
│ T  │   $ claude                                              │
│ ⚙  │   ▸ …                                                    │
│    │                                                          │
├────┴─────────────────────────────────────────────────────────┤
│ 3 instances · 1 waiting · hook listener :7421 ✓             │
└──────────────────────────────────────────────────────────────┘
```

- **Module rail (far left, persistent across the platform):** ⏱ Dashboard, ▶ Instances (this MVP), T TimeTracker, ⚙ Settings. Icon-only; tooltip on hover; pin toggle expands to icon+label. (Same idiom as VS Code's activity bar.)
- **Instances module body:** tab strip + active terminal.
  - Tabs are 1:1 with running instances. Tab label = cwd basename + colored status dot.
  - Status dot colors: red `●` (`waiting-permission`), amber `◐` (`waiting-input`), grey `○` (`idle-notify`), pulsing dot (`working`), ✓ (`finished`), ✕ (`crashed`).
  - Pinned-first `Dashboard` tab inside the Instances module: list of all instances (live + recent), last-activity timestamps, bulk actions ("kill all idle", "snooze all").
  - `+` at the end of the tab strip = New instance modal.
  - Closing a tab kills its pty (confirm-on-close if currently `working` or has unsent state).
  - Right-click tab: Kill, Duplicate (new pty in same cwd), Reveal in Finder, Open in VS Code, Copy session ID.
- **Status bar:** instance count, waiting count, hook listener health.

### 7.3 New-instance flow

1. Click `+` (tab strip or tray).
2. Modal: working directory picker (default `~/Projects`, recent list); advanced args (prefilled empty).
3. Spawn → orchestrator allocates ID, sets `WATCHTOWER_INSTANCE_ID`, forks `claude`, opens a tab, focuses it.

### 7.4 First-run flow

1. Welcome screen.
2. **Hook installation wizard:** reads current `~/.claude/settings.json`, shows a unified diff of the additions, requires explicit confirm. Backs up to `~/.claude/settings.json.watchtower-bak.<ts>` before writing.
3. Generates `hook-token` at `~/Library/Application Support/Watchtower/hook-token` (chmod 600).
4. "Test notification" button to verify macOS notification permission.
5. Optional "Start at login" toggle (writes the macOS Login Item entry).

### 7.5 Settings panel

- Quiet-time threshold (seconds, default 90)
- Snooze defaults
- Start at login toggle
- Show in Dock (default yes; option for tray-only)
- Default working directory
- **Hooks** subpanel: re-run install wizard, uninstall (restores backup), regenerate token
- Diagnostics: orchestrator log path, listener port, "Send test notification" button

### 7.6 Stack and conventions

- React 18 + MUI v5 (`@emotion/react`, `@emotion/styled`) — matches TimeTracker.
- `xterm.js` + `xterm-addon-fit` + `xterm-addon-web-links`.
- Dark theme default; light theme available.
- Tray icon uses a macOS template image so it auto-adapts to menu-bar appearance.

## 8. Persistence, suspend & resume

### 8.1 Tables

- **`instances`**
  - `id INTEGER PRIMARY KEY`
  - `cwd TEXT NOT NULL`
  - `status TEXT NOT NULL` — see §4.1
  - `claude_session_id TEXT`
  - `spawned_at INTEGER NOT NULL`
  - `last_activity_at INTEGER NOT NULL`
  - `exit_code INTEGER`
  - `termination_reason TEXT` — `'session-end' | 'user-kill' | 'app-quit-suspend' | 'crash' | 'resume-failed'`
  - `resumed_from_instance_id INTEGER NULL`
  - `jira_key_hint TEXT NULL`
  - `args_json TEXT NULL`
- **`hook_events`** — `id`, `instance_id`, `event_name`, `payload_json`, `received_at`. Pruned after 14 days.
- **`notifications`** — `id`, `instance_id`, `kind`, `fired_at`, `dismissed_at`, `body`.
- **`settings`** — key/value (quiet threshold, snooze defaults, hook port, etc.).

### 8.2 Not persisted (MVP)

- Terminal scrollback (lives only in xterm.js memory).
- The pty process itself (dies with the orchestrator child).

### 8.3 Quit flow

1. User triggers quit (Cmd+Q, tray "Quit", app menu).
2. Orchestrator gathers all live-state instances with a known `claude_session_id`.
3. **One confirm dialog**: *"3 Claude Code sessions are running. They'll be suspended and resumed automatically on next start. Continue?"* with a per-row "Don't resume next time" checkbox (default off).
4. On confirm — in a single SQLite transaction — flip each live row to `status = 'suspended'`, `termination_reason = 'app-quit-suspend'`. Rows with the "don't resume" checkbox flipped to `status = 'finished'`, `termination_reason = 'user-kill'`.
5. For each affected pty: SIGTERM, 2 s grace, SIGKILL.
6. Quit the orchestrator child, quit Electron.

**Edge case — no `session_id`:** an instance whose `SessionStart` hook never fired has no session ID and cannot be resumed. Mark it `crashed` / `reason = 'no-session-id'` and skip it from the resume list. On next start, surface a "Reopen in cwd?" entry on the Dashboard tab.

### 8.4 Start / resume flow

1. App launches → orchestrator child boots → reads `instances` where `status = 'suspended'` AND `claude_session_id IS NOT NULL`.
2. For each, in parallel:
   - Flip status → `resuming`.
   - Spawn `claude --resume <session_id>` under node-pty, in the saved `cwd`, with `WATCHTOWER_INSTANCE_ID` matching the existing row.
   - Open a tab in the renderer immediately (terminal shows resume output).
3. On `SessionStart` hook from the resumed pty → flip to `working` (or the state implied by subsequent events).
4. On fast pty exit (≤2 s, non-zero code) → flip to `crashed`, `termination_reason = 'resume-failed'`. The tab shows an inline panel: *"Couldn't resume session abc12345. Open a fresh `claude` in `<cwd>`?"* with a one-click button. Clicking creates a new row with `resumed_from_instance_id` pointing at the dead one.

### 8.5 Crash recovery (no clean quit)

Same path as 8.4. On boot, the orchestrator finds rows still in live states with `last_activity_at` older than `<startup_time − grace>` and a known `claude_session_id` → treat as `suspended`, set `termination_reason = 'crash'`, then resume normally.

> In practice: **any live row with a known `session_id` gets resumed on next start, regardless of why we lost the pty.** Clean quits and crashes both heal automatically. Sessions without a session ID, and sessions the user explicitly killed (tab-close), do not get resumed.

## 9. Error handling

| Failure | Behavior |
|---|---|
| Orchestrator child crashes | Main detects MessagePort disconnect → red banner "Orchestrator crashed, restarting…". Auto-restart up to 3× / 60 s. Live orphans → resume flow (8.5). |
| Hook listener can't bind 7421–7430 | Fall back to pty heuristics (no output for N s → `idle-notify`). Status bar shows red. |
| Hook helper auth fails | Listener returns 401; helper exits 0 fast. Diagnostic counter in status bar. |
| `claude` not in PATH | Tab shows inline error with "Set path in Settings" link. Per-app override available. |
| macOS notification permission denied | First-run wizard detects and warns; tray badge becomes primary signal. |
| SQLite corruption / migration fail | Move `data.db` → `data.db.broken-<ts>`, start fresh, one-time notice in the UI. |
| `~/.claude/settings.json` malformed during install | Refuse to write; backup unchanged; user-friendly error. |
| Unknown hook event from a future Claude Code version | Helper is event-name-agnostic; orchestrator stores as `event_unknown`, no state transition. |
| Hook payload shape unexpected | Zod validation per event; unknown shape → store raw, log warning, no transition. |

## 10. Testing

### Unit (Vitest — same stack as TimeTracker)

- `transition(state, event) → {state, outputs}` — table-driven across the whole state machine
- `decide(instance, event, focus, snoozed) → action` for notification rules
- Zod schemas for each hook payload (round-trip golden tests)
- Resume planner: given a set of `instances` rows on boot, returns the correct list of resume actions and the correct disposition for unresumable rows

### Integration

- Spin up orchestrator child in a test harness; swap `node-pty` for an echo-binary fixture; POST fake hook events at the listener; assert state transitions and emitted events.
- Hook helper binary: pipe known JSON to stdin, assert outgoing POST shape, headers, and auth.

### E2E (manual for MVP)

- Spawn a real `claude` in a scratch dir → trigger a permission prompt → assert macOS notification.
- Let it sit at end-of-turn → assert quietTimer notification after 90 s.
- Focus the tab → assert notification clears.
- Quit with one live instance → confirm dialog → start app → assert tab reopens via `--resume`.
- Force-kill the app (Activity Monitor) with one live instance → start → assert crash recovery resume.

No Spectron / Playwright for the renderer at MVP.

## 11. Build & ship

- `electron-builder`, same config style as TimeTracker. `dist:mac` and `dist:mac:universal` targets.
- `electron-rebuild` for `better-sqlite3` against the Electron Node version (same constraint already solved in TimeTracker).
- Bundle `watchtower-hook` helper binary into `Resources/`; absolute path written into `~/.claude/settings.json`.
- Ad-hoc code signing for v0.1 (personal install). Notarization later.
- No auto-update at MVP.

## 12. Open questions / risks

1. **Does `claude --resume <session-id>` exist and behave as expected?** The whole resume flow rests on this. Verification step in the implementation plan: read Claude Code CLI help and confirm the flag and the session-id format.
2. **`SessionStart` hook timing.** If the hook fires *after* the first pty `data` event, our `spawning → working` debouncer might transition before pairing. Confirm with a real `claude` run.
3. **Hook payload schema stability across Claude Code versions.** Hard contract; mitigated by event-name-agnostic helper + raw-payload storage.
4. **xterm.js color/scrollback fidelity inside Electron** — usually fine; verify with the longer streaming outputs Claude produces.
5. **macOS Login Item permission** — adding to login items at first run vs from Settings only; default off is safer.
6. **`utilityProcess` ergonomics for SQLite + native modules** — needs the same `electron-rebuild` step as TimeTracker; verify `better-sqlite3` loads cleanly inside the child.

## 13. Future modules (not part of this spec, but the platform shell should accommodate them)

- TimeTracker integration: auto-log a worklog when an instance is detected to be working on a Jira key (pattern-match on cwd or recent prompts).
- Settings / hooks / agents / skills editor module — GUI for `~/.claude/settings.json`, per-project overrides, hook editor with templates and dry-run preview, skill enable/disable per project, MCP server config.
- Memory inspector for `~/.claude/projects/<slug>/memory/`.
- Cron / schedule dashboard (visualizes `/schedule` and `/loop` routines).
- Cost / token tracking per instance (weekly-limit gauge).
- Slack / email notification fallback (current `ask-user-async` pattern lifted into the platform).
- Plugin / skill marketplace browser.

These are listed only to inform shell-level decisions (module rail, settings layout, persistence schema room). They are explicitly out of scope for this MVP.
