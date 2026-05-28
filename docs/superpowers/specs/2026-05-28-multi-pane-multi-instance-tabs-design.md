# Multi-pane / multi-instance tabs

**Date:** 2026-05-28
**Status:** Design, awaiting implementation plan.
**Scope:** Watchtower renderer + a small handful of new persisted settings. No DB
migration, no orchestrator changes, no new IPC kinds.

## Motivation

Today the Instances module is single-active: one instance is visible at a time
and the rest live behind hidden xterm buffers. Two real-world needs surface
repeatedly when working across multiple Claude sessions on the same or
different projects:

1. **See several instances at once.** When a project has multiple parallel
   sessions, the user wants them visible side-by-side (e.g. one session running
   the long task, another reading code, a third probing the database).
2. **See several projects at once.** Status checks and cross-project work both
   benefit from having two project views open simultaneously without
   alt-tabbing.

This design introduces two nested layouts that satisfy both — without changing
the orchestrator, the database schema, or the IPC contract.

## Concepts

- **Instance** — one Claude Code session (existing; unchanged). Has `id`,
  `cwd`, `status`, `display_order`, etc.
- **Tab** — a *project*. Tabs are **derived**, not stored: any instance whose
  `cwd` matches a project's `folderPath` belongs to that project's tab.
  Instances with no project match get an ad-hoc tab keyed by `cwd`. The
  Dashboard is also a tab (`__dashboard__`). A tab carries an ordered
  **list of instance IDs** (its columns, ordered by `instances.display_order`).
- **Workspace tree** — a recursive layout deciding *which tabs are visible
  right now and how their viewports are arranged*. Two node kinds:
  - **Leaf** — references one tab id.
  - **Split** — `dir: 'row' | 'col'`, `sizes: number[]`, `children:
    WorkspaceNode[]`. Splits nest recursively.
- **Focused leaf** + **focused column** — exactly one keyboard-focused
  instance globally. Drives the existing `focusChanged` IPC.

Asymmetry on purpose: the outer workspace is a rich recursive tree, while the
inner-tab layout is a flat ordered column list. This matches the user mental
model ("instances of one project are columns inside that project's tab") and
keeps the simpler inner shape simple.

## Goals / non-goals

**Goals**

- Show N tabs side-by-side (or nested) in a single window.
- Within a tab, show all of its instances as horizontal columns, left to
  right. New columns spawn immediately right of the focused column.
- Drag-resize separators (both column separators inside a tab and workspace
  separators between tabs).
- Drag a tab pill onto a leaf to split or replace; right-click context menu
  alternative.
- Persist the layout across app restarts.

**Non-goals (deferred)**

- Tear-off into a separate `BrowserWindow`. Single-window only for v1.
- Inner-tab recursive splits (vertical rows inside a tab). Flat columns only.
- Cross-pane search, status bar inside leaves, dragging columns between tabs.
- Layout templates / named workspaces.

## State model

All layout state lives in the renderer in memory, persisted to the existing
`settings` table via `setSetting`/`getSetting` (no new IPC kinds).

```ts
// Derived per-render from `instances`, `projects`, and an `openAdHocCwds` set.
// Not stored — this is a memoised projection.
type TabId =
  | `project:${number}`   // matches a project by id
  | `cwd:${string}`       // ad-hoc: instance whose cwd matches no project
  | `__dashboard__`;

interface TabRecord {
  id: TabId;
  label: string;                       // project.name | basename(cwd) | "Dashboard"
  color: string | null;                // project.color (or null for dashboard / ad-hoc)
  columnOrder: string[];               // instance IDs, left → right
  focusedInstanceId: string | null;    // which column inside this tab is "active"
}

type NodeId = string;  // ULID for stable React keys + drag targets
type WorkspaceNode =
  | { kind: 'leaf';  id: NodeId; tabId: TabId }
  | { kind: 'split'; id: NodeId; dir: 'row' | 'col';
      sizes: number[]; children: WorkspaceNode[] };

interface PersistedLayout {
  root: WorkspaceNode;
  focusedLeafId: NodeId | null;
  tabFocus: Record<TabId, string | null>;  // per-tab focused column id
  tabStripOrder: TabId[];                  // explicit order of pills in the strip
}
```

**Four new settings keys** (JSON-encoded values):

- `layout.workspaceTree` — `WorkspaceNode`
- `layout.focusedLeafId` — `NodeId | null`
- `layout.tabFocus` — `Record<TabId, string | null>`
- `layout.tabStripOrder` — `TabId[]`

**Source of truth for column order inside a tab**: the existing
`instances.display_order` column. The `reorderInstances` IPC keeps its
semantics — the dragged ID's new neighbours determine ordering within the
parent tab; cross-tab values are irrelevant (instances are filtered to their
tab before sort).

**Initial state on first launch** (no settings keys set): `root = { leaf,
tabId: __dashboard__ }`. Identical user experience to today's empty
workspace.

## UX & interactions

### Tab strip

- Iterates over derived `tabs[]` (one pill per project / ad-hoc / dashboard),
  not over instances.
- Order persisted in `layout.tabStripOrder`. Reorder by drag within the strip
  (extends existing `@dnd-kit` setup).
- Visual:
  - A tab **mounted somewhere** in the workspace tree gets the project-color
    underline (or hash-palette fallback for ad-hoc) — already the case today
    for the single active tab; now multiple tabs can be underlined.
  - The **focused leaf's** tab gets a stronger fill (subtle background tint).
  - Status dot follows the worst-first rule: if any instance in the tab is
    in `waiting-permission` → red; else `idle-notify` → grey; else
    `crashed` → red; else project color.

### Splitting (two gestures, one underlying op)

1. **Drag a tab pill onto a leaf's edge zone.** Each leaf on dragOver renders
   five drop zones (left, right, top, bottom, centre). Drop on a side → the
   leaf is wrapped in a `split` with the dropped tab as the new sibling, with
   `dir = 'row'` for left/right and `dir = 'col'` for top/bottom. Drop on
   centre → replace the leaf's `tabId`.
2. **Right-click a tab pill →** "Open here" / "Split right" / "Split down" /
   "Close in workspace". Same underlying ops, keyboard-friendlier.

### Clicking a tab in the strip (no drag)

- If already mounted → focus that leaf.
- If not mounted → replace focused leaf's `tabId` with this one. (Old tab's
  instances continue running off-screen.)
- Either way, the column the user lands in is determined by
  `tabFocus[tabId]` if that instance still exists, otherwise the leftmost
  column.

### Resizing

- `react-resizable-panels` handles drag bars natively.
- `sizes[]` on the parent `split` node updates on drag-end. Persist debounced
  (~500 ms).

### Spawning a new instance

Routing algorithm, applied to every spawn (whether from `+`, project-detail
"Open in Claude", dashboard sprint card, or `instances:findByCwd` follow-up):

1. Resolve `cwd → TabId`: project match by `folderPath` exact equality →
   `project:<id>`; otherwise ad-hoc `cwd:<absolute path>`.
2. If that tab is already mounted somewhere, insert the new column
   immediately right of that tab's `focusedInstanceId`, then focus the new
   column.
3. If not mounted, replace the focused leaf's `tabId` with this tab, then
   insert the column. (Does not auto-split; auto-splitting requires an
   explicit user gesture.)

### Closing

- **Close an instance column (×)**: removes the column. If it was the tab's
  last column, the tab disappears from the strip, any leaves pointing at it
  collapse — and if the parent split is now a single child, the split
  flattens to its sole child.
- **Close a leaf** (context menu "Close in workspace"): unmount the tab from
  the workspace tree but keep its instances alive. Tab stays in the strip.

### Focus model

- One **focused leaf** + (per tab) one **focused column** = exactly one
  keyboard-focused instance globally.
- That id is sent via the existing `focusChanged` IPC (no schema change —
  just changes *which* id we send).
- xterm's own focus handles the visual cursor; we just track
  `focusedLeafId` + `tabFocus[tabId]` on every terminal click.
- Notifications: instances in non-focused panes still fire — that is the
  correct behaviour. Only the single focused instance is suppressed.

## Architecture

### Component tree (renderer)

```
App
├─ TabStrip                    // iterates tabs[] (not instances[])
├─ WorkspaceRoot               // renders root WorkspaceNode
│   └─ WorkspaceNode (recursive)
│       ├─ SplitView           // PanelGroup from react-resizable-panels
│       │   └─ children: WorkspaceNode[]
│       └─ LeafView            // one mounted tab
│           ├─ LeafHeader      // small chip showing label + close-leaf button
│           └─ ColumnsRow      // horizontal PanelGroup
│               └─ ColumnSlot  // portal target for one Terminal
└─ TerminalPool (hidden)       // stable mount point for ALL <Terminal>s
```

### Keepalive strategy for xterm buffers (critical)

xterm buffers are expensive to recreate and must survive layout mutations
(splits, leaf replacements, tree pruning). Standard React reconciliation
would unmount any `<Terminal>` whose ancestor moves — losing its buffer.

**Solution**: each `<Terminal>` is mounted **once** at a stable position
inside `TerminalPool` (a hidden, `display:none` container at the App root).
The visible `ColumnSlot` is just a `<div>` portal target; the Terminal's
xterm-host element renders into it via `ReactDOM.createPortal`. When the
column or leaf unmounts, the portal target disappears and the xterm node
returns to the pool — the xterm instance and its scrollback are preserved.

A `ResizeObserver` inside `Terminal` re-runs xterm's `fit()` whenever the
portal target's size changes (extends the existing fit logic; new
ResizeObserver target = whatever portal it's currently rendered into).

### Tab derivation

Pure client-side function `useTabs(instances, projects, openAdHocCwds)`
re-runs on every change to its inputs:

```ts
function deriveTabs(
  instances: InstanceView[],
  projects: ProjectViewPayload[],
  openAdHocCwds: Set<string>,
): TabRecord[];
```

Returns the strip's list. Ad-hoc tabs are kept open even after their last
instance closes only if they're explicitly in `openAdHocCwds` (user opened
that cwd through the `+` modal without a project match) — otherwise they
vanish.

### Layout state hook

`useWorkspaceLayout()`:

- Hydrates from the four `layout.*` settings on mount. JSON-decodes; on
  schema mismatch or parse error → falls back to `{ leaf,
  tabId: __dashboard__ }`.
- Exposes pure-reducer mutation actions:
  `mountTab`, `replaceLeafTab`, `splitLeaf`, `unmountLeaf`, `setSizes`,
  `focusLeaf`, `focusColumnInTab`, `reorderTabStrip`.
- After every mutation, debounced (~500 ms) write of all four keys via
  `setSetting`.
- **`pruneLayout(root, validTabIds)`** runs once on load: removes leaves
  whose `tabId` no longer exists; flattens any single-child splits; if the
  tree empties, resets to the dashboard fallback.

### Orchestrator side: zero changes

- `focusChanged` still receives a single instance id; client decides which
  one.
- `display_order` keeps its meaning (column order within a tab; cross-tab
  values are unsorted).
- `spawnInstance`, `reorderInstances`, `snooze`, `remove` etc. are all
  untouched.

### Library

`react-resizable-panels` (~25 kB gzipped, MIT, actively maintained). Handles
nested horizontal/vertical resizable panels with a controlled-`sizes` mode
suitable for persistence.

## Edge cases (resolved rules)

| Case | Rule |
|---|---|
| Drag tab onto its own leaf, centre | No-op |
| Drag tab onto a leaf showing a different tab, centre | Replace leaf's `tabId` |
| Drag tab onto a leaf, edge zone | Wrap leaf in a split; drop tab as new sibling |
| Last instance in a tab closes (×) | Tab vanishes from strip; leaves pointing at it collapse |
| Split with one child after collapse | Flatten — replace split with sole child |
| Tree empty after pruning | Reset to `{ leaf: __dashboard__ }` — dashboard is always-available fallback |
| Project deleted while mounted | Silently convert leaf's tabId to `cwd:<folderPath>`; instances survive |
| Project's `folderPath` changes | Tabs re-derive on next `projects:list` refresh; instances shift accordingly |
| Persisted layout references a missing `tabId` on load | Prune that leaf (then flatten splits as needed) |
| First launch after upgrade (no `layout.*` keys) | Default to `{ leaf: __dashboard__ }`; existing instances surface in their tabs the moment the user clicks a tab pill |
| Dashboard "closed" from context menu | Allowed — only unmounts dashboard from the workspace; pill stays in strip |
| Spawn for a project whose tab isn't mounted | Replace focused leaf with that tab; do not auto-split |
| User drags the *only* leaf onto itself | No-op |
| `focusedLeafId` points at a leaf that gets unmounted | After the tree mutation, focus moves to the leftmost remaining leaf in pre-order traversal; if the tree is now empty, focus moves to the new dashboard leaf |

## Testing plan

- **Pure functions** (no DOM):
  - `deriveTabs(instances, projects, adHocSet)` — empty / one / mixed /
    project-deleted / archived / ad-hoc / dashboard cases.
  - Layout reducer ops, one test per op (`mountTab`, `replaceLeafTab`,
    `splitLeaf` × 4 directions, `unmountLeaf`, `setSizes`, `focusLeaf`,
    `focusColumnInTab`, `reorderTabStrip`).
  - `pruneLayout(root, validTabIds)` — orphan removal + flattening of
    single-child splits + empty-tree reset.
  - `routeSpawnedInstanceCwdToTab(cwd, projects)` — project match,
    ad-hoc match, exact-equality semantics.
- **Component tests** (vitest + `@testing-library/react`):
  - `TabStrip` renders one pill per derived tab; mounted tabs get the
    underline; focused tab gets the stronger fill; status dot uses the
    worst-first rule.
  - `WorkspaceRoot` renders nested `PanelGroups` for a depth-2 split tree
    and a flat-leaf tree.
  - `ColumnSlot` portal: Terminal rendered into a slot, then slot removed,
    then re-mounted in a different slot — `<Terminal>` mount count stays
    at 1.
- **Integration**:
  - Spawn a new instance whose cwd matches a project → assert tab
    derivation includes a new column at the right of the focused column.
  - Drag a tab from the strip onto a leaf's right zone → assert tree
    became a `row` split with both leaves.
- **Persistence round-trip**: produce a non-trivial tree via reducer ops,
  serialise to JSON, hydrate a fresh hook from that JSON, assert deep
  equality with the original.
- **Migration smoke**: simulate "existing app with N instances, no layout
  key" → assert default-leaf-dashboard root + tabs derived correctly when
  instances list arrives.

## Open follow-ups (not in v1)

- `projects:updated` IPC push so the App-level `useProjects` refresh
  picks up color/folderPath changes made elsewhere without a reload.
- Tear-off into a separate `BrowserWindow`.
- Inner-tab recursive splits (rows within a tab).
- Search across all visible panes.
- Named workspaces / layout templates.
