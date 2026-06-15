# Plain Terminal Instances — design

**Date:** 2026-06-15
**Status:** Approved (brainstorming), pending implementation plan

## Problem

Watchtower can only open Claude Code sessions. The user wants to open a plain
terminal (a normal interactive shell) inside the app so they can:

- Run quick commands (git/npm/test) in the **same project cwd** as a Claude
  session, without alt-tabbing to Terminal.app/iTerm.
- Keep everything in **one window** — Claude sessions and shells side by side
  in the same tab/pane workspace.
- **Watch/monitor processes** — dev servers, log tails, file watchers — living
  alongside the Claude sessions.

Manually driving a shell into `claude` is explicitly *not* a goal.

## Background: why this is non-trivial

Today every instance is hardcoded to be a `claude` process. The relevant
assumptions (verified in the codebase):

- `spawnPtyForInstance` (`orchestrator/index.ts`) hardcodes `command: 'claude'`
  and injects `WATCHTOWER_INSTANCE_ID` into the pty env.
- The state machine (`orchestrator/stateMachine.ts`) is driven **entirely by
  hook events** (`SessionStart`, `UserPromptSubmit`, `Notification`, `Stop`)
  posted by the managed claude process to the localhost HTTP listener.
- `claude_session_id` is set by the `SessionStart` hook; the respawn-on-restart
  walk marks any row **without** a `claude_session_id` as `crashed`.
- The quiet timer / `idle-notify` transition and the Slack escalator both
  assume claude-generated hooks.

A plain shell has **no hooks and no `claude` binary**, so the design is mostly
about which existing machinery to reuse versus opt out of.

## Approach

**One `kind` discriminator on the `instances` table, maximal reuse.** Shells
become first-class rows with `kind='shell'` and reuse all existing plumbing —
`ptyManager`, `TerminalPool`, `Terminal.tsx`, the tab strip, the drag-to-split
pane workspace, and the `ptyData` / `ptyWrite` / `ptyResize` IPC. The only new
behavior is: spawn a different command, and opt out of the hook-driven logic.

**Rejected alternative:** a separate `shells` table + parallel render path. It
would duplicate the entire tab/pane/persistence stack for no benefit.

## Design

### 1. Schema & spawn

- New migration **v11**:
  ```sql
  ALTER TABLE instances ADD COLUMN kind TEXT NOT NULL DEFAULT 'claude'
    CHECK (kind IN ('claude','shell'));
  ```
  Existing rows backfill to `'claude'` via the `DEFAULT`.
- `spawnPtyForInstance` gains a `command` / `args` parameter. For a shell:
  - `command = process.env.SHELL || '/bin/zsh'`
  - `args = ['-l']` (interactive login shell, so `.zshrc` / `.zprofile`,
    aliases, and PATH are picked up).
- **Shells do NOT receive `WATCHTOWER_INSTANCE_ID` in their env.** This is
  deliberate: a shell posts no hooks, and if the user ever types `claude`
  inside it, that nested claude must not inherit the var and clobber a managed
  row (the nested-claude-hook-contamination hazard). No env var → no
  contamination, by construction.
- `spawnInstance` IPC payload gains an optional `kind?: 'claude' | 'shell'`
  (default `'claude'`). Mirror into `shared/messagePort.ts`.

### 2. State model — opt out of hooks

- Shells have no `SessionStart` handshake, so they **skip `'spawning'`** and
  start at a live state immediately (no spinner). The live state reuses the
  existing **`'working'`** status — no new enum value — gated so the UI renders
  a neutral terminal style rather than Claude status text.
- On pty exit:
  - **code 0** → row is deleted and the tab/pane closes (normal "I typed
    `exit`" behavior).
  - **code ≠0** → status `'crashed'`, the tab lingers with a **↻ Restart**
    button that re-spawns a fresh shell into the **same row id**.
- A `kind==='shell'` guard is added at exactly three Claude-only call sites so
  shells never touch them:
  1. the quiet timer / `idle-notify` transition,
  2. the Slack escalator (timers never arm for shells),
  3. the respawn-on-restart validation that marks session-id-less rows
     `crashed`.
- The hook HTTP listener early-returns for any `kind==='shell'` instance id
  (defensive — no hooks should ever arrive for one).

### 3. Restart-on-app-launch

On orchestrator startup, `kind='shell'` rows **re-spawn a fresh shell at the
same `cwd`**. The old pty is dead, so prior scrollback is lost (accepted).
Shells come back **live**, not dormant. (The startup walk branches on `kind`:
shell → `spawnPtyForInstance` with the shell command and no `--resume`.)

### 4. UI

- The new-instance menu gains a **"New terminal"** choice beside "New Claude
  session", reusing the same folder picker.
- TimeTracker project rows gain a **terminal launch action**, reusing the
  Phase 21 launch-bridge, starting at the project's `folder_path`.
- Shell tabs/panes render with a **terminal icon** and the folder name, and
  **none** of the Claude status sublabels (no "waiting permission" etc.). They
  split into panes like any other session (the pane workspace is unchanged).
- `Terminal.tsx` is unchanged beyond not showing the `spawning`/`resuming`
  spinner for shells — it is already generic over `instanceId` via the
  `ptyData` push.

### 5. Components & seams (where it plugs in)

| Unit | Change |
|---|---|
| `orchestrator/db/migrations.ts` | add v11 `kind` column |
| `orchestrator/db/schema.sql` + `repositories/instances.ts` | add `kind` to row shape, insert, mapping |
| `shared/stateModel.ts` | add `kind` to `InstanceRow` |
| `shared/ipcContract.ts` + `shared/messagePort.ts` | `spawnInstance` payload `kind?` |
| `orchestrator/index.ts` `spawnPtyForInstance` | parameterize `command`/`args`/env; branch for shell |
| `orchestrator/index.ts` spawn handler | persist `kind`; shells start `'working'` |
| `orchestrator/index.ts` exit handler | code 0 → delete row + push removal; code ≠0 → `crashed` |
| `orchestrator/index.ts` restart walk | shell rows re-spawn fresh, skip session-id crash check |
| `orchestrator/hookListener.ts` | early-return for shell ids |
| quiet-timer / `slackEscalator.ts` | `kind==='shell'` guard |
| renderer new-instance menu | "New terminal" entry |
| TimeTracker project row | terminal launch action via launch-bridge |
| SessionTabBar / tab + pane render | terminal icon, neutral status, restart button |

### 6. Testing

- migration v11 backfills existing rows to `'claude'`.
- shell spawn uses `$SHELL` (fallback `/bin/zsh`) and **omits**
  `WATCHTOWER_INSTANCE_ID` from the pty env.
- hook events addressed to a shell id are ignored.
- quiet timer and Slack escalator never arm for a shell.
- exit code 0 deletes the row; exit code ≠0 → `crashed`.
- restart re-spawns a fresh shell into the same row.
- restart-on-launch re-spawns shell rows fresh at the same cwd.

## Out of scope

- Resuming a shell's previous process/scrollback (dead pty cannot resume).
- "Open terminal next to this Claude session" action (deferred — not chosen).
- Typing `claude` inside a shell to hand off to a managed session.
