# One-click meeting sync — dedicated background instance

**Date:** 2026-07-23
**Status:** Design (spike-validated)
**Author:** Jan Prokorát (with Claude)

## Problem

Two buttons in the desktop app only *copy a slash command to the clipboard* for
the user to paste into a Claude chat and run by hand:

- **TaskGrid → "Sync meetings"** (`apps/desktop/src/components/timetracker/TaskGridView.tsx`)
  copies `/sync-meetings FROM TO "<db>"` — logs Outlook meetings as worklogs.
- **Teams popover → "Refresh"** (`apps/desktop/src/components/teams/TeamsPill.tsx`,
  `MeetingsPopover.tsx`) copies `/teams-refresh "<db>"` — refreshes today's
  meetings cache the popover reads.

Both need **Outlook calendar data**, which in this environment is reachable only
through the **Microsoft 365 MCP**, and the MCP only exists *inside a Claude
session*. Two more-direct paths were built and reverted:

- **Direct MS Graph OAuth** (~600 LOC) — the Greencode tenant blocks app
  registration *and* first-party auto-install, so the device-code flow can
  never run here.
- **Orchestrator spawns headless `claude -p '/sync-meetings …'`** — abandoned
  because headless `claude -p` hangs on M365 MCP init (the 180 s timeout trips).

The clipboard hand-off is the surviving fallback.

## Goal

Make both buttons *do the work* on click — no manual paste — by driving a
Claude session that has the MCP, without reintroducing the headless-hang.

## Key insight (spike-validated)

Watchtower already orchestrates **live, interactive** Claude Code instances, and
an interactive session loads the M365 MCP fine. The old hang was specific to
**headless `claude -p`** — not the interactive path. So the button can spawn a
short-lived, hidden interactive instance, inject the slash command, wait for it
to finish, refresh the UI, and tear the instance down.

### Spike results (2026-07-23)

A throwaway `node-pty` harness (`scratchpad/spike2.mjs`) spawned
`claude --allowedTools "mcp__claude_ai_Microsoft_365" Write Bash` in the WT repo,
injected `/teams-refresh "<db>"`, and observed:

- **No interactive gate.** Default permission mode + a scoped `--allowedTools`
  allowlist → no bypass-consent screen, no per-tool prompt. All MCP calls, the
  `/tmp` `Write`, and the `node` writer ran unattended.
- **No MCP-init hang.** Completed in ~52 s (2 MCP calls + writer) and wrote
  `teams.meetings_today` (`2 meetings, 0 dropped`).
- **TUI scraping is unreliable.** Raw pty output is badly ANSI-garbled; the two
  commands word their summaries differently (`Summary:` vs `Cache refreshed
  successfully…`). Completion detection must NOT scrape the terminal.

Two design decisions follow directly:

1. **Permissions:** scoped `--allowedTools "mcp__claude_ai_Microsoft_365" Write
   Bash` in **default** mode. NOT `--dangerously-skip-permissions` — it pops a
   `1. No, exit / 2. Yes, I accept` consent gate that `skipAutoPermissionPrompt`
   does not suppress, which would stall a fire-and-forget job.
2. **Completion:** the instance's `Stop`-hook → `waiting-input` transition
   (already produced by the state machine) signals "turn done"; the *result* is
   read from a deterministic JSON status file the writer scripts emit — never
   from the terminal.

## Architecture

```
[Sync meetings] / [Refresh]  (renderer)
      │  meetings:sync {from,to}   |   teams:refresh
      ▼
electron main → orchestrator
      ▼
orchestrator/services/meetingDriver.ts   (NEW)
  1. guard: reject if a job of this type is already running
  2. delete any stale result file
  3. spawnInstance({ cwd: <WT repo>, background: true,
                     args: ['--allowedTools','mcp__claude_ai_Microsoft_365','Write','Bash'] })
  4. await state → 'working' (SessionStart hook), + small settle delay
  5. ptyWrite(instanceId, '<slash command>\r')   (reuse deliverReply pattern)
  6. await state → 'waiting-input' (Stop hook)  |  hard timeout
  7. read + delete result file  →  { ok, count, dropped?, error? }
  8. disposeInstanceRow(instanceId)   (kills pty, purges row + hooks)
  9. resolve the IPC with the result
      ▼
renderer: toast the result + refetch (worklogs grid | meetings-today cache)
```

### Components

**`orchestrator/services/meetingDriver.ts` (new).** A single async
`runMeetingJob(kind, params)` that encapsulates steps 1–9 above. Owns:
- an in-memory `Set` of in-flight job kinds (one-at-a-time guard per kind);
- the spawn args (allowlist), cwd (WT repo root), timeouts;
- listening for the target instance's state transitions (via the same
  `stateChanged` mechanism the orchestrator already emits) to detect `working`
  then `waiting-input`;
- reading/deleting the result file;
- teardown via `disposeInstanceRow`.

It reuses existing primitives only — `spawnInstance` handler internals,
`pty.write(text + '\r')` (the `deliverReply` pattern), `disposeInstanceRow`.
No new pty/spawn machinery.

**IPC kinds (new).** In `packages/shared/src/ipcContract.ts` (+ mirror in
`shared/messagePort.ts`), two request/response pairs:
- `meetings:sync` — payload `{ from: string; to: string }` (YYYY-MM-DD) →
  `{ ok: boolean; count?: number; error?: string }`.
- `teams:refresh` — payload `{}` → `{ ok: boolean; count?: number; error?: string }`.

Both round-trip renderer → main → orch. They are **long-lived** (30–300 s); the
renderer shows a spinner until resolve. Handlers in `orchestrator/index.ts`
delegate to `meetingDriver.runMeetingJob`.

**`instances.background` column (migration v25).** A boolean flagging the
transient instance so it never enters the tab strip. Filtered out of
`listInstances` (`orchestrator/db/repositories/instances.ts` +
`orchestrator/index.ts` list handler), which feeds `deriveTabs`. The existing
"hidden" mechanism (`useHiddenInstances`) is renderer-only and race-y for an
orchestrator-driven instance, so a real column is the clean choice. (This is an
additive column on `instances`, unrelated to the TT schema-refactor freeze,
which concerns `project_rates`/`is_billable`.)

The `spawnInstance` payload gains an optional `background?: boolean`; when set,
the inserted row carries `background = 1`.

**Writer-script result files (small change).** Augment the two writer scripts to
emit a deterministic JSON status file alongside their existing DB write +
stdout summary:
- `~/.claude/commands/log-meetings.mjs` → write
  `{ ok: true, inserted, skipped, total }` to
  `/tmp/watchtower-meeting-result.json`.
- `<repo>/.claude/commands/write-meetings-cache.mjs` → write
  `{ ok: true, written, dropped, syncedAt }` to the same path.

The driver deletes the file before spawning and reads it after idle. Missing or
`ok:false` file ⇒ treat as failure (auth/MCP error) and surface the message.
This keeps success/failure deterministic and unit-testable, independent of TUI
rendering.

### cwd choice

The driver runs both jobs with **cwd = Watchtower repo root**:
- `/teams-refresh` is repo-scoped (`<repo>/.claude/commands/…` and its writer is
  invoked by the relative path `node .claude/commands/write-meetings-cache.mjs`),
  so it *must* run from the repo.
- `/sync-meetings` is user-global, so it works from any cwd.

Repo root satisfies both. (Optional future cleanup: also install
`/teams-refresh` as a user-global command so the driver can use a neutral cwd;
out of scope here.)

### Hooks / instance id

`spawnPtyForInstance` sets `WATCHTOWER_INSTANCE_ID = <rowId>` (via
`shellPolicy.ts`), so the background instance emits hook events that route to its
own row (`SessionStart` → `working`, `Stop` → `waiting-input`). Its id is
distinct from any foreground instance, so same-cwd coexistence is safe (routing
keys on the id; `hookCwdMatches` is only a guard against id-less/leaked nested
claudes). This is the intended managed-instance behavior, not the
nested-contamination hazard (which is about a *leaked* id in an unmanaged child).

### Timeouts

- `teams:refresh`: **180 s** (observed ~52 s for 2 meetings).
- `meetings:sync`: **300 s** (a month range logs many events with routing).

On timeout: `disposeInstanceRow` + resolve `{ ok:false, error:'…timed out — the
Microsoft 365 MCP may not have initialized. Try again, or re-authenticate.' }`.

## UI changes

**`TaskGridView.tsx`** — replace the clipboard write in `submitSyncMeetings`
with `invoke('meetings:sync', { from, to })`; show a spinner on the popover's
submit button while pending; on resolve, `showSuccess('Logged N meetings')` /
`showError(...)` and refetch the worklogs grid. The date-range popover and
validation are unchanged. Remove the "copies the command to your clipboard"
helper text.

**`TeamsPill.tsx` / `MeetingsPopover.tsx`** — `onRefresh` calls
`invoke('teams:refresh', {})`; the Refresh button shows a spinner while pending;
on resolve, refetch `meetings:listToday` (the popover data) and toast the count.
Remove the "paste the copied command into the Claude chat" copy.

## Error handling

- IPC failures surface via the global toast (`state/ipc.ts`) automatically. Both
  new kinds are *not* silent (the user clicked; they want feedback).
- Business failure (`{ ok:false }` from the driver) → `showError` with the
  driver's message (timeout, MCP auth, writer error).
- The guard rejects a second concurrent click of the same kind with a friendly
  `{ ok:false, error:'A meeting sync is already running.' }`.

## Testing

- **Unit (orchestrator):** `meetingDriver` with a faked pty + injected state
  transitions and a temp result file — assert: spawns with the allowlist args +
  `background`, injects the right command string, resolves success on a good
  result file, fails on missing/`ok:false` file, fails + tears down on timeout,
  rejects concurrent same-kind jobs. (No real `claude` spawn in tests.)
- **Unit (writer scripts):** assert each writes the result JSON with correct
  counts (extend existing writer tests if present, else add).
- **Migration:** v6 adds `background`; `listInstances` excludes background rows.
  Add to the migration test suite (mind the node:sqlite vs better-sqlite3
  ADD COLUMN divergence — use a constant/nullable default).
- **Client:** `TaskGridView` / `MeetingsPopover` call the new IPC and render a
  spinner + toast; extend `meetingsPopover.test.tsx`.
- Full `npm test` (219+; keep green) + `typecheck:ci`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| M365 MCP fails to init on some run | hard timeout + teardown + clear re-auth toast; spike shows it normally succeeds |
| `--allowedTools` misses a tool → prompt hang | spike covered the real tool set (MCP server + Write + Bash); timeout is the backstop |
| Transient instance flashes in tab strip | `background` column filtered from `listInstances` before the renderer ever sees it |
| Cost/latency per click (~fresh session) | acceptable for a manual, occasional action; one-at-a-time guard prevents pile-ups |
| Writer result file collision across jobs | single-flight guard is GLOBAL (across both job kinds, not per-key) — at most one meeting job runs at a time; delete-before-spawn clears stale files |

## Out of scope

- Automatic/scheduled sync (this is click-driven only).
- Installing `/teams-refresh` as a user-global command.
- Any change to the routing rules or the MS-Graph path.
