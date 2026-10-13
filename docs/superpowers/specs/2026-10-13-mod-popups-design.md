# Blast-radius popup and Replay tab — design

Date: 2026-10-13. Status: approved in chat, awaiting spec review.
Builds on `2026-10-13-side-panel-tabs-design.md` (same branch, `feat/side-panel-tabs`).

## Goal

The last two mods that draw on the right side of a Claude terminal move into
Watchtower's own UI, so nothing mod-drawn is left inside the terminal:

- **blast-radius** (holds a risky Bash command until the user answers) becomes a
  blocking **popup** over its pane.
- **replay-theater** (step-by-step diffs of the last turn's edits) becomes a third
  side-panel tab: **Agents | Files | Replay**.

### What the user asked for

- Blast popup + Replay tab (not both popups, not blast only).
- The answer travels back by the mod polling Watchtower (approach A), not a file
  and not a simulated keypress.

### Non-goals

- Replay history beyond the latest turn.
- Changing what blast-radius classifies as risky or how it measures impact.
- The savvy-progress `isBridged` follow-up (separate).

## Section 1 — Blast-radius popup

### Patched mod: `plugins/blast-radius/`

- Vendored from the user's playground copy
  (`~/.claude/local-plugins/playground/claude-code-playground/claude-code/mods/blast-radius`,
  Apache-2.0). Keep the LICENSE (copied from the playground repo root) and add a
  "Watchtower fork" note to its README listing every change.
- "Inside Watchtower" = `WATCHTOWER_INSTANCE_ID` is set (same rule as the filetree
  fork, `inWatchtower`). Bridge discovery (listener.json, bearer token) copied from
  `plugins/filetree`; the bridge is transport-only and rediscovered on failure.
- Inside Watchtower, a hold:
  - never opens its pane or draws its band;
  - POSTs `/mods/blast-radius` with
    `{ version: 1, hold: { id, command, riskLabel, summary, lines, note, startedAt } }`
    (`lines` as the mod already caps them; `id` unique per hold);
  - each wait-loop iteration GETs `/mods/blast-radius/decision?id=<id>`:
    - `{ decision: 'proceed' | 'cancel' }` → ends the wait exactly as the
      terminal buttons do;
    - `{ decision: null }` → keep waiting;
    - 404 / "unknown hold" → re-POST the hold (Watchtower restarted), keep waiting;
    - network error → keep waiting;
  - when the hold ends for any reason, POSTs `{ version: 1, hold: null }`.
- The 10-minute limit, interrupt handling and "anything unexpected refuses" stay
  as upstream. Nothing but an explicit `proceed` runs the command.
- Outside Watchtower: behaviour unchanged.

### Watchtower

- `orchestrator/hookListener.ts`: `KNOWN_MODS` gains `blast-radius` and
  `replay-theater`. A new authenticated `GET /mods/blast-radius/decision`
  (same bearer token + `x-watchtower-instance` checks as the POST route) returns
  the recorded decision for that instance's pending hold if `id` matches, else
  `{ decision: null }`; unknown hold → 404.
- `orchestrator/services/blastRadiusStore.ts`: pending hold per instance
  (validated by a shared parser), recorded decision, push `blastRadius` on every
  change, `blastRadius:get` and `blastRadius:decide { instanceId, holdId, decision }`
  IPC. A decision for a non-pending id is ignored. A hold older than 11 minutes is
  dropped; instance disposal drops it.
- Attention: while a hold is pending the instance is flagged like a permission
  prompt (amber ⚠ on pane and tab, macOS notification); cleared when the hold ends.
  Reuse the existing attention/notification path, do not invent a parallel one.
- Renderer: `BlastRadiusDialog` over the pane (not app-modal): "⚠ Blast Radius ·
  <risk>" title, the command in monospace, red "Would …" summary, affected paths
  (capped, "+N more"), the note, **Cancel** (default focus, Esc) and **Proceed**.
  After answering it shows "Waiting for Claude…" until the mod posts `hold: null`.
  It persists across tab switches and reappears when the pane is shown again.
  Hook `state/useBlastRadius.ts`.

## Section 2 — Replay tab

### Patched mod: `plugins/replay-theater/`

- Vendored from the playground copy (Apache-2.0), same README/LICENSE treatment.
- Inside Watchtower: never draws its band or pane. After each turn with edits it
  POSTs `/mods/replay-theater`:
  `{ version: 1, panelToggles, turn: { at, steps: [{ file, tool, note, added, deleted,
  lines: [{ kind: 'add' | 'del' | 'ctx' | 'gap', text }] }] } }` — latest turn only,
  at most 50 steps and 200 lines per step (the mod's own line diff, uncut by its
  12-line terminal view).
- `/replay` inside Watchtower bumps `panelToggles` and posts instead of opening.
- Posts a `panelToggles: 0` baseline at session start (as the filetree fork does).

### Watchtower

- `replayStore` (twin of `fileTreeActivityStore`), shared parser enforcing the same
  caps, push `replay`, `replay:get`.
- `SideTab` gains `'replay'`; `sideTabsFor` offers it wherever Claude runs
  (`kind !== 'shell'`). `/replay` toggles it via `useSidePanel` toggles.
- Tab label shows the unseen turn's step count ("Replay · 3") until the tab is
  opened. No auto-open.
- `ReplayTab`: numbered step chips (current highlighted), file path relative to the
  pane's cwd, "Tool · note +a −d", the diff in monospace (green `+`, red `-`, dim
  context, `⋯` gaps), Prev / Next buttons and ←/→ when focused. A new turn resets
  to step 1. Empty state: "No edits in the last turn yet."

## Section 3 — Safety, failures, install, testing

- Only an explicit `proceed` for the currently pending hold id runs a command.
  `blastRadius:decide` is an ordinary IPC kind, so the iPad/iPhone clients can
  answer too (same reach as every other kind).
- Failures: Watchtower restart mid-hold → mod re-posts on 404; Claude/mod dies
  mid-hold → store drops the hold at 11 minutes or on disposal; oversized replay →
  parser caps. Background kinds (`blastRadius:get`, `replay:get`) go on
  `SILENT_KINDS`; `blastRadius:decide` stays loud.
- Install (ask the user before editing `~/.claude/settings.json`): disable
  `blast-radius@claude-code-playground-mods` and
  `replay-theater@claude-code-playground-mods`; add both forks' absolute paths to
  `CLAUDE_CODE_PLUGIN_DIRS` (`:`-separated).
- CLAUDE.md: extend the side-panel section with both bridges and the decision
  route; "change together" rule for each mod body and its shared parser.
- Tests:
  - orchestrator: both stores (stale id, 11-minute expiry, disposal, parsers with
    caps) and the decision GET through the real HTTP listener incl. auth;
  - renderer: dialog Cancel/Proceed/Esc/waiting state; Replay tab navigation,
    "· N" label, empty state; `sideTabsFor` with replay;
  - mods (`claude plugin test`, new `tests/` per mod): no pane/band inside
    Watchtower, hold posted, proceed runs / cancel denies, retry while unreachable,
    re-post on 404, replay turn posted with caps, `/replay` toggles, unchanged
    outside Watchtower;
  - live review in the dev app.

## Delivery

Three phases, each leaving the app working (commits per task):

1. Blast-radius popup (Watchtower side + mod).
2. Replay tab (Watchtower side + mod).
3. Install switch, CLAUDE.md, live review.
