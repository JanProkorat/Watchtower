# Slack Escalation — Design

**Date:** 2026-05-30
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/slack-escalation`

## Problem

When a managed Claude Code instance needs the user (a permission prompt, or
it has finished and is waiting for input) and the user is away from the
machine, the only signal today is a macOS notification + tray badge — useless
once the user has stepped away from the computer. Watchtower should escalate
to Slack so the user can be reached, and reply from Slack to keep the session
moving.

## Decisions (settled during brainstorming)

- **Two-way**: the user can reply in Slack and have the text injected into the
  waiting session's pty.
- **Triggers** (all three): permission prompts (`waiting-permission`), done /
  waiting-for-input (`idle-notify`), and crashes / unexpected exits (`crashed`).
- **Timeout**: a single global "escalate after N minutes" setting.
- **Transport**: a user-owned Slack app — bot token (`xoxb-`) to post,
  app-level token (`xapp-`) for **Socket Mode** to receive replies without a
  public URL.
- **Destination**: a bot DM to the user.
- **Reply UX**: free-form text only (typed reply → written to pty + Enter); no
  interactive buttons in v1.
- **Crash timing**: posted immediately when the app window is unfocused (no
  N-minute wait — the session already ended).
- **Focus gate**: escalations fire only when the **whole app window** is
  unfocused (distinct from per-tab focus), since Slack is the "away from the
  machine" channel.
- **Token storage**: plaintext in the local `settings` SQLite table (same as
  all current settings). macOS Keychain is noted as future hardening, not built
  now.

## Phasing

- **Phase 1 — one-way notify** (shippable checkpoint): escalation timers +
  `slackClient` send + Settings config + "Send test message" button.
- **Phase 2 — two-way reply**: `SlackListener` Socket Mode socket + reply →
  pty routing + "Sent ✓" ack.

## Architecture

### New orchestrator units

| Unit | Responsibility | Depends on |
|---|---|---|
| `orchestrator/services/slackClient.ts` | Wrapper over `@slack/web-api`: `postMessage`, `updateMessage`, `testAuth`. Behind an interface so tests inject a fake. | bot token |
| `orchestrator/slackEscalator.ts` (`SlackEscalator`) | Per-instance escalation timers — the Slack analog of `Notifier`/`QuietTimers`. Decides *when* to escalate; emits a `postSlack` call. Injected clock + emitter (mirrors `QuietTimers`). | slackClient, window-focus state |
| `orchestrator/slackListener.ts` (`SlackListener`, phase 2) | Hosts the Socket Mode socket; on a DM reply maps `thread_ts → instanceId` and routes the text into the pty. Auto-reconnects. | `@slack/socket-mode`, pty write |

### Data flow

**Outbound (escalate).** Hook event → `applyTransition` (existing) fans out to
both `Notifier.apply` (unchanged) and `SlackEscalator.apply`. On entering
`waiting-permission` / `idle-notify`, the escalator arms a per-instance timer
for N minutes; engagement transitions (`tabFocused`, `userPromptSubmit`,
`ptyData`) clear it — the same signals that already clear the quiet timer.
Timer fires → if still in an attention state **and the app window is
unfocused** → `slackClient.postMessage(DM, …)`; the returned `ts` is stored in
an in-memory `thread_ts ↔ instanceId` map. `crashed` posts immediately (no
timer) when the app window is unfocused.

**Inbound (reply, phase 2).** Socket Mode `message` in the DM → resolve
`instanceId` by `thread_ts` → `pty.get(instanceId).write(text + '\r')` (the
existing input path at `orchestrator/index.ts:398`) → feed a `userPromptSubmit`
transition to clear attention → `chat.update` the original message with a
"Sent ✓" footer.

### App-focus signal (small addition)

The orchestrator currently only knows *tab* focus (`Notifier.setFocused`).
Forward Electron `BrowserWindow` `'focus'`/`'blur'` from `electron/main.ts` to
the orchestrator via one new push; track it centrally and read it from the
escalator. This is the gate for all Slack escalations.

### Config & storage

New keys in the existing `settings` table (via existing `getSetting` /
`setSetting` IPC):

- `slack_enabled` — `'1'` / `'0'`
- `slack_bot_token` — `xoxb-…`
- `slack_app_token` — `xapp-…` (phase 2)
- `slack_dm_user_id` — resolved Slack user id for the DM
- `slack_escalate_ms` — number, global timeout
- `slack_triggers` — JSON `{ permission: bool, idle: bool, crash: bool }`

Tokens stored plaintext (local single-user DB). Keychain noted as future work.

### Settings UI (renderer)

A new **"Slack" panel** in the Settings module: enable toggle, masked
bot-token + app-token fields, destination (DM user, resolved via `auth.test` /
users lookup), escalate-after-minutes, trigger checkboxes, and a **"Send test
message"** button that round-trips a new `slack:test` IPC. New `useSlackConfig`
hook in `client/src/state/`; no component reaches IPC directly.

### New IPC kinds

`slack:getConfig`, `slack:setConfig`, `slack:test` — added to
`shared/ipcContract.ts`, mirrored into `shared/messagePort.ts`, handled in
`orchestrator/index.ts` (per the CLAUDE.md add-a-kind checklist). A new push
for window focus/blur (electron-main → orchestrator).

## Error handling

- Slack send failures: best-effort + logged (matches existing notify logging).
  The **test button** surfaces auth/config errors inline in the Settings panel.
- Socket Mode auto-reconnects; connection status shown in the Settings panel.
- No silent `void` — config mutations surface errors per the project error
  convention.

## Testing (keep the 219+ rule; add tests for new code)

- `SlackEscalator` timer/decision logic — injected clock + fake emitter
  (mirrors `tests` for `QuietTimers`).
- Reply routing — `thread_ts → instanceId → fake pty.write`.
- `slackClient` behind a fake interface — **no real network in tests**.
- Settings round-trip for the new IPC kinds.

## New dependencies

`@slack/web-api`, `@slack/socket-mode` — bundled into the orchestrator build.

## Out of scope (v1)

- Interactive Approve/Deny buttons (free-form text only).
- Per-instance timeout overrides (global only).
- Keychain-backed token storage.
- Posting to a channel instead of a DM (DM only; trivial to extend later).
