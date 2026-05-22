# Watchtower — Prototype Tracker

> A living document. Updated as the prototype evolves. The single page that tells the story of what Watchtower is, why it exists, where it stands, and where it's going.

---

## TL;DR

**Watchtower** is a macOS platform — built as an Electron app — that becomes the center of my daily work with Claude Code. Its first capability is the one that hurts the most today: a *watcher* that knows the state of every running Claude Code instance and notifies me when one of them is waiting for input. Over time, additional modules (TimeTracker integration, settings/hooks/skills editors, memory inspector, scheduler dashboard, etc.) slot into the same shell.

The platform is named after Watchtower because the first capability literally watches my work — and because, as a metaphor, a watchtower is a personal vantage point: lone, fortified, full of instruments, and the place from which everything else is monitored.

---

## The pitch — why this exists

I run multiple Claude Code instances in parallel across different VS Code terminals. When one needs my input — a permission prompt, an `AskUserQuestion`, an idle end-of-turn — it sits silently. I forget which terminal is which, switch away, and lose hours (sometimes a full day) before I remember to check it. The cost of that forgetting compounds with every new instance I start.

Watchtower solves this directly: every instance lives in a tab inside the app, its state is tracked from Claude Code's own hook events, and macOS notifies me the moment one of them needs me — no matter which app is in the foreground.

That's the MVP. But the same app becomes the natural home for everything else I touch in the Claude Code ecosystem: settings, hooks, skills, agents, memory, MCP servers, cron schedules, plus the existing TimeTracker as a sibling module.

---

## Name — origin

The name was chosen on 2026-05-22 after brainstorming several directions:

- **Atelier** — craftsman's studio (refined, scales to multi-module)
- **Forge** — Stark / Iron Man energy (overused in dev tools)
- **Bastion** — fortified stronghold (Fortress-of-Solitude vibe)
- **Sanctum** — Doctor Strange hideout (mystical, private)
- **Watchtower** ← chosen

Watchtower won because it fits the MVP function *literally* (you watch from a tower) and the platform metaphor *mythically* (Justice League's Watchtower is a space station packed with instruments where the team operates from). It scales: today the tower has one instrument (the instance watcher); tomorrow it has many.

---

## Status

| Phase | State |
|---|---|
| Brainstorming | Done — 2026-05-22 |
| Design spec | Approved — see `docs/superpowers/specs/2026-05-22-watchtower-instance-watcher-design.md` |
| Implementation plan | Done — 37 tasks across 11 phases |
| Visual prototype | Done — `prototype.html` |
| GitHub repo | https://github.com/JanProkorat/Watchtower (private) |
| GitHub issues | 11 phase issues open (see Tracking below) |
| TimeTracker project | Created (id 4, non-billable, 11 epics, 37 tasks) |
| MVP implementation | Not started |
| First runnable build | — |
| First daily-use build | — |

---

## Tracking

### GitHub issues (phase ↔ issue number)

| Phase | Issue |
|---|---|
| Phase 1 — Foundation | [#5](https://github.com/JanProkorat/Watchtower/issues/5) |
| Phase 2 — Orchestrator skeleton | [#10](https://github.com/JanProkorat/Watchtower/issues/10) |
| Phase 3 — State machine + notification rules | [#11](https://github.com/JanProkorat/Watchtower/issues/11) |
| Phase 4 — Hook listener + helper binary | [#9](https://github.com/JanProkorat/Watchtower/issues/9) |
| Phase 5 — PTY management + terminal UI | [#2](https://github.com/JanProkorat/Watchtower/issues/2) |
| Phase 6 — Spawn polish + rail + dashboard | [#6](https://github.com/JanProkorat/Watchtower/issues/6) |
| Phase 7 — Tray + notifications + snooze | [#1](https://github.com/JanProkorat/Watchtower/issues/1) |
| Phase 8 — Suspend / resume / crash recovery | [#8](https://github.com/JanProkorat/Watchtower/issues/8) |
| Phase 9 — First-run wizard + settings | [#7](https://github.com/JanProkorat/Watchtower/issues/7) |
| Phase 10 — Error handling polish | [#3](https://github.com/JanProkorat/Watchtower/issues/3) |
| Phase 11 — Build & ship | [#4](https://github.com/JanProkorat/Watchtower/issues/4) |

(GitHub assigned the numbers in parallel-creation order — the phase number remains the canonical ordering.)

### TimeTracker (project 4, non-billable)

Watchtower time is tracked in the existing TimeTracker app, **not billable**, so total hours show up on the dashboard without affecting any invoice projection.

- **DB:** `~/Library/Application Support/timetracker/data.db`
- **Project ID:** 4 (`Watchtower`, kind `work`, `is_billable=0`, color `#7aa7ff`)
- **Epics:** 11, one per phase (IDs 29–39)
- **Tasks:** 37, named `WT-T1`..`WT-T37` (IDs 788–824), one per plan-Task
- **Worklog convention:** insert into `worklogs` with `source='watchtower-impl'` and `external_id=<commit-sha>` so the unique `(source, external_id)` index dedupes re-runs.

Seed script (for reference): [`/Users/jan/Projects/TimeTracker/scripts/setup-watchtower-project.mjs`](../TimeTracker/scripts/setup-watchtower-project.mjs).

---

## Architecture at a glance

```
┌──────────────────────────────────────────────────────────────┐
│  Watchtower.app (Electron)                                   │
│                                                              │
│  ┌─────────────────┐    IPC     ┌──────────────────────┐     │
│  │ Renderer        │ ◄────────► │ Electron main        │     │
│  │  React + MUI +  │            │  • window / tray     │     │
│  │  xterm.js       │            │  • macOS notifications│    │
│  └─────────────────┘            └────────┬─────────────┘     │
│                                          │ MessagePort       │
│                                 ┌────────▼─────────────┐     │
│                                 │ Orchestrator         │     │
│                                 │  Node child process  │     │
│                                 │  • pty sessions      │     │
│                                 │  • hook HTTP listener│     │
│                                 │  • SQLite store      │     │
│                                 │  • state machine     │     │
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

Three processes inside one Electron app:

- **Renderer** — React UI; hosts `xterm.js` terminals, tab strip, module rail.
- **Electron main** — windowing, tray, macOS notifications. Thin proxy.
- **Orchestrator** (Node `utilityProcess` child) — single source of truth. Owns pty sessions, the localhost HTTP listener that hook events POST to, the SQLite store, and the per-instance state machine.

Plus a bundled **`watchtower-hook`** helper binary that's installed into `~/.claude/settings.json` and forwards Claude Code's hook events to the orchestrator.

Full detail: [`docs/superpowers/specs/2026-05-22-watchtower-instance-watcher-design.md`](docs/superpowers/specs/2026-05-22-watchtower-instance-watcher-design.md).

---

## MVP scope

In scope:

- Standalone Electron app, separate from TimeTracker
- Multi-tab embedded terminals — one Claude Code instance per tab
- Hook scripts in `~/.claude/settings.json` that POST to a local orchestrator
- macOS notifications + tray badge when an instance needs attention
- Snooze, clear-on-focus
- Quit-with-suspend, restart-with-resume (using `claude --resume <session-id>`)
- Crash recovery — live instances resume on next launch even after a crash
- Platform shell with a left module rail (only "Instances" filled at MVP; Dashboard / TimeTracker / Settings as stubs)

Out of scope for MVP (deferred to later modules — see "Roadmap"):

- Other modules: settings / hooks / skills / agents / MCP editors, memory inspector, cron dashboard
- TimeTracker integration (auto-log when an instance touches a Jira key)
- Slack / email notification fallback
- Token / cost tracking per instance
- launchd LaunchAgent promotion of the orchestrator
- Cross-instance message routing
- Plugin / skill marketplace browser
- Session transcript browser / search
- Templates for new instances
- Tear-off windows, split panes inside a tab
- Persistent terminal scrollback across restarts
- In-app auto-update

---

## Roadmap — future modules

The platform's left module rail will eventually host:

1. **Dashboard** — cross-module home. Aggregate status, recent activity, quick actions.
2. **Instances** (MVP) — terminal sessions, instance watcher, notifications.
3. **TimeTracker** — integration with the existing TimeTracker app. Auto-log a worklog when an instance is detected to be working on a Jira key.
4. **Settings / Hooks / Skills / Agents** — GUI for `~/.claude/settings.json`, per-project overrides, hook editor with templates and dry-run preview, skill enable/disable per project, MCP server config.
5. **Memory inspector** — navigate `~/.claude/projects/<slug>/memory/`, search across all projects.
6. **Scheduler** — visualize `/schedule` and `/loop` routines, show next-fire times.
7. **Cost / usage** — token spend per project / session / model, weekly-limit gauge, cost-per-Jira-ticket.
8. **Notification fallbacks** — Slack / email (lift the `ask-user-async` pattern into the platform).
9. **Plugin marketplace browser** — discover and install community skills / agents / plugins.

Ordering after MVP is TBD; "Settings / Hooks" is the most likely second module because the wins are immediate and daily.

---

## Decision log

Append-only record of key calls. Each entry: date, decision, rationale, alternatives considered.

### 2026-05-22 — Initial brainstorming session

| # | Decision | Rationale | Alternatives |
|---|---|---|---|
| 1 | **MVP = instance watcher + notifications** | Solves the highest-cost pain (forgotten waiting instances) first. | Config editor first; launcher first; full design pass first. |
| 2 | **Embedded terminals (own the pty)** | Full I/O visibility without changing how `claude` is invoked elsewhere. User asked for this directly. | Hook-only detection while keeping VS Code terminal; platform-launches-via-pty exclusively. |
| 3 | **Notification trigger = `Notification` hook immediate + `Stop` hook after 90 s** | Matches the actual pain: explicit asks ping immediately; turn-ends ping only when truly forgotten. | Only `Notification`; every `Stop`; configurable per-project rules. |
| 4 | **New Electron app, separate from TimeTracker** | Clean boundaries; no risk of breaking TimeTracker; future-proof for multi-module growth. | Extend TimeTracker; two Electron apps + standalone daemon. |
| 5 | **Internal architecture = Electron + Node `utilityProcess` child for orchestrator** | Lifecycle separation; testable in isolation; clean seam to later promote to launchd. | Single Electron process; jump straight to launchd daemon. |
| 6 | **UI: module rail (far left) + tab strip = instance list** | One UI dimension per concept; no double-rail redundancy. Tabs are familiar terminal idiom. | Inner left rail of instances + tab strip (both — rejected as redundant). |
| 7 | **Tabs are 1:1 with running instances; closing a tab kills the pty** | Removes "detached but running" ambiguity. Confirm-on-close prevents accidental Cmd+W loss. | Allow detached running instances; separate "park" action. |
| 8 | **Quit-with-suspend, start-with-resume via `claude --resume`** | Preserve work across app quits and crashes. Any live instance with a known `session_id` gets resumed; sessions without one (or explicitly killed) do not. | Kill on quit, no resume. |
| 9 | **Single confirm dialog on quit, with per-row "don't resume" checkboxes** | One friction point covers the whole batch; opt-out granularity per session. | Per-session confirm; resume-everything-no-choice. |
| 10 | **Name = Watchtower** | Fits the MVP function literally + the platform metaphor mythically. Scales to many modules. | Atelier (refined / craft); Bastion (fortified); Sanctum (mystical); Forge (overused). |
| 11 | **Repo location: `/Users/jan/Projects/Watchtower`, separate GitHub repo** | Clean separation from TimeTracker; independent versioning, CI, release cadence. | Subfolder of TimeTracker (rejected). |

---

## Open questions / risks

1. **Does `claude --resume <session-id>` exist and behave as expected?** The entire resume flow rests on this. Verify before any code lands.
2. **`SessionStart` hook timing.** If it fires after the first pty `data` event, our `spawning → working` debouncer might transition before pairing. Verify with a real `claude` run.
3. **Hook payload schema stability across Claude Code versions.** Mitigated by event-name-agnostic helper + raw-payload storage.
4. **xterm.js color / scrollback fidelity inside Electron** — usually fine; verify with long streaming outputs Claude produces.
5. **macOS Login Item permission** — adding to login items at first run vs from Settings only; default off is safer.
6. **`utilityProcess` ergonomics for SQLite + native modules** — needs the same `electron-rebuild` step TimeTracker already uses; verify `better-sqlite3` loads cleanly inside the child.

---

## Glossary

- **Watchtower** — this app / platform.
- **Instance** — one running `claude` process under Watchtower's pty management. 1:1 with a tab.
- **Session ID** — Claude Code's identifier for a conversation, used with `claude --resume`. Recorded via the `SessionStart` hook.
- **Orchestrator** — the Node child process inside Watchtower that owns pty, hooks, state, and SQLite. The "brain".
- **Hook helper** — the small bundled binary `watchtower-hook` installed into `~/.claude/settings.json`; forwards Claude Code's hook payloads to the orchestrator.
- **Module rail** — the left-side navigation strip inside the platform that switches between modules (Dashboard, Instances, TimeTracker, Settings…).
- **Tab strip** — the horizontal row of instance tabs inside the Instances module.
- **`quietTimer`** — the per-instance timer that starts on `Stop` hook and fires a notification after a quiet threshold (default 90 s) if the instance hasn't been re-engaged.
- **Suspend** — graceful kill of a pty at app quit, with intent to resume via `claude --resume` on next start.
- **Resume** — re-spawn a previously-suspended (or crashed) instance using `claude --resume <session_id>`, restoring the conversation context.

---

## Build log

Append entries as the project advances. Format: `YYYY-MM-DD — short summary`. Link commits / PRs / spec updates as relevant.

- **2026-05-22** — Brainstorming complete. Design spec written and approved. Repo scaffolded at `/Users/jan/Projects/Watchtower`. Prototype tracker (this file) created.
- **2026-05-22** — 37-task implementation plan written across 11 phases. Visual prototype (`prototype.html`) created with 8 scenes.
- **2026-05-22** — Initial commit pushed to GitHub: https://github.com/JanProkorat/Watchtower (private). 11 phase issues opened. TimeTracker project 4 + 11 epics + 37 tasks seeded for time tracking. Ready to start Phase 1.
- **2026-05-22** — **Phase 1 complete** (issue #5 closed). WT-T1 through WT-T5 landed: package.json + Electron main + Vite/React/MUI renderer + preload `contextBridge` IPC + Vitest. App opens a dark window; ping round-trip from renderer → main works; sanity test passes. 1h 45m logged.
- **2026-05-22** — **Phase 2 complete** (issue #10 closed). WT-T6 through WT-T8 landed: orchestrator forked as `utilityProcess` with MessagePort RPC; ping now round-trips renderer→main→orchestrator→main→renderer; SQLite schema + migrations + 4 repositories (instances/hookEvents/notifications/settings); 9 vitest tests passing. Production uses `better-sqlite3`; tests use built-in `node:sqlite` via `createRequire` to sidestep Node 25 vs Electron Node 22 ABI mismatch + Vite's node:sqlite resolver gap. 2h 20m logged.
- **2026-05-22** — **Phase 3 complete** (issue #11 closed). WT-T9 + WT-T10 landed: pure `transition(state, event)` state machine + pure `decide()` notification rules. Full TDD; 41 vitest tests now passing. Key design call: `waiting-input` is pre-attention (no notification fires for the state itself; only when its `quietTimer` escalates to `idle-notify` or a `notificationHook` arrives and bumps it to `waiting-permission`). 45m logged.
- **2026-05-22** — **Phase 4 complete** (issue #9 closed). WT-T11 through WT-T14 landed: `listener.json` atomic sidecar, fastify hook listener (port walk 7421-7430, bearer auth, 32 KB body cap, 5 known events), `watchtower-hook` esbuild-bundled helper (`dist-helper/watchtower-hook.mjs`, ~1.8 KB), and `bootstrap()` that wires DB + listener + token + sidecar with a `dbFactory` for testable swappable DB drivers. 61 vitest tests passing. 2h logged. Notable detour: Node 25's undici fetch sees ECONNRESET on short responses + early-closed connections — all HTTP test calls use `node:http` instead, and the helper already does (matches production behavior).
- **2026-05-22** — **Phase 5 complete** (issue #2 closed). WT-T15 through WT-T18 landed: `PtyManager` thin wrapper (node-pty injected via constructor for testability), full cross-process spawn/write/resize/kill/list IPC + ptyData/ptyExit/stateChanged pushes, `<Terminal />` xterm.js component with FitAddon + ResizeObserver, `TabStrip` + `useInstances` hook + App integration. 65 vitest tests passing. End-to-end smoke: `electron .` boots, orchestrator forks, sidecar + DB + token written, dark window with Dashboard view + + button. 1h 55m logged.
- **2026-05-22** — **Phase 6 complete** (issue #6 closed). WT-T19 through WT-T21 landed: NewInstanceModal (cwd input + Browse + recent-list), ModuleRail (left activity bar; Instances active, others stubbed), DashboardTab (grouped instance rows with chips + relative timestamps + Open/Kill/Remove actions). 67 vitest tests passing. 1h 15m logged. Plus a clutch of pragmatic interim fixes in this session: ABI / preload-CJS shenanigans, DnD reordering with `display_order` column + v2 migration, last-active-tab persistence, per-instance dot palette, resume-on-restart with fast-fail fallback to fresh spawn, 10s spinner safety net, terminal error boundary.

---

## References

- Design spec: [`docs/superpowers/specs/2026-05-22-watchtower-instance-watcher-design.md`](docs/superpowers/specs/2026-05-22-watchtower-instance-watcher-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-05-22-watchtower-instance-watcher-plan.md`](docs/superpowers/plans/2026-05-22-watchtower-instance-watcher-plan.md)
- Visual prototype (open in browser): [`prototype.html`](prototype.html) — scene switcher across Terminal view, Dashboard, New-Instance modal, First-Run wizard, Resume-failed panel, Settings, Tray menu, Crash banner
- Sibling app (TimeTracker): `/Users/jan/Projects/TimeTracker`
