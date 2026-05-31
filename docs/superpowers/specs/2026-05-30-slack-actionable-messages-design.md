# Slack Actionable Escalation Messages — Design (Phase A)

**Date:** 2026-05-30
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/slack-actionable-messages`
**Builds on:** Slack escalation (PR #66) — one-way notify + two-way Socket Mode reply.
**Follow-up:** Phase B "start/drive a session from Slack" tracked in issue #67.

## Problem

The shipped escalation DM is generic — `🔐 fitness-platform needs a permission
decision.` — so when the user is away they have no idea *what* Claude is asking
or *what to type back*. The two-way reply path works (Socket Mode →
`deliverSlackReply` writes to the pty), but answering is guesswork. The DM must
include the actual on-screen prompt + options so a reply is meaningful.

(Separately, the Slack-side "Sending messages to this app has been turned off"
blocker is a Slack **App Home → Messages Tab** setting, not code — out of scope
here.)

## Decision (settled in brainstorming)

Include the **raw on-screen prompt + options** in the DM (covers permission
menus *and* free-form questions; resilient to Claude's prompt wording changing).
Capture it via a **headless terminal emulator** so the snapshot is exactly what
the user would see — not ANSI/redraw noise.

## Capture approach

Maintain one `@xterm/headless` `Terminal` per instance in the orchestrator
(cols/rows matching the pty — default 120×30), fed every pty data chunk. On
escalation, read the terminal's **visible buffer** and reduce it to clean text.

`@xterm/headless@^5.5.0` aligns with the renderer's `@xterm/xterm@^5.5.0`, so the
snapshot matches the user's actual view. Rejected alternative: strip-ANSI over a
raw byte ring buffer — no dependency, but Claude's TUI redraws produce
fragmentary, misleading text, defeating the purpose.

## Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `orchestrator/terminalSnapshots.ts` (`TerminalSnapshots`) | Per-instance headless `Terminal`. `feed(id, chunk)`, `resize(id, cols, rows)`, `snapshot(id): string`, `dispose(id)`. `snapshot` reads the visible buffer rows (`buffer.active`, `translateToString(true)`), drops leading/trailing blank lines, returns the trailing visible content. | `@xterm/headless` |
| `orchestrator/escalationMessage.ts` (pure `formatEscalationMessage(name, kind, snapshot)`) | Builds the Slack DM text: a per-kind header, a fenced code block of the snapshot, and a reply hint. Handles empty snapshot (omit the block, keep the generic line) and truncation. Pure → unit-tested. | none |
| `orchestrator/index.ts` (wiring) | Construct `TerminalSnapshots`; `feed` in the pty `onData`; `resize` in the `ptyResize` handler; `dispose` on pty exit + `removeInstance`; `postSlack` calls `snapshot(id)` then `formatEscalationMessage(...)`. | above |

### `snapshot(id)` contract
- Returns cleaned visible text: the rows of the active buffer, each
  right-trimmed, with leading/trailing blank lines removed.
- Does **not** truncate — presentation/length is the formatter's job.
- Returns `''` if nothing has been captured yet (or the id is unknown).

### `formatEscalationMessage(name, kind, snapshot)` contract
- Header by kind:
  - `waiting-permission` → `🔐 *<name>* needs a permission decision:`
  - `idle-notify` → `⏳ *<name>* finished and is waiting for your input:`
  - `crashed` → `💥 *<name>* crashed / exited unexpectedly. Last output:`
- If `snapshot` is non-empty: append a fenced code block (```) containing the
  snapshot, truncated to the last 25 lines / 1500 chars with a `… (truncated)`
  marker when cut; any triple-backtick in the snapshot is neutralized so it can't
  break the fence.
- Always append a hint line: `Reply in this thread with the option number (e.g. \`1\`) or an instruction.` (omit the hint for `crashed`, since there's nothing to answer).
- If `snapshot` is empty: fall back to today's single-line message (no block).

## Data flow

pty `onData` → `terminalSnapshots.feed(id, chunk)` (alongside the existing
renderer push + `applyTransition(ptyData)`). Escalation timer fires (existing
`SlackEscalator`) → `postSlack(id, cwd, kind)` → `snapshot =
terminalSnapshots.snapshot(id)` → `text = formatEscalationMessage(name, kind,
snapshot)` → `slackClient.postMessage`. Reply path is unchanged: user replies a
number/instruction → `routeReply` → `deliverSlackReply` writes `text + '\r'`.

## Error handling / edges

- **Empty snapshot** (no output captured yet): generic one-line message, no block.
- **Long output**: truncate to last 25 lines / 1500 chars + `… (truncated)`.
- **Leak**: `dispose(id)` on pty exit and `removeInstance` so headless terminals
  don't accumulate.
- **Resize**: `ptyResize` also resizes the headless terminal so wrapping matches
  what the user sees.
- **Sensitive content**: the snapshot can include code/command output; it goes to
  the user's own DM (single-user, already-plaintext-token app). Noted, not gated.
- **`@xterm/headless` in Node**: it's the headless build intended for Node/worker
  use; no DOM required.

## Testing (keep the 444+ baseline; add tests for new code)

- `TerminalSnapshots.snapshot`: feed canned byte sequences including ANSI cursor
  moves / redraws (simulating a permission box being drawn then partially
  redrawn) → assert the snapshot equals the expected final visible lines. Also:
  blank-line trimming; empty buffer → `''`.
- `formatEscalationMessage`: each kind's header; with/without snapshot; truncation
  marker; triple-backtick neutralization; hint present for permission/idle, absent
  for crash.
- No network in tests.

## New dependency

`@xterm/headless@^5.5.0`.

## Out of scope (Phase A)

- Starting / driving a session from Slack (issue #67).
- Interactive Slack buttons (free-form/number reply only).
- Mirroring Claude's streaming output into Slack.
- Re-snapshotting when the prompt changes mid-wait (one snapshot at escalation).
