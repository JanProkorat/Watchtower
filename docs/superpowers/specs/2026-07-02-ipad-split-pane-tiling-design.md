# Design — #83 iPad split-pane tiling workspace

Epic #77. Deferred from #74 (iPad Instances module). #74 shipped the iPad
Instances module with desktop chrome (project-group tab strip + a **single**
full-width terminal body). This adds multi-pane tiling: 2+ terminals visible at
once, split/close/resize, per tab. The user's primary surface is an iPad with a
Magic Keyboard on an external monitor, so tiling is genuinely wanted.

## Decisions (from brainstorming)

- **Split UX: keyboard + buttons** (tiling-WM style), **no dnd-kit / no
  drag-to-split**. Each pane has split/close chrome; Magic Keyboard shortcuts
  drive split/close/focus. (Desktop's drag-a-tab-to-a-pane-edge is a mouse idiom
  and the "large, fragile" part of the issue — deliberately not ported.)
- **Per-tab workspaces (desktop parity):** each project-group tab owns its own
  workspace tree; switching tabs switches whole layouts.
- **Terminal liveness: Approach B — flat absolute-positioned pool** (see below),
  not desktop's `TerminalPool`/`SlotRegistry`/reparenting port.

## Current state (from exploration)

- **Portable:** the workspace tree types (`WorkspaceLeaf`/`WorkspaceSplit`/
  `WorkspaceNode`/`PersistedLayout`) already live in `packages/shared/src/layout.ts`.
  `apps/desktop/src/layout/workspaceTreeOps.ts` (`splitLeaf`, `unmountLeaf`,
  `setSizes`, `replaceLeafTab`, `findLeafById`, …) is **pure TS, no DOM/React/
  Electron** — trivially movable to shared.
- **iPad lacks:** any terminal pooling/reparenting (each tab switch remounts
  xterm from a `terminalAttach` snapshot), multi-pane state (`useActiveTerminal`
  is a single `useState<string|null>`), MUI, `react-resizable-panels`, dnd-kit.
- **iPad terminal attach:** `TerminalView` creates an xterm per `instanceId`,
  wires `bridge.invoke('ptyWrite'/'ptyResize'/'terminalFocus')` over the
  WebSocket transport, and `attachTerminal(bridge, instanceId, sink)` does a
  buffered snapshot attach. `apps/ipad` is plain React + inline styles.
- **Multi-client pty sizing:** #74 shipped focus-owned `PtySizeOwnership`. Here,
  distinct instances occupy distinct panes → each sizes to its own pane, no
  conflict. Same instance in two panes is disallowed (as desktop's
  `splitLeaf` guards).

## Architecture

### 1. Shared tree machinery
Move `workspaceTreeOps.ts` (and the pure layout helpers it needs) from
`apps/desktop/src/layout/` to `packages/shared/src/layout/` (alongside the
existing `layout.ts` types). Rewrite desktop's imports to the shared path;
move the desktop tree-ops tests to `tests/shared/`. Desktop behaviour is
unchanged and is protected by the CI typecheck gate (`apps/desktop` is in
`typecheck:ci`) plus its existing tests. iPad imports the same ops — no
duplication, no divergence.

### 2. iPad layout state — `useWorkspaceLayout` (new, `apps/ipad/src/state/`)
Holds a `Record<TabId, PersistedLayout>` — one workspace tree + `focusedLeafId`
per project-group tab — persisted to **Capacitor Preferences** (key e.g.
`watchtower.ipad.workspace`, debounced), mirroring how desktop persists to
SQLite settings but via the iPad's Preferences store. A tab with no saved
layout defaults to a single leaf holding that tab's active instance. Actions
(thin wrappers over the shared ops, scoped to the active tab): `splitLeaf`,
`unmountLeaf`, `setSizes`, `focusLeaf`, `replaceLeafTab`. No `window.watchtower`
(iPad uses the bridge/Preferences, not Electron IPC).

### 3. Terminal liveness — flat absolute-positioned pool (Approach B)
A `WorkspacePane` component renders, for the **active tab**, all its live
leaves' terminals as absolutely-positioned `<div>`s inside one stable,
`position:relative` container. Terminals are **never reparented** — each
terminal `<div>` keeps the same DOM parent for its whole life, so xterm is never
remounted and scroll/buffer state is preserved.

- A **pure function** `computePaneRects(root: WorkspaceNode, width, height, gap):
  Map<leafId, {x,y,w,h}>` walks the tree and returns each leaf's pixel rect
  (recursively subdividing by `split.dir` + `sizes`, minus divider gaps). This is
  the testable core.
- `WorkspacePane` measures its container (ResizeObserver), calls
  `computePaneRects`, and sets each terminal div's `left/top/width/height`. On a
  rect change, that pane's `FitAddon.fit()` + `bridge.invoke('ptyResize')` fire.
- **Resize dividers:** absolutely-positioned handles rendered between sibling
  panes at split boundaries; dragging (pointer/touch) updates that split's
  `sizes` via `setSizes`. (This is the only drag in the feature and it's a simple
  1-D divider drag, not dnd-kit.)
- **Non-active tabs:** their terminals are unmounted (disposed); on tab switch
  the newly-active tab's leaves attach via the existing cheap snapshot
  `attachTerminal`. (Keeping every tab's terminals alive is out of scope — YAGNI;
  snapshot re-attach is already how iPad works today.)
- Each leaf's terminal is the existing `TerminalView`, refactored so its host
  div can be positioned by `WorkspacePane` (extract the xterm/attach logic from
  the current self-contained `TerminalView` so it renders into a
  `WorkspacePane`-owned positioned div rather than a flex child).

### 4. Pane chrome + controls
Each leaf renders a thin header: **split-right**, **split-down**, **close**
buttons (inline-styled, glass). The focused leaf is visually ringed.
- **Split** → inserts a new empty leaf via `splitLeaf(dir, position)` and opens a
  **pane picker** (a small overlay listing the tab group's instances) to choose
  which instance fills it; picking calls `replaceLeafTab`. Choosing an instance
  already mounted in another pane is disallowed (guarded by `splitLeaf`/picker).
- **Close** → `unmountLeaf` (collapses single-child splits); closing the last
  leaf falls back to the tab's default single instance.
- **Keyboard (Magic Keyboard):** a keydown handler on the focused workspace —
  `⌘D` split-right, `⌘⇧D` split-down, `⌘W` close focused pane, `⌘⌥←/→/↑/↓` move
  focus to the adjacent pane (geometric neighbour via the computed rects).

### 5. Focus & pty sizing
Tapping/focusing a pane sets `focusedLeafId` and fires `terminalFocus` for that
instance. Each visible pane sizes its own instance's pty to its rect. Reuses the
#74 focus-owned ownership; no new transport work.

## Scope / build order (tasks for the plan)

1. Move `workspaceTreeOps` + pure helpers to `@watchtower/shared`; rewire desktop
   imports; move tests. (Desktop green + CI typecheck gate.)
2. `computePaneRects` pure function + unit tests (nested row/col, sizes, gaps,
   single leaf).
3. iPad `useWorkspaceLayout` (per-tab trees, Preferences persistence) + unit
   tests for the action/persist logic.
4. Refactor `TerminalView` so its xterm host can be externally positioned;
   `WorkspacePane` flat absolute-pool render for the active tab (multi-pane
   visible, each attached, each sized).
5. Resize dividers (1-D drag → `setSizes`).
6. Pane chrome (split/close buttons) + pane picker; wire split/close/replace.
7. Magic Keyboard shortcuts (split/close/focus).

## Testing

- **Pure/unit (real tests):** shared tree ops (moved tests), `computePaneRects`,
  `useWorkspaceLayout` action + persistence logic.
- **On-device (user-verified):** multi-pane render, attach without gaps, resize
  divider feel, split/close via buttons, keyboard shortcuts, focus ring, pty
  resize correctness. iPad live-plane needs the Mac orchestrator reachable over
  the WS transport (`npm run dev:ipad`), so these are manual on the iPad.

## Risks / constraints

- **Desktop regression risk** from moving `workspaceTreeOps` — mitigated by
  desktop's existing tests + the CI typecheck gate; the move is import-only.
- **Absolute-position layout math** must exactly tile the container (no gaps/
  overlap) across nested splits — hence `computePaneRects` is pure and
  thoroughly unit-tested before any rendering is built.
- **xterm in an absolutely-positioned, resized div** — FitAddon must run on every
  rect change; verify no cursor/resize glitches on device (two-attempt UI rule).
- **Verification is device-heavy** and iPad-live-plane (needs the Mac up); expect
  iterative on-device tuning with the user.

## Out of scope

- Drag-to-split (dnd-kit) — deliberately replaced by keyboard/buttons.
- Keeping every non-active tab's terminals alive simultaneously (snapshot
  re-attach on tab switch is retained).
- Porting desktop's `TerminalPool`/`SlotRegistry`/reparenting or
  `react-resizable-panels`.
- Any change to the transport, pty-sizing ownership (#74), or the Mac orchestrator.
