# Watchtower iPad — Instances module (terminal mirroring) — System Design

**Date:** 2026-06-24
**Status:** Design approved (brainstorm), pending implementation plan
**Issue:** #74 — [Phase C·7] Instances module on iPad (terminal mirroring)
**Epic:** #77 — Watchtower remote access (iPad / iPhone)
**Depends on:** #73 (Capacitor iPad shell), #68 (remote transport foundation)
**Defers to:** #83 (split-pane tiling on iPad)

---

## 1. Goal & context

Bring the **Instances** module to the iPad: mirror a Mac terminal session live to
the iPad, let either device drive the same pty, spawn/resume sessions, and surface
attention badges. The target usage is an **iPad with a Magic Keyboard on an external
monitor as a primary work surface** — not a secondary glance screen. The Mac stays
awake to host the orchestrator (the live plane); the iPad is the working surface.

This rides the existing LAN `ws://` transport skeleton from #73. Tailscale / TLS /
WAN (#72), push / messaging hub (#71), and TimeTracker on iPad (#69) are out of
scope here.

### Key finding from the code map

Mirroring is **already ~90% wired**:

- `orchestrator/wsBridge.ts` already broadcasts *every* push — including `ptyData`
  (`{ instanceId, chunk }`) — to all connected WS clients. It is multi-client and
  token-authed.
- `ptyWrite { instanceId, data }` and `ptyResize { instanceId, cols, rows }` already
  accept input from any client.

So the iPad needs a **UI** plus **two orchestrator gaps closed** (replay-on-attach,
multi-client sizing). No new transport plumbing.

---

## 2. Decomposition — four independent blocks

1. **iPad chrome** — lean reimplementations of the desktop `ModuleRail` (left nav)
   and `TabStrip` (top, projects-grouping-instances + ⚠️ badges), driven by the WS
   bridge instead of `window.watchtower`.
2. **Terminal attach + replay** *(orchestrator gap #1)* — seed a freshly-attached
   client's xterm with the current screen, then follow live `ptyData`.
3. **Multi-client pty sizing** *(orchestrator gap #2)* — focus-ownership so the
   most-recently-focused client owns the pty dimensions; the other reflows.
4. **Spawn-into-projects + resume** — "new session" modal listing Watchtower
   projects + claude/shell; resume/restart of existing sessions.

The iOS soft-keyboard **accessory bar** rides along block 1.

---

## 3. Block 1 — iPad chrome

### Layout (single full-width terminal; no tiling in v1)

```
┌──────┬───────────────────────────────────────┐
│ rail │ [watchtower] [pps-tech ⚠] [scratch] [+]│  ← top: project tabs
│      ├───────────────────────────────────────┤
│ ▣ In │ user@mac ~/Projects/watchtower          │
│ ⏱ TT │ $ npm run dev                           │  ← single full-width
│ ⚙ Se │ ...live mirrored terminal...            │     terminal
│      │                                         │
│ ☾    ├───────────────────────────────────────┤
│      │ [esc][ctrl][tab][↑][↓][←][→]   (soft kb)│  ← accessory bar
└──────┴───────────────────────────────────────┘
```

### Components (`apps/ipad/src/components/`)

- **`Rail`** — Instances active; TimeTracker / Settings rendered but **disabled**
  (tooltip "coming soon"); theme toggle. Uses the shared cross-app theme.
- **`TabStrip`** — project-grouped tabs from `deriveTabs` (shared), ⚠️ from
  `tabsNeedingAttention` (shared), recomputed on `stateChanged` pushes. Tapping a
  tab selects its session as the active terminal. `[+]` opens the spawn modal.
- **`TerminalView`** — one xterm.js + FitAddon; runs `attachTerminal()` (§4). Sends
  `ptyWrite` on input, `ptyResize` on fit, `terminalFocus` on mount/foreground (§5).
- **`AccessoryBar`** — Esc, Ctrl (sticky modifier), Tab, arrows; visible only when
  the soft keyboard is up (no hardware keyboard attached). Maps keys → control
  sequences sent via `ptyWrite` (Esc → `\x1b`, Ctrl-C → `\x03`, arrows → `\x1b[A`…).
  Kept even though the Magic Keyboard is the primary input — the iPad Magic Keyboard
  has no physical Esc key.
- **`SpawnModal`** — project picker from `projects:list` (over WS) + claude/shell
  toggle → `spawn` IPC.

### Shared extractions (`@watchtower/shared`)

`deriveTabs` (project→instance grouping) and `tabsNeedingAttention` (status →
badge) are pure; extract them so desktop and iPad compute tabs/badges identically.
Attention is derived from instance status (`waiting-permission`, `waiting-input`,
`crashed`).

### State (`apps/ipad/src/state/`)

Thin hooks wrapping the bridge (`useInstances`, `useProjects`, `useActiveTerminal`),
mirroring how `apps/desktop/src/state/` wraps `window.watchtower`. **No bridge calls
from components directly** (project convention).

---

## 4. Block 2 — Terminal attach + replay

### Problem

A client attaching to a running session currently receives only **new** `ptyData`;
the screen is blank until the next output. `terminalSnapshots.ts` keeps a per-instance
headless xterm (fed every chunk) but its `snapshot()` is text-only / color-stripped
(built for Slack DMs), not a faithful mirror.

### Design

- Add **`@xterm/addon-serialize`** to the existing headless terminal in
  `terminalSnapshots.ts` and expose `serialize(id): string` — a replayable ANSI
  string reproducing colors, cursor, and scrollback. The existing text-only
  `snapshot()` stays for Slack.
- New IPC kind **`terminalAttach { instanceId } → { data: string; cols: number; rows: number }`**.
- Client-side `attachTerminal()` helper (in `apps/ipad/src`) ordering, to avoid any
  gap or double-render:
  1. Subscribe to `ptyData` for the instance; **buffer** incoming chunks locally.
  2. Call `terminalAttach`.
  3. Write `data` (the snapshot) into xterm, then drain the buffered chunks in order.
  4. Switch to writing live chunks directly.

Costs nothing on the desktop (it keeps its live-only path; the headless buffer
already exists).

---

## 5. Block 3 — Multi-client pty sizing (focus-ownership)

### Problem

One pty has one `(cols, rows)`; two viewports want different sizes. Today
`ptyResize` is last-writer-wins → thrash when Mac and iPad both show the same
session (exactly the Mac-clamshell + iPad-monitor case).

### Design (per issue spec: most-recently-focused client owns size; other reflows)

- `wsBridge.ts` tags each request with its **origin** (which socket, vs. local Mac
  IPC).
- Orchestrator keeps, per instance, a `sizeOwner` = the client that most recently
  **focused** that terminal.
- New IPC kind **`terminalFocus { instanceId }`** — sent by a client when its
  terminal view gains focus (iPad: opened/foregrounded; desktop: leaf focused). Sets
  `sizeOwner`.
- `ptyResize` from the current `sizeOwner` applies to the pty; from a non-owner it is
  **stored but not applied** (no thrash). When the owner disconnects, ownership falls
  back to a still-present client and the pty resizes to that client's stored dims.
- The non-owning viewport "reflows" = its xterm renders at the pty's actual cols/rows
  (letterboxed / scrolled in the larger viewport). Acceptable per spec.

Touches: `wsBridge.ts` (origin tagging), `orchestrator/index.ts` (ownership map +
two new kinds), and ~3 lines in desktop `Terminal.tsx` (emit `terminalFocus` where
it already emits the initial `ptyResize`).

Rejected alternative: pure last-writer-wins with no focus signal — less code, but
thrashes badly when both screens show the same session. Focus-ownership (~40 lines)
is worth it.

---

## 6. Block 4 — Spawn-into-projects + resume

- **Spawn:** `SpawnModal` lists Watchtower projects (each has a `folder_path` on the
  Mac) via `projects:list` over WS + a claude/shell toggle → existing `spawn` IPC.
  **No filesystem browsing / native directory picker** on iPad (`chooseDirectory` is
  Electron-only and the iPad can't browse the Mac FS). Spawning is project-list-only.
- **Resume / restart:** existing `restartInstance` kind.

---

## 7. Reconnection

The skeleton transport queues outbound but does **not** auto-reconnect. The module
adds a thin reconnect wrapper around `createWebSocketTransport` **in the iPad app**
(the transport package stays generic):

- On WS drop: show "disconnected — reconnecting".
- On reconnect: re-run `listInstances` + **re-attach** the active terminal (re-seed
  via snapshot, since live data was missed while offline).

Essential for the Mac-sleeps / Wi-Fi-blip reality.

---

## 8. New / changed IPC surface

| Kind | Direction | Payload → Response | Notes |
|---|---|---|---|
| `terminalAttach` | client → orch | `{ instanceId }` → `{ data, cols, rows }` | Serialized ANSI snapshot for seeding. |
| `terminalFocus` | client → orch | `{ instanceId }` → `{ ok: true }` | Sets pty `sizeOwner`. |

Both round-trip over WS (not Electron-only). Existing kinds reused as-is:
`listInstances`, `stateChanged` (push), `ptyData` (push), `ptyWrite`, `ptyResize`,
`projects:list`, `spawn`, `restartInstance`.

---

## 9. Testing

- **Shared** — unit tests for extracted `deriveTabs` + `tabsNeedingAttention`.
- **Block 2** — orchestrator: feed chunks, assert `serialize()` reproduces the
  screen; `terminalAttach` returns `{data, cols, rows}`. Helper: `attachTerminal()`
  subscribe→buffer→drain ordering against a fake bridge (no gap, no dupe).
- **Block 3** — orchestrator: `terminalFocus` sets owner; `ptyResize` from owner
  applies, from non-owner stored-not-applied; owner disconnect falls back to the
  other client's stored dims.
- **iPad units** — reconnect wrapper (re-attach on reopen); accessory-bar key →
  sequence mapping.
- **Manual on-device acceptance** (recorded in PR, like #73): Mac session mirrors to
  iPad live; typing on iPad reaches the pty; Esc/Ctrl via accessory bar work;
  spawn-into-project works; kill on Mac reflects on iPad.

---

## 10. Scope

**In scope (v1):** chrome (rail + project tabs + badges), single full-width terminal
with faithful replay-on-attach, focus-owned sizing, accessory bar, spawn-into-projects
+ resume/restart, reconnection.

**Non-goals (deferred):**
- Split-pane tiling → **#83**.
- TimeTracker / Settings / Dashboard on iPad → own issues (#69 etc.); rail entries
  disabled.
- Tailscale / TLS / WAN → **#72**; v1 stays on the LAN `ws://` skeleton.
- Push / messaging hub → **#71**.
- Native directory picker / FS browsing on iPad → not doing; spawn is
  project-list-only.

---

## 11. Acceptance (from #74)

A session shown on the Mac mirrors to the iPad live; typing on the iPad reaches the
pty; special keys work via the accessory bar. Plus: spawn-into-project, resume/restart,
attention badges, focus-owned sizing, and reconnection re-seed.
