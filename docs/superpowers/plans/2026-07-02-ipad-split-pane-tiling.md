# iPad Split-Pane Tiling Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the desktop split-pane tiling workspace to the iPad — 2+ terminals visible at once per project-group tab, split/close/resize/focus via touch, on-screen chrome, and Magic Keyboard shortcuts — reusing the desktop workspace-tree machinery.

**Architecture:** The pure tree-mutation ops (`workspaceTreeOps`) move from `apps/desktop` into `@watchtower/shared` and are made generic over the leaf-identity type (default `TabId`, so desktop is untouched; iPad instantiates with `string` = instanceId). A new pure `computePaneRects` walks a tree into pixel rects. iPad holds a `Record<tabKey, TabLayout>` (one tree + focus per project-group tab) persisted to Capacitor Preferences via a pure model + thin hook. A `WorkspacePane` renders every live leaf of the **active tab** as an absolutely-positioned, never-reparented xterm host; each host runs the existing snapshot-attach + `ResizeObserver`→fit→`ptyResize` effect, so xterm is never remounted.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React 18 (plain, **no MUI**, inline styles), `@xterm/xterm` v5.5 + `@xterm/addon-fit` v0.10, `@capacitor/preferences` v6, Vitest (node env), npm workspaces.

## Global Constraints

- **Working tree:** all work happens in the worktree `/Users/jan/Projects/Watchtower/.claude/worktrees/iphone-76`, branch `feat/83-ipad-tiling` (spec is at HEAD). Never touch the shared main tree.
- **No MUI in `apps/ipad`** — plain React + inline styles only. (`ipad-app-no-mui` convention.)
- **No i18n.** Any user-facing copy is Czech; but this feature has almost no copy (icon buttons + an instance picker listing instance labels).
- **ESM import specifiers end in `.js`** even for `.ts` sources (project convention; the TS/Vite path alias `@watchtower/shared/*` → `packages/shared/src/*` resolves them).
- **Never reparent a terminal `<div>`** — each xterm host keeps one DOM parent for its whole life (preserves scrollback/buffer). Non-active tabs' terminals are disposed, not hidden.
- **Same instance may not occupy two panes** in one tab — enforced by `splitLeaf`'s existing dedup guard and the pane picker.
- **Test discovery:** single root `vitest.config.ts`, glob `tests/**/*.test.ts`. Shared tests → `tests/shared/…`; iPad tests → `tests/ipad/…`. No per-workspace vitest config exists or is needed.
- **Verification commands (run from the worktree root):**
  - Full suite: `npm test` — baseline **913 passing, 127 files**. Must never regress.
  - Typecheck all workspaces: `npm run typecheck:ci` (builds `packages/shared` + checks shared/transport/electron/orch/desktop/ipad).
  - Targeted test: `npx vitest run <path>`.
- **Commit discipline:** `git add <specific paths>` only. The main tree carries unrelated untracked WIP; never `git add -A`.
- **On-device verification** (Tasks 5–10) needs the Mac orchestrator reachable over the WS transport: run the desktop with `npm run dev:ipad` (binds LAN/Tailscale). The worktree has **no `apps/ipad/.env`** — git-ignored env is not copied into worktrees; copy it in before any iPad build or the app boots with an empty `VITE_SUPABASE_ANON_KEY` and crashes. Unit tests (Tasks 1–4, and the pure helpers in 8–10) need none of this.
- **UI two-attempt rule:** stop after two failed attempts at any animation/layout/resize behavior; write up what was tried + a reference before a third.

---

## File Structure

**Moved (Task 1):**
- `packages/shared/src/workspaceTreeOps.ts` — pure tree ops (was `apps/desktop/src/layout/workspaceTreeOps.ts`).
- `packages/shared/src/newNodeId.ts` — id generator (was `apps/desktop/src/layout/newNodeId.ts`).
- `tests/shared/workspaceTreeOps.test.ts` — moved tree-ops tests (was `tests/client/layout/workspaceTreeOps.test.ts`).

**Created:**
- `packages/shared/src/computePaneRects.ts` — pure tree→rects (Task 3).
- `tests/shared/computePaneRects.test.ts` (Task 3).
- `apps/ipad/src/state/workspaceLayoutModel.ts` — pure per-tab layout model + (de)serialize (Task 4).
- `tests/ipad/workspaceLayoutModel.test.ts` (Task 4).
- `apps/ipad/src/state/useWorkspaceLayout.ts` — thin React hook: state + Preferences persistence (Task 5).
- `apps/ipad/src/lib/useXtermSession.ts` — extracted xterm/attach effect hook (Task 6).
- `apps/ipad/src/components/PaneTerminal.tsx` — absolutely-positioned single-pane terminal + chrome (Tasks 6/7/9).
- `apps/ipad/src/components/WorkspacePane.tsx` — flat absolute-positioned pool for the active tab (Task 7).
- `apps/ipad/src/lib/paneResize.ts` — pure `sizesAfterDrag` (Task 8).
- `tests/ipad/paneResize.test.ts` (Task 8).
- `apps/ipad/src/components/PanePicker.tsx` — instance picker overlay (Task 9).
- `apps/ipad/src/lib/panePicker.ts` — pure `availableInstancesForPicker` (Task 9).
- `tests/ipad/panePicker.test.ts` (Task 9).
- `apps/ipad/src/lib/paneNav.ts` — pure `adjacentLeaf` geometric neighbour (Task 10).
- `tests/ipad/paneNav.test.ts` (Task 10).

**Modified:**
- 6 desktop files' import paths (Task 1): `apps/desktop/src/App.tsx`, `state/useWorkspaceLayout.ts`, `state/spawnIntoTab.ts`, `state/useFocusedInstance.ts`, `layout/hiddenPaneCollapse.ts`, `layout/pruneLayout.ts`.
- 2 desktop test files' import paths (Task 1): `tests/client/layout/hiddenPaneCollapse.test.ts`, `tests/client/layout/pruneLayout.test.ts`.
- `packages/shared/src/layout.ts` (Task 2): generic tree types.
- `packages/shared/src/workspaceTreeOps.ts` (Task 2): generic ops.
- `apps/ipad/src/components/TerminalView.tsx` (Task 6): use the extracted hook.
- `apps/ipad/src/App.tsx` (Task 7): render `WorkspacePane` for the active tab instead of a single `TerminalView`.

---

## Task 1: Move `workspaceTreeOps` + `newNodeId` to `@watchtower/shared` (import-only)

Pure relocation — no behavior or type change. Proves desktop is unaffected before anything else builds on the moved code.

**Files:**
- Create: `packages/shared/src/workspaceTreeOps.ts` (move), `packages/shared/src/newNodeId.ts` (move)
- Delete: `apps/desktop/src/layout/workspaceTreeOps.ts`, `apps/desktop/src/layout/newNodeId.ts`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/state/useWorkspaceLayout.ts`, `apps/desktop/src/state/spawnIntoTab.ts`, `apps/desktop/src/state/useFocusedInstance.ts`, `apps/desktop/src/layout/hiddenPaneCollapse.ts`, `apps/desktop/src/layout/pruneLayout.ts`
- Move test: `tests/client/layout/workspaceTreeOps.test.ts` → `tests/shared/workspaceTreeOps.test.ts`
- Modify test: `tests/client/layout/hiddenPaneCollapse.test.ts`, `tests/client/layout/pruneLayout.test.ts`

**Interfaces:**
- Produces (unchanged signatures, new location): `leaf`, `split`, `findLeafById`, `findLeafByTabId`, `firstLeafInPreOrder`, `collectTabIds`, `replaceLeafTab`, `splitLeaf`, `unmountLeaf`, `setSizes`, `type SplitPosition` from `@watchtower/shared/workspaceTreeOps.js`; `newNodeId(): string` from `@watchtower/shared/newNodeId.js`.

- [ ] **Step 1: Move the two files unchanged, fixing only the type import**

`git mv apps/desktop/src/layout/newNodeId.ts packages/shared/src/newNodeId.ts` (contents unchanged — it has no imports).

`git mv apps/desktop/src/layout/workspaceTreeOps.ts packages/shared/src/workspaceTreeOps.ts`, then change its top import block from:

```typescript
import type {
  NodeId,
  TabId,
  WorkspaceLeaf,
  WorkspaceNode,
  WorkspaceSplit,
} from '@watchtower/shared/layout.js';
import { newNodeId } from './newNodeId.js';
```

to (now that it lives in `packages/shared/src`, the type module is a sibling):

```typescript
import type {
  NodeId,
  TabId,
  WorkspaceLeaf,
  WorkspaceNode,
  WorkspaceSplit,
} from './layout.js';
import { newNodeId } from './newNodeId.js';
```

- [ ] **Step 2: Rewire the 6 desktop source importers**

Replace each import specifier (leave the imported names exactly as they are):

| File | From | To |
|---|---|---|
| `apps/desktop/src/App.tsx` | `'./layout/workspaceTreeOps.js'` | `'@watchtower/shared/workspaceTreeOps.js'` |
| `apps/desktop/src/state/useWorkspaceLayout.ts` | `'../layout/workspaceTreeOps.js'` | `'@watchtower/shared/workspaceTreeOps.js'` |
| `apps/desktop/src/state/useWorkspaceLayout.ts` | `'../layout/newNodeId.js'` | `'@watchtower/shared/newNodeId.js'` |
| `apps/desktop/src/state/spawnIntoTab.ts` | `'../layout/workspaceTreeOps.js'` | `'@watchtower/shared/workspaceTreeOps.js'` |
| `apps/desktop/src/state/useFocusedInstance.ts` | `'../layout/workspaceTreeOps.js'` | `'@watchtower/shared/workspaceTreeOps.js'` |
| `apps/desktop/src/layout/hiddenPaneCollapse.ts` | `'./workspaceTreeOps.js'` | `'@watchtower/shared/workspaceTreeOps.js'` |
| `apps/desktop/src/layout/pruneLayout.ts` | `'./workspaceTreeOps.js'` | `'@watchtower/shared/workspaceTreeOps.js'` |
| `apps/desktop/src/layout/pruneLayout.ts` | `'./newNodeId.js'` | `'@watchtower/shared/newNodeId.js'` |

(Verify no other importers exist: `grep -rn "layout/workspaceTreeOps\|layout/newNodeId" apps/desktop/src` must return nothing after edits.)

- [ ] **Step 3: Move the tree-ops test to `tests/shared` and repoint its import**

`git mv tests/client/layout/workspaceTreeOps.test.ts tests/shared/workspaceTreeOps.test.ts`. Change its ops import from `'../../../apps/desktop/src/layout/workspaceTreeOps.js'` to `'@watchtower/shared/workspaceTreeOps.js'`. Leave the `import type { WorkspaceNode } from '@watchtower/shared/layout.js'` line unchanged.

- [ ] **Step 4: Repoint the 2 desktop tests that borrow `leaf`/`split`**

In both `tests/client/layout/hiddenPaneCollapse.test.ts` and `tests/client/layout/pruneLayout.test.ts`, change `import { leaf, split } from '../../../apps/desktop/src/layout/workspaceTreeOps.js';` to `import { leaf, split } from '@watchtower/shared/workspaceTreeOps.js';`. (These test files stay in `tests/client` — they test desktop modules that remain in desktop.)

- [ ] **Step 5: Run the full suite — expect no change in count**

Run: `npm test`
Expected: PASS, **913 tests / 127 files** (the moved file keeps the count identical).

- [ ] **Step 6: Typecheck all workspaces**

Run: `npm run typecheck:ci`
Expected: exits 0 (shared rebuilds `dist/`; desktop resolves the moved module via its `@watchtower/shared/*` path alias).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/workspaceTreeOps.ts packages/shared/src/newNodeId.ts \
  apps/desktop/src/App.tsx apps/desktop/src/state/useWorkspaceLayout.ts \
  apps/desktop/src/state/spawnIntoTab.ts apps/desktop/src/state/useFocusedInstance.ts \
  apps/desktop/src/layout/hiddenPaneCollapse.ts apps/desktop/src/layout/pruneLayout.ts \
  apps/desktop/src/layout/workspaceTreeOps.ts apps/desktop/src/layout/newNodeId.ts \
  tests/shared/workspaceTreeOps.test.ts tests/client/layout/workspaceTreeOps.test.ts \
  tests/client/layout/hiddenPaneCollapse.test.ts tests/client/layout/pruneLayout.test.ts
git commit -m "refactor(shared): move workspaceTreeOps + newNodeId into @watchtower/shared (#83)"
```

---

## Task 2: Genericize the shared tree types + ops over leaf-identity type

The iPad's leaves hold **instanceIds** (`string`), not desktop `TabId`s. Make `WorkspaceLeaf`/`WorkspaceSplit`/`WorkspaceNode` and every op generic over `TLeaf`, defaulting to `TabId`. Desktop is fully transparent: bare `WorkspaceNode` resolves to `WorkspaceNode<TabId>`, and every desktop `leaf()`/`splitLeaf()` call already passes `TabId`-typed args (e.g. `DASHBOARD_TAB_ID as TabId`), so `TLeaf` infers to `TabId` with no call-site edits.

**Files:**
- Modify: `packages/shared/src/layout.ts`, `packages/shared/src/workspaceTreeOps.ts`

**Interfaces:**
- Produces: `WorkspaceLeaf<TLeaf = TabId>`, `WorkspaceSplit<TLeaf = TabId>`, `WorkspaceNode<TLeaf = TabId>`; ops become `<TLeaf = TabId>` generic. `PersistedLayout` stays non-generic (its `root: WorkspaceNode` = `WorkspaceNode<TabId>` via the default).

- [ ] **Step 1: Genericize the three tree types in `layout.ts`**

Replace the existing `WorkspaceLeaf`, `WorkspaceSplit`, `WorkspaceNode` definitions with:

```typescript
export interface WorkspaceLeaf<TLeaf = TabId> {
  kind: 'leaf';
  id: NodeId;
  tabId: TLeaf;
}

export interface WorkspaceSplit<TLeaf = TabId> {
  kind: 'split';
  id: NodeId;
  dir: 'row' | 'col';
  sizes: number[]; // percent, must sum to ~100
  children: WorkspaceNode<TLeaf>[];
}

export type WorkspaceNode<TLeaf = TabId> = WorkspaceLeaf<TLeaf> | WorkspaceSplit<TLeaf>;
```

Leave `PersistedLayout`, `TabId`, `NodeId`, `SETTINGS_KEYS`, `TabRecord`, etc. exactly as they are.

- [ ] **Step 2: Genericize every op in `workspaceTreeOps.ts`**

Add `<TLeaf = TabId>` to each exported and internal function, threading `TLeaf` through node/leaf params and returns. The signatures become:

```typescript
export function leaf<TLeaf = TabId>(id: NodeId, tabId: TLeaf): WorkspaceLeaf<TLeaf>
export function split<TLeaf = TabId>(id: NodeId, dir: 'row' | 'col', children: WorkspaceNode<TLeaf>[], sizes?: number[]): WorkspaceSplit<TLeaf>
export function findLeafById<TLeaf = TabId>(node: WorkspaceNode<TLeaf>, id: NodeId): WorkspaceLeaf<TLeaf> | null
export function findLeafByTabId<TLeaf = TabId>(node: WorkspaceNode<TLeaf>, tabId: TLeaf): WorkspaceLeaf<TLeaf> | null
export function firstLeafInPreOrder<TLeaf = TabId>(node: WorkspaceNode<TLeaf>): WorkspaceLeaf<TLeaf> | null
export function collectTabIds<TLeaf = TabId>(node: WorkspaceNode<TLeaf>): TLeaf[]
export function replaceLeafTab<TLeaf = TabId>(node: WorkspaceNode<TLeaf>, leafId: NodeId, newTabId: TLeaf): WorkspaceNode<TLeaf>
export function splitLeaf<TLeaf = TabId>(node: WorkspaceNode<TLeaf>, targetLeafId: NodeId, dir: 'row' | 'col', position: SplitPosition, newTabId: TLeaf): WorkspaceNode<TLeaf>
export function unmountLeaf<TLeaf = TabId>(node: WorkspaceNode<TLeaf>, leafId: NodeId): WorkspaceNode<TLeaf> | null
export function setSizes<TLeaf = TabId>(node: WorkspaceNode<TLeaf>, splitId: NodeId, sizes: number[]): WorkspaceNode<TLeaf>
```

Also genericize the internal helpers `containsTabId<TLeaf>(node: WorkspaceNode<TLeaf>, tabId: TLeaf): boolean` and `splitLeafInner<TLeaf>(...)`; `evenSizes(n: number): number[]` stays non-generic. The bodies are unchanged (they only compare `leaf.tabId === tabId` and rebuild nodes) — just the type annotations change.

- [ ] **Step 3: Typecheck — desktop must be transparently unaffected**

Run: `npm run typecheck:ci`
Expected: exits 0 with **no desktop call-site edits**. If (and only if) `tsc` reports a literal-narrowing error at a desktop `leaf(...)`/`split(...)` call, fix it by annotating that call `leaf<TabId>(...)` — runtime is unchanged. (Not expected: all current call sites pass `... as TabId`.)

- [ ] **Step 4: Run the moved tree-ops tests (still typed to the default `TabId`)**

Run: `npx vitest run tests/shared/workspaceTreeOps.test.ts`
Expected: PASS, all 13 tests (the test file uses bare `WorkspaceNode` = `WorkspaceNode<TabId>`).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS, 913 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/layout.ts packages/shared/src/workspaceTreeOps.ts
git commit -m "refactor(shared): make workspace tree ops generic over leaf identity (#83)"
```

---

## Task 3: `computePaneRects` — pure tree→pixel-rects (shared)

The testable geometry core. Walks a `WorkspaceNode<TLeaf>` and returns each leaf's pixel rect, exactly tiling `[0,0,width,height]` with `gap` px reserved between siblings for divider handles.

**Files:**
- Create: `packages/shared/src/computePaneRects.ts`
- Test: `tests/shared/computePaneRects.test.ts`

**Interfaces:**
- Consumes: `WorkspaceNode<TLeaf>`, `NodeId` from `@watchtower/shared/layout.js`.
- Produces: `interface Rect { x: number; y: number; w: number; h: number }`; `computePaneRects<TLeaf>(root, width, height, gap): Map<NodeId, Rect>` from `@watchtower/shared/computePaneRects.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/computePaneRects.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computePaneRects } from '@watchtower/shared/computePaneRects.js';
import { leaf, split } from '@watchtower/shared/workspaceTreeOps.js';
import type { WorkspaceNode } from '@watchtower/shared/layout.js';

const L = (id: string, v: string): WorkspaceNode<string> => leaf<string>(id, v);

describe('computePaneRects', () => {
  it('single leaf fills the whole box', () => {
    const rects = computePaneRects(L('a', 'i1'), 1000, 800, 6);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });

  it('row split 50/50 subtracts one gap and halves the remainder', () => {
    const root = split<string>('s', 'row', [L('a', 'i1'), L('b', 'i2')], [50, 50]);
    const rects = computePaneRects(root, 1006, 800, 6);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 500, h: 800 });
    expect(rects.get('b')).toEqual({ x: 506, y: 0, w: 500, h: 800 });
  });

  it('col split stacks vertically with a gap', () => {
    const root = split<string>('s', 'col', [L('a', 'i1'), L('b', 'i2')], [25, 75]);
    const rects = computePaneRects(root, 400, 806, 6);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 400, h: 200 });
    expect(rects.get('b')).toEqual({ x: 0, y: 206, w: 400, h: 600 });
  });

  it('nested split tiles without gaps or overlap', () => {
    const inner = split<string>('s2', 'col', [L('b', 'i2'), L('c', 'i3')], [50, 50]);
    const root = split<string>('s1', 'row', [L('a', 'i1'), inner], [50, 50]);
    const rects = computePaneRects(root, 206, 206, 6);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 206 });
    expect(rects.get('b')).toEqual({ x: 106, y: 0, w: 100, h: 100 });
    expect(rects.get('c')).toEqual({ x: 106, y: 106, w: 100, h: 100 });
  });

  it('normalizes sizes that do not sum to 100', () => {
    const root = split<string>('s', 'row', [L('a', 'i1'), L('b', 'i2')], [1, 3]);
    const rects = computePaneRects(root, 400, 100, 0);
    expect(rects.get('a')!.w).toBeCloseTo(100);
    expect(rects.get('b')!.w).toBeCloseTo(300);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run tests/shared/computePaneRects.test.ts`
Expected: FAIL — cannot resolve `@watchtower/shared/computePaneRects.js`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/computePaneRects.ts`:

```typescript
import type { NodeId, WorkspaceNode } from './layout.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Walk the workspace tree and assign each leaf a pixel rect that exactly tiles
 * the [0,0,width,height] box. `gap` px is reserved between sibling panes for
 * divider handles (n children -> (n-1) gaps along the split axis).
 */
export function computePaneRects<TLeaf>(
  root: WorkspaceNode<TLeaf>,
  width: number,
  height: number,
  gap: number,
): Map<NodeId, Rect> {
  const out = new Map<NodeId, Rect>();
  walk(root, 0, 0, width, height, gap, out);
  return out;
}

function walk<TLeaf>(
  node: WorkspaceNode<TLeaf>,
  x: number,
  y: number,
  w: number,
  h: number,
  gap: number,
  out: Map<NodeId, Rect>,
): void {
  if (node.kind === 'leaf') {
    out.set(node.id, { x, y, w, h });
    return;
  }
  const n = node.children.length;
  const totalGap = gap * Math.max(0, n - 1);
  const sum = node.sizes.reduce((a, b) => a + b, 0) || 1;
  if (node.dir === 'row') {
    const avail = w - totalGap;
    let cx = x;
    node.children.forEach((child, i) => {
      const cw = (node.sizes[i] / sum) * avail;
      walk(child, cx, y, cw, h, gap, out);
      cx += cw + gap;
    });
  } else {
    const avail = h - totalGap;
    let cy = y;
    node.children.forEach((child, i) => {
      const ch = (node.sizes[i] / sum) * avail;
      walk(child, x, cy, w, ch, gap, out);
      cy += ch + gap;
    });
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run tests/shared/computePaneRects.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck + full suite + commit**

Run: `npm run typecheck:ci && npm test` → PASS (918 tests: 913 + 5).

```bash
git add packages/shared/src/computePaneRects.ts tests/shared/computePaneRects.test.ts
git commit -m "feat(shared): computePaneRects tree->pixel-rects tiler (#83)"
```

---

## Task 4: iPad `workspaceLayoutModel` — pure per-tab layout + (de)serialize

Pure functions over the iPad's `Record<tabKey, TabLayout>` state, wrapping the shared ops with `TLeaf = string` (instanceId). No React, no Preferences here — this is the tested core the hook (Task 5) drives.

**Files:**
- Create: `apps/ipad/src/state/workspaceLayoutModel.ts`
- Test: `tests/ipad/workspaceLayoutModel.test.ts`

**Interfaces:**
- Consumes: shared ops + `newNodeId` + `WorkspaceNode<string>`/`NodeId`.
- Produces:
  - `type PaneTree = WorkspaceNode<string>` (leaf `tabId` holds an instanceId)
  - `interface TabLayout { root: PaneTree; focusedLeafId: NodeId | null }`
  - `type WorkspaceState = Record<string, TabLayout>` (key = project-group tab key)
  - `defaultTabLayout(instanceId: string): TabLayout`
  - `splitPane(layout, targetLeafId, dir, position, instanceId): TabLayout`
  - `closePane(layout, leafId, fallbackInstanceId): TabLayout`
  - `resizeSplitSizes(layout, splitId, sizes): TabLayout`
  - `replacePane(layout, leafId, instanceId): TabLayout`
  - `focusPane(layout, leafId): TabLayout`
  - `mountedInstanceIds(layout): string[]`
  - `serializeWorkspace(state): string` / `deserializeWorkspace(raw: string | null): WorkspaceState`

- [ ] **Step 1: Read the shared `splitLeaf` dedup behavior**

Read `packages/shared/src/workspaceTreeOps.ts` `splitLeaf`/`containsTabId` to confirm the refusal semantics: when `newTabId` is already mounted anywhere in the tree, `splitLeaf` returns the **original node reference unchanged** (it does not throw). The model relies on this: `splitPane` returns the layout unchanged when the instance is already mounted.

- [ ] **Step 2: Write the failing test**

Create `tests/ipad/workspaceLayoutModel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  defaultTabLayout, splitPane, closePane, resizeSplitSizes, replacePane,
  focusPane, mountedInstanceIds, serializeWorkspace, deserializeWorkspace,
  type TabLayout,
} from '../../apps/ipad/src/state/workspaceLayoutModel.js';

function twoPane(): TabLayout {
  const base = defaultTabLayout('i1');
  return splitPane(base, rootLeafId(base), 'row', 'after', 'i2');
}
function rootLeafId(l: TabLayout): string {
  if (l.root.kind !== 'leaf') throw new Error('expected leaf root');
  return l.root.id;
}

describe('workspaceLayoutModel', () => {
  it('defaultTabLayout is a single focused leaf holding the instance', () => {
    const l = defaultTabLayout('i1');
    expect(l.root.kind).toBe('leaf');
    expect(mountedInstanceIds(l)).toEqual(['i1']);
    expect(l.focusedLeafId).toBe(rootLeafId(l));
  });

  it('splitPane adds a second pane holding the new instance', () => {
    const base = defaultTabLayout('i1');
    const l = splitPane(base, rootLeafId(base), 'row', 'after', 'i2');
    expect(l.root.kind).toBe('split');
    expect(mountedInstanceIds(l).sort()).toEqual(['i1', 'i2']);
  });

  it('splitPane refuses to mount an instance already in the tab', () => {
    const base = defaultTabLayout('i1');
    const l = splitPane(base, rootLeafId(base), 'row', 'after', 'i1');
    expect(l.root).toBe(base.root); // unchanged
  });

  it('closePane collapses back to the surviving pane', () => {
    const base = defaultTabLayout('i1');
    const two = splitPane(base, rootLeafId(base), 'row', 'after', 'i2');
    const survivorLeafId = two.root.kind === 'split' && two.root.children[0].kind === 'leaf'
      ? two.root.children[0].id : '';
    const closed = closePane(two, otherLeafId(two, survivorLeafId), 'i1');
    expect(closed.root.kind).toBe('leaf');
    expect(mountedInstanceIds(closed)).toEqual(['i1']);
  });

  it('closing the last pane falls back to a default single leaf', () => {
    const base = defaultTabLayout('i1');
    const closed = closePane(base, rootLeafId(base), 'i9');
    expect(closed.root.kind).toBe('leaf');
    expect(mountedInstanceIds(closed)).toEqual(['i9']);
  });

  it('closePane moves focus off a closed focused pane', () => {
    const base = defaultTabLayout('i1');
    const two = splitPane(base, rootLeafId(base), 'row', 'after', 'i2');
    const firstId = (two.root.kind === 'split' && two.root.children[0].kind === 'leaf') ? two.root.children[0].id : '';
    const focused = focusPane(two, firstId);
    const closed = closePane(focused, firstId, 'i1');
    expect(closed.focusedLeafId).not.toBe(firstId);
    expect(closed.focusedLeafId).not.toBeNull();
  });

  it('replacePane swaps the instance in a leaf', () => {
    const base = defaultTabLayout('i1');
    const l = replacePane(base, rootLeafId(base), 'i5');
    expect(mountedInstanceIds(l)).toEqual(['i5']);
  });

  it('resizeSplitSizes updates the split sizes', () => {
    const base = defaultTabLayout('i1');
    const two = splitPane(base, rootLeafId(base), 'row', 'after', 'i2');
    const splitId = two.root.id;
    const l = resizeSplitSizes(two, splitId, [70, 30]);
    expect(l.root.kind === 'split' && l.root.sizes).toEqual([70, 30]);
  });

  it('serialize/deserialize round-trips the whole state', () => {
    const state = { 'project:1': twoPane(), other: defaultTabLayout('i9') };
    const back = deserializeWorkspace(serializeWorkspace(state));
    expect(back).toEqual(state);
  });

  it('deserializeWorkspace returns {} on null or garbage', () => {
    expect(deserializeWorkspace(null)).toEqual({});
    expect(deserializeWorkspace('not json')).toEqual({});
  });
});

function otherLeafId(l: TabLayout, notThis: string): string {
  const ids: string[] = [];
  const walk = (n: any) => n.kind === 'leaf' ? ids.push(n.id) : n.children.forEach(walk);
  walk(l.root);
  return ids.find((id) => id !== notThis) ?? notThis;
}
```

- [ ] **Step 3: Run it — expect failure** (module missing).

Run: `npx vitest run tests/ipad/workspaceLayoutModel.test.ts` → FAIL.

- [ ] **Step 4: Implement**

Create `apps/ipad/src/state/workspaceLayoutModel.ts`:

```typescript
import type { NodeId, WorkspaceNode } from '@watchtower/shared/layout.js';
import {
  leaf, splitLeaf, unmountLeaf, setSizes, replaceLeafTab,
  firstLeafInPreOrder, findLeafById, collectTabIds,
  type SplitPosition,
} from '@watchtower/shared/workspaceTreeOps.js';
import { newNodeId } from '@watchtower/shared/newNodeId.js';

/** A pane tree whose leaf identities are instanceIds. */
export type PaneTree = WorkspaceNode<string>;

export interface TabLayout {
  root: PaneTree;
  focusedLeafId: NodeId | null;
}

/** Keyed by project-group tab key (see App.tsx tabKey()). */
export type WorkspaceState = Record<string, TabLayout>;

export function defaultTabLayout(instanceId: string): TabLayout {
  const root = leaf<string>(newNodeId(), instanceId);
  return { root, focusedLeafId: root.id };
}

export function splitPane(
  layout: TabLayout,
  targetLeafId: NodeId,
  dir: 'row' | 'col',
  position: SplitPosition,
  instanceId: string,
): TabLayout {
  const root = splitLeaf<string>(layout.root, targetLeafId, dir, position, instanceId);
  if (root === layout.root) return layout; // refused (already mounted)
  const added = collectNewLeafFor(root, instanceId);
  return { root, focusedLeafId: added ?? layout.focusedLeafId };
}

export function closePane(layout: TabLayout, leafId: NodeId, fallbackInstanceId: string): TabLayout {
  const root = unmountLeaf<string>(layout.root, leafId);
  if (!root) return defaultTabLayout(fallbackInstanceId);
  const focusStillValid = layout.focusedLeafId && findLeafById<string>(root, layout.focusedLeafId);
  const focusedLeafId = focusStillValid ? layout.focusedLeafId : (firstLeafInPreOrder<string>(root)?.id ?? null);
  return { root, focusedLeafId };
}

export function resizeSplitSizes(layout: TabLayout, splitId: NodeId, sizes: number[]): TabLayout {
  return { ...layout, root: setSizes<string>(layout.root, splitId, sizes) };
}

export function replacePane(layout: TabLayout, leafId: NodeId, instanceId: string): TabLayout {
  return { ...layout, root: replaceLeafTab<string>(layout.root, leafId, instanceId) };
}

export function focusPane(layout: TabLayout, leafId: NodeId): TabLayout {
  return { ...layout, focusedLeafId: leafId };
}

export function mountedInstanceIds(layout: TabLayout): string[] {
  return collectTabIds<string>(layout.root);
}

export function serializeWorkspace(state: WorkspaceState): string {
  return JSON.stringify(state);
}

export function deserializeWorkspace(raw: string | null): WorkspaceState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as WorkspaceState) : {};
  } catch {
    return {};
  }
}

/** Find the id of the (freshly created) leaf that holds `instanceId`. */
function collectNewLeafFor(root: PaneTree, instanceId: string): NodeId | null {
  let found: NodeId | null = null;
  const walk = (n: PaneTree): void => {
    if (n.kind === 'leaf') {
      if (n.tabId === instanceId) found = n.id;
    } else {
      n.children.forEach(walk);
    }
  };
  walk(root);
  return found;
}
```

- [ ] **Step 5: Run — expect pass.** `npx vitest run tests/ipad/workspaceLayoutModel.test.ts` → PASS (11 tests).

- [ ] **Step 6: Typecheck + full suite + commit**

Run: `npm run typecheck:ci && npm test` → PASS (929 tests).

```bash
git add apps/ipad/src/state/workspaceLayoutModel.ts tests/ipad/workspaceLayoutModel.test.ts
git commit -m "feat(ipad): pure per-tab workspace layout model (#83)"
```

---

## Task 5: iPad `useWorkspaceLayout` hook — state + Preferences persistence

Thin React hook wrapping the Task 4 model. Holds `WorkspaceState`, hydrates from Capacitor Preferences on mount, persists (debounced 400ms) on change, and exposes per-tab actions. Device-verified (React + Preferences); the pure logic it calls is already tested.

**Files:**
- Create: `apps/ipad/src/state/useWorkspaceLayout.ts`

**Interfaces:**
- Consumes: Task 4 model; `@capacitor/preferences`.
- Produces: `useWorkspaceLayout()` → `{ loaded: boolean; getTabLayout(tabKey: string, defaultInstanceId: string): TabLayout; actions }` where `actions = { split(tabKey, leafId, dir, position, instanceId), close(tabKey, leafId, fallbackInstanceId), resize(tabKey, splitId, sizes), replace(tabKey, leafId, instanceId), focus(tabKey, leafId) }`.

- [ ] **Step 1: Implement the hook**

Create `apps/ipad/src/state/useWorkspaceLayout.ts`:

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import type { NodeId } from '@watchtower/shared/layout.js';
import type { SplitPosition } from '@watchtower/shared/workspaceTreeOps.js';
import {
  type WorkspaceState, type TabLayout,
  defaultTabLayout, splitPane, closePane, resizeSplitSizes, replacePane, focusPane,
  serializeWorkspace, deserializeWorkspace,
} from './workspaceLayoutModel.js';

const PREF_KEY = 'watchtower.ipad.workspace';

export interface WorkspaceLayoutActions {
  split(tabKey: string, leafId: NodeId, dir: 'row' | 'col', position: SplitPosition, instanceId: string): void;
  close(tabKey: string, leafId: NodeId, fallbackInstanceId: string): void;
  resize(tabKey: string, splitId: NodeId, sizes: number[]): void;
  replace(tabKey: string, leafId: NodeId, instanceId: string): void;
  focus(tabKey: string, leafId: NodeId): void;
}

export function useWorkspaceLayout(): {
  loaded: boolean;
  getTabLayout(tabKey: string, defaultInstanceId: string): TabLayout;
  actions: WorkspaceLayoutActions;
} {
  const [state, setState] = useState<WorkspaceState>({});
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void Preferences.get({ key: PREF_KEY }).then(({ value }) => {
      if (!alive) return;
      setState(deserializeWorkspace(value));
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  // Debounced persist on every state change (after hydration).
  useEffect(() => {
    if (!loaded) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void Preferences.set({ key: PREF_KEY, value: serializeWorkspace(state) });
    }, 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [state, loaded]);

  const getTabLayout = useCallback(
    (tabKey: string, defaultInstanceId: string): TabLayout =>
      state[tabKey] ?? defaultTabLayout(defaultInstanceId),
    [state],
  );

  // Mutate a tab's layout, seeding a default from `instanceId` if absent.
  const mutate = useCallback(
    (tabKey: string, seedInstanceId: string, fn: (l: TabLayout) => TabLayout): void => {
      setState((prev) => {
        const current = prev[tabKey] ?? defaultTabLayout(seedInstanceId);
        return { ...prev, [tabKey]: fn(current) };
      });
    },
    [],
  );

  const actions = useMemo<WorkspaceLayoutActions>(() => ({
    split: (tabKey, leafId, dir, position, instanceId) =>
      mutate(tabKey, instanceId, (l) => splitPane(l, leafId, dir, position, instanceId)),
    close: (tabKey, leafId, fallbackInstanceId) =>
      mutate(tabKey, fallbackInstanceId, (l) => closePane(l, leafId, fallbackInstanceId)),
    resize: (tabKey, splitId, sizes) =>
      mutate(tabKey, '', (l) => resizeSplitSizes(l, splitId, sizes)),
    replace: (tabKey, leafId, instanceId) =>
      mutate(tabKey, instanceId, (l) => replacePane(l, leafId, instanceId)),
    focus: (tabKey, leafId) =>
      mutate(tabKey, '', (l) => focusPane(l, leafId)),
  }), [mutate]);

  return { loaded, getTabLayout, actions };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:ci` → exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/state/useWorkspaceLayout.ts
git commit -m "feat(ipad): useWorkspaceLayout hook with Preferences persistence (#83)"
```

---

## Task 6: Extract the xterm/attach effect into `useXtermSession`; refactor `TerminalView`

Pull the xterm-create + attach + `ResizeObserver`→fit→`ptyResize` + focus wiring out of `TerminalView` into a reusable hook driven by a host-`ref`, so a `WorkspacePane`-owned positioned `<div>` can host a terminal without change to the effect. Refactor `TerminalView` to consume the hook (behavior identical — still single-pane; device-verify no regression).

**Files:**
- Create: `apps/ipad/src/lib/useXtermSession.ts`
- Modify: `apps/ipad/src/components/TerminalView.tsx`

**Interfaces:**
- Consumes: `useConnection()` bridge; `attachTerminal` from `../lib/attachTerminal.js`.
- Produces: `useXtermSession(hostRef: RefObject<HTMLDivElement | null>, instanceId: string, opts?: { onFocus?: () => void }): void` from `../lib/useXtermSession.js`. It runs the full effect currently in `TerminalView` (re-runs on `[instanceId, bridge]`), calling `opts.onFocus?.()` in the textarea-focus handler (in addition to the existing `bridge.invoke('terminalFocus', ...)`).

- [ ] **Step 1: Create the hook by lifting the existing effect verbatim**

Create `apps/ipad/src/lib/useXtermSession.ts` containing the exact body of the current `TerminalView` `useEffect` (xterm construction, FitAddon, `onData`→`ptyWrite`, textarea `focus`→`terminalFocus`, `ResizeObserver`→fit+`ptyResize`, `attachTerminal` with the `disposed` guard, and the cleanup). Signature:

```typescript
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useConnection } from '../state/connectionContext.js';
import { attachTerminal } from './attachTerminal.js';

export function useXtermSession(
  hostRef: RefObject<HTMLDivElement | null>,
  instanceId: string,
  opts?: { onFocus?: () => void },
): void {
  const { bridge } = useConnection();
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // ... move the entire current TerminalView effect body here verbatim ...
    // In the textarea focus handler, add opts?.onFocus?.() alongside the
    // existing bridge.invoke('terminalFocus', { instanceId }).
    // ... existing cleanup return ...
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, bridge]);
}
```

(Keep every detail — the `requestAnimationFrame` initial fit, the post-attach fit, the `disposed` flag — identical. Only additions: the `hostRef` param replaces the local `hostRef`, and `opts?.onFocus?.()` in the focus handler.)

- [ ] **Step 2: Refactor `TerminalView` to use the hook**

Rewrite `apps/ipad/src/components/TerminalView.tsx` to:

```typescript
import { useRef } from 'react';
import { useXtermSession } from '../lib/useXtermSession.js';

interface Props {
  instanceId: string;
}

export function TerminalView({ instanceId }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useXtermSession(hostRef, instanceId);
  return (
    <div
      ref={hostRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0e0f12',
        overflow: 'hidden',
        position: 'relative',
      }}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:ci` → exits 0.

- [ ] **Step 4: Device verification (single-pane regression check)**

Copy `.env` into the worktree's `apps/ipad` first (see Global Constraints), then run `npm run dev:ipad`. On the iPad, open Instances, select an instance, confirm the terminal still attaches, renders, accepts input, and fits on rotation — identical to before. (No unit test: DOM + xterm + live pty.)

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/lib/useXtermSession.ts apps/ipad/src/components/TerminalView.tsx
git commit -m "refactor(ipad): extract useXtermSession from TerminalView (#83)"
```

---

## Task 7: `WorkspacePane` flat absolute pool + wire into `InstancesModule`

Render every leaf of the **active tab** as an absolutely-positioned `PaneTerminal` (host + `useXtermSession`) at its `computePaneRects` rect, inside one stable `position:relative` container. Replace `InstancesModule`'s single `TerminalView` with `WorkspacePane` for the selected tab. Each pane's own `ResizeObserver` (from Task 6) drives fit + `ptyResize` when its rect changes — no manual resize plumbing.

**Files:**
- Create: `apps/ipad/src/components/PaneTerminal.tsx`, `apps/ipad/src/components/WorkspacePane.tsx`
- Modify: `apps/ipad/src/App.tsx` (`InstancesModule`)

**Interfaces:**
- Consumes: `computePaneRects` + `Rect`; `useXtermSession`; Task 4 model types; Task 5 hook.
- Produces:
  - `PaneTerminal({ instanceId, rect, focused, onFocus })` — absolutely-positioned host.
  - `WorkspacePane({ layout, onFocusLeaf })` (chrome/dividers added in 8–10 via more props).
  - `tabKey(projectId: number | null): string` helper in `App.tsx` (`` `project:${id}` `` or `'other'`).

- [ ] **Step 1: `PaneTerminal`**

Create `apps/ipad/src/components/PaneTerminal.tsx`:

```typescript
import { useRef } from 'react';
import type { Rect } from '@watchtower/shared/computePaneRects.js';
import { useXtermSession } from '../lib/useXtermSession.js';

interface Props {
  instanceId: string;
  rect: Rect;
  focused: boolean;
  onFocus: () => void;
}

export function PaneTerminal({ instanceId, rect, focused, onFocus }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useXtermSession(hostRef, instanceId, { onFocus });
  return (
    <div
      onPointerDown={onFocus}
      style={{
        position: 'absolute',
        left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        boxSizing: 'border-box',
        border: focused ? '1px solid rgba(129,140,248,0.9)' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#0e0f12',
      }}
    >
      <div ref={hostRef} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }} />
    </div>
  );
}
```

- [ ] **Step 2: `WorkspacePane`**

Create `apps/ipad/src/components/WorkspacePane.tsx`:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeId } from '@watchtower/shared/layout.js';
import { computePaneRects, type Rect } from '@watchtower/shared/computePaneRects.js';
import { collectTabIds } from '@watchtower/shared/workspaceTreeOps.js';
import type { TabLayout } from '../state/workspaceLayoutModel.js';
import { PaneTerminal } from './PaneTerminal.js';

const GAP = 6;

interface Props {
  layout: TabLayout;
  onFocusLeaf: (leafId: NodeId, instanceId: string) => void;
}

export function WorkspacePane({ layout, onFocusLeaf }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const rects = useMemo<Map<NodeId, Rect>>(
    () => computePaneRects(layout.root, size.w, size.h, GAP),
    [layout.root, size.w, size.h],
  );

  // leafId -> instanceId (leaf.tabId holds the instanceId on iPad)
  const leaves = useMemo(() => leafEntries(layout), [layout]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {size.w > 0 && leaves.map(({ leafId, instanceId }) => {
        const rect = rects.get(leafId);
        if (!rect) return null;
        return (
          <PaneTerminal
            key={leafId}
            instanceId={instanceId}
            rect={rect}
            focused={layout.focusedLeafId === leafId}
            onFocus={() => onFocusLeaf(leafId, instanceId)}
          />
        );
      })}
    </div>
  );
}

function leafEntries(layout: TabLayout): Array<{ leafId: NodeId; instanceId: string }> {
  const out: Array<{ leafId: NodeId; instanceId: string }> = [];
  const walk = (n: TabLayout['root']): void => {
    if (n.kind === 'leaf') out.push({ leafId: n.id, instanceId: n.tabId });
    else n.children.forEach(walk);
  };
  walk(layout.root);
  return out;
}
```

(Note: `collectTabIds` import is available for later tasks; if unused now, omit it to keep the lint clean — add when Task 9 needs `mountedInstanceIds`.)

- [ ] **Step 3: Wire into `InstancesModule` (`App.tsx`)**

In `apps/ipad/src/App.tsx`:
- Add `function tabKey(projectId: number | null): string { return projectId == null ? 'other' : \`project:${projectId}\`; }`.
- Call `const workspace = useWorkspaceLayout();` in `Shell` (or `InstancesModule`).
- Determine the active tab's `projectId` from the selected instance's group (reuse `groupInstancesByProject` — the same grouping `TabStrip` uses) and compute `key = tabKey(projectId)`.
- Replace the single `{activeId ? <TerminalView instanceId={activeId}/> : <placeholder/>}` body with:

```tsx
{activeId ? (
  <WorkspacePane
    layout={workspace.getTabLayout(key, activeId)}
    onFocusLeaf={(leafId, instanceId) => {
      workspace.actions.focus(key, leafId);
      selectInstance(instanceId); // existing: setActiveId + ack
    }}
  />
) : (
  /* existing placeholder */
)}
```

Only the active tab's `WorkspacePane` is mounted, so non-active tabs' terminals are disposed on switch (their `PaneTerminal`s unmount) and re-attach cheaply via `attachTerminal` when the tab is reselected — matching today's behavior.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:ci` → exits 0.

- [ ] **Step 5: Device verification**

`npm run dev:ipad` (env copied). On iPad: with `useWorkspaceLayout` starting empty, a tab shows a single pane (default leaf). Temporarily seed a two-leaf layout (or wait for Task 9's split UI) to confirm two panes render side-by-side, both attach without gaps, and both stay live. Confirm switching tabs swaps layouts and disposes the previous tab's terminals.

- [ ] **Step 6: Commit**

```bash
git add apps/ipad/src/components/PaneTerminal.tsx apps/ipad/src/components/WorkspacePane.tsx apps/ipad/src/App.tsx
git commit -m "feat(ipad): WorkspacePane flat absolute terminal pool for the active tab (#83)"
```

---

## Task 8: Resize dividers (1-D pointer/touch drag → `setSizes`)

Absolutely-positioned handles between sibling panes at each split boundary. Dragging updates that split's `sizes`. The size math is a pure, tested helper; the handle rendering + pointer handling is device-verified.

**Files:**
- Create: `apps/ipad/src/lib/paneResize.ts`, `tests/ipad/paneResize.test.ts`
- Modify: `apps/ipad/src/components/WorkspacePane.tsx`

**Interfaces:**
- Produces: `sizesAfterDrag(sizes: number[], dividerIndex: number, deltaPercent: number, min?: number): number[]` from `../lib/paneResize.js`. Moves percentage between `children[dividerIndex]` and `children[dividerIndex+1]`, clamping both to `min` (default 8).
- `WorkspacePane` gains prop `onResize: (splitId: NodeId, sizes: number[]) => void`.

- [ ] **Step 1: Failing test**

Create `tests/ipad/paneResize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sizesAfterDrag } from '../../apps/ipad/src/lib/paneResize.js';

describe('sizesAfterDrag', () => {
  it('moves percentage from the right pane to the left when dragging right', () => {
    expect(sizesAfterDrag([50, 50], 0, 10)).toEqual([60, 40]);
  });
  it('moves the other way for a negative delta', () => {
    expect(sizesAfterDrag([50, 50], 0, -20)).toEqual([30, 70]);
  });
  it('clamps to the minimum and does not overshoot', () => {
    expect(sizesAfterDrag([50, 50], 0, 100, 8)).toEqual([92, 8]);
    expect(sizesAfterDrag([50, 50], 0, -100, 8)).toEqual([8, 92]);
  });
  it('only touches the two panes around the divider', () => {
    expect(sizesAfterDrag([30, 40, 30], 1, 10)).toEqual([30, 50, 20]);
  });
});
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run tests/ipad/paneResize.test.ts`.

- [ ] **Step 3: Implement**

Create `apps/ipad/src/lib/paneResize.ts`:

```typescript
/**
 * Move `deltaPercent` from the pane right of a divider into the pane left of it
 * (positive delta grows the left pane). Only the two panes flanking the divider
 * change; both are clamped to `min`.
 */
export function sizesAfterDrag(
  sizes: number[],
  dividerIndex: number,
  deltaPercent: number,
  min = 8,
): number[] {
  const next = [...sizes];
  const a = next[dividerIndex];
  const b = next[dividerIndex + 1];
  const pair = a + b;
  let newA = a + deltaPercent;
  newA = Math.max(min, Math.min(pair - min, newA));
  next[dividerIndex] = newA;
  next[dividerIndex + 1] = pair - newA;
  return next;
}
```

- [ ] **Step 4: Run — PASS** (4 tests).

- [ ] **Step 5: Render dividers in `WorkspacePane`**

For each `split` node, compute divider handle rects from the child rects (a handle sits in the `GAP` between `children[i]` and `children[i+1]`, spanning the cross-axis). On `pointerdown`, capture the pointer and the container dimension along the split axis; on `pointermove`, convert pixel delta → `deltaPercent = (deltaPx / axisLength) * 100` and call `onResize(splitId, sizesAfterDrag(split.sizes, i, deltaPercent))`. Handles: `dir==='row'` → `cursor: col-resize`, a thin vertical strip; `dir==='col'` → `row-resize`, horizontal strip. Add a small pure walker `collectDividers(root, rects)` inside `WorkspacePane` returning `{ splitId, index, rect, dir }[]`. Wire `onResize` in `App.tsx` to `workspace.actions.resize(key, splitId, sizes)`.

- [ ] **Step 6: Typecheck + full suite**

Run: `npm run typecheck:ci && npm test` → PASS (933 tests).

- [ ] **Step 7: Device verification**

Drag a divider between two panes: both resize smoothly, xterm re-fits (each pane's `ResizeObserver` fires), no overlap, min-size clamp holds. (Two-attempt rule applies to drag feel.)

- [ ] **Step 8: Commit**

```bash
git add apps/ipad/src/lib/paneResize.ts tests/ipad/paneResize.test.ts apps/ipad/src/components/WorkspacePane.tsx apps/ipad/src/App.tsx
git commit -m "feat(ipad): resizable split dividers (#83)"
```

---

## Task 9: Pane chrome (split/close) + instance picker

Each pane gets a thin header with **split-right**, **split-down**, **close** buttons. Split opens a `PanePicker` overlay listing the tab group's instances not already mounted; picking calls the split action. Close calls the close action. The available-instances filter is pure + tested; the chrome/overlay is device-verified.

**Files:**
- Create: `apps/ipad/src/lib/panePicker.ts`, `tests/ipad/panePicker.test.ts`, `apps/ipad/src/components/PanePicker.tsx`
- Modify: `apps/ipad/src/components/PaneTerminal.tsx`, `apps/ipad/src/components/WorkspacePane.tsx`, `apps/ipad/src/App.tsx`

**Interfaces:**
- Produces: `availableInstancesForPicker(groupInstanceIds: string[], mountedInstanceIds: string[]): string[]` from `../lib/panePicker.js` (group order preserved, mounted removed).
- `PaneTerminal` gains `onSplit(dir, position)` + `onClose` props (renders the header).
- `WorkspacePane` gains `onSplit(leafId, dir, position)` and `onClose(leafId)` props and a controlled picker.

- [ ] **Step 1: Failing test**

Create `tests/ipad/panePicker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { availableInstancesForPicker } from '../../apps/ipad/src/lib/panePicker.js';

describe('availableInstancesForPicker', () => {
  it('removes already-mounted instances, preserving group order', () => {
    expect(availableInstancesForPicker(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });
  it('returns empty when all are mounted', () => {
    expect(availableInstancesForPicker(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
  it('is a no-op when nothing is mounted', () => {
    expect(availableInstancesForPicker(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run — FAIL**, then implement `apps/ipad/src/lib/panePicker.ts`:

```typescript
export function availableInstancesForPicker(
  groupInstanceIds: string[],
  mountedInstanceIds: string[],
): string[] {
  const mounted = new Set(mountedInstanceIds);
  return groupInstanceIds.filter((id) => !mounted.has(id));
}
```

Run: `npx vitest run tests/ipad/panePicker.test.ts` → PASS (3 tests).

- [ ] **Step 3: Header buttons on `PaneTerminal`**

Add an absolutely-positioned top-right button cluster (inline-styled glass: `background: rgba(20,22,28,0.6)`, `backdropFilter: blur(8px)`, rounded, small). Buttons: split-right (calls `onSplit('row','after')`), split-down (`onSplit('col','after')`), close (`onClose`). Use text/emoji glyphs (e.g. `⇥`, `⤓`, `✕`) — no icon lib, no MUI. `stopPropagation` on button `pointerdown` so tapping chrome doesn't also fire pane focus. Buttons visible when `focused`, faded otherwise.

- [ ] **Step 4: `PanePicker` overlay**

Create `apps/ipad/src/components/PanePicker.tsx`: a small centered modal (fixed overlay, glass card) listing candidate instances (label from the instance list) as tappable rows; props `{ candidates: Array<{ instanceId: string; label: string }>, onPick(instanceId), onCancel() }`. Inline-styled, no MUI. Empty state: "Žádné další instance" with a close button.

- [ ] **Step 5: Wire split/close through `WorkspacePane` → `App.tsx`**

`WorkspacePane` holds `pending` split state `{ leafId, dir, position } | null`; a pane's `onSplit` sets it and opens `PanePicker` with `availableInstancesForPicker(groupInstanceIds, collectTabIds(layout.root))` mapped to labels; on pick → `props.onSplit(leafId, dir, position, instanceId)`; on cancel → clear. Pane `onClose` → `props.onClose(leafId)`. In `App.tsx`, wire `onSplit → workspace.actions.split(key, leafId, dir, position, instanceId)` and `onClose → workspace.actions.close(key, leafId, activeId)`. Pass the group's ordered instanceIds + a label lookup into `WorkspacePane`.

- [ ] **Step 6: Typecheck + full suite + device verify**

Run: `npm run typecheck:ci && npm test` → PASS (936 tests). Device: split a pane → picker lists only unmounted group instances → pick fills the new pane live; already-mounted instances absent; close collapses back; closing the last pane keeps one default pane.

- [ ] **Step 7: Commit**

```bash
git add apps/ipad/src/lib/panePicker.ts tests/ipad/panePicker.test.ts apps/ipad/src/components/PanePicker.tsx apps/ipad/src/components/PaneTerminal.tsx apps/ipad/src/components/WorkspacePane.tsx apps/ipad/src/App.tsx
git commit -m "feat(ipad): pane split/close chrome + instance picker (#83)"
```

---

## Task 10: Magic Keyboard shortcuts + geometric focus navigation

Keydown handler on the workspace: `⌘D` split-right, `⌘⇧D` split-down, `⌘W` close focused, `⌘⌥←/→/↑/↓` move focus to the geometric neighbour. Neighbour selection is a pure, tested helper over the computed rects; the key wiring is device-verified.

**Files:**
- Create: `apps/ipad/src/lib/paneNav.ts`, `tests/ipad/paneNav.test.ts`
- Modify: `apps/ipad/src/components/WorkspacePane.tsx`

**Interfaces:**
- Produces: `adjacentLeaf(rects: Map<NodeId, Rect>, focusedLeafId: NodeId, dir: 'left'|'right'|'up'|'down'): NodeId | null` from `../lib/paneNav.js` — nearest leaf whose center lies in `dir` from the focused pane's center, tie-broken by cross-axis proximity.

- [ ] **Step 1: Failing test**

Create `tests/ipad/paneNav.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { adjacentLeaf } from '../../apps/ipad/src/lib/paneNav.js';
import type { Rect } from '@watchtower/shared/computePaneRects.js';

const rects = new Map<string, Rect>([
  ['a', { x: 0, y: 0, w: 100, h: 100 }],
  ['b', { x: 100, y: 0, w: 100, h: 100 }],
  ['c', { x: 0, y: 100, w: 100, h: 100 }],
]);

describe('adjacentLeaf', () => {
  it('finds the pane to the right', () => expect(adjacentLeaf(rects, 'a', 'right')).toBe('b'));
  it('finds the pane below', () => expect(adjacentLeaf(rects, 'a', 'down')).toBe('c'));
  it('returns null when there is no neighbour that way', () => {
    expect(adjacentLeaf(rects, 'a', 'left')).toBeNull();
    expect(adjacentLeaf(rects, 'b', 'right')).toBeNull();
  });
  it('returns null for an unknown focused id', () => expect(adjacentLeaf(rects, 'zzz', 'right')).toBeNull());
});
```

- [ ] **Step 2: Run — FAIL**, then implement `apps/ipad/src/lib/paneNav.ts`:

```typescript
import type { NodeId } from '@watchtower/shared/layout.js';
import type { Rect } from '@watchtower/shared/computePaneRects.js';

type Dir = 'left' | 'right' | 'up' | 'down';

export function adjacentLeaf(
  rects: Map<NodeId, Rect>,
  focusedLeafId: NodeId,
  dir: Dir,
): NodeId | null {
  const from = rects.get(focusedLeafId);
  if (!from) return null;
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  let best: NodeId | null = null;
  let bestScore = Infinity;
  for (const [id, r] of rects) {
    if (id === focusedLeafId) continue;
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const inDir =
      dir === 'right' ? c.x > fc.x :
      dir === 'left' ? c.x < fc.x :
      dir === 'down' ? c.y > fc.y :
      c.y < fc.y;
    if (!inDir) continue;
    const primary = dir === 'left' || dir === 'right' ? Math.abs(c.x - fc.x) : Math.abs(c.y - fc.y);
    const cross = dir === 'left' || dir === 'right' ? Math.abs(c.y - fc.y) : Math.abs(c.x - fc.x);
    const score = primary + cross * 2; // prefer aligned neighbours
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}
```

Run: `npx vitest run tests/ipad/paneNav.test.ts` → PASS (4 tests).

- [ ] **Step 3: Keydown wiring in `WorkspacePane`**

Add a `keydown` listener (on the container, `tabIndex={0}`, or `window` while mounted). Match `e.metaKey`:
- `⌘D` (no shift) → open split picker for `focusedLeafId`, `dir='row'`, `position='after'`.
- `⌘⇧D` → same with `dir='col'`.
- `⌘W` → `onClose(focusedLeafId)`.
- `⌘⌥Arrow` (`metaKey && altKey`, `e.key` = `ArrowLeft/Right/Up/Down`) → `const next = adjacentLeaf(rects, focusedLeafId, dir); if (next) onFocusLeaf(next, instanceIdOf(next));`.
Call `e.preventDefault()` on handled combos. Reuse the same `onSplit`/`onClose`/`onFocusLeaf` props from Tasks 7/9 (no new App wiring).

- [ ] **Step 4: Typecheck + full suite**

Run: `npm run typecheck:ci && npm test` → PASS (940 tests).

- [ ] **Step 5: Device verification (Magic Keyboard on external monitor)**

With a hardware keyboard: `⌘D`/`⌘⇧D` open the picker and split; `⌘W` closes the focused pane; `⌘⌥Arrow` moves the focus ring to the geometric neighbour and fires `terminalFocus` so keystrokes route to the newly-focused pty.

- [ ] **Step 6: Commit**

```bash
git add apps/ipad/src/lib/paneNav.ts tests/ipad/paneNav.test.ts apps/ipad/src/components/WorkspacePane.tsx
git commit -m "feat(ipad): Magic Keyboard split/close/focus shortcuts (#83)"
```

---

## Final verification (before opening the PR)

- [ ] `npm run typecheck:ci` → exits 0 (all 6 workspaces).
- [ ] `npm test` → all green (~940 tests; up from 913 by 27 new unit tests).
- [ ] Desktop smoke: `npm run dev`, confirm the desktop tiling workspace still splits/closes/resizes (the shared-ops move + genericize touched code desktop depends on).
- [ ] iPad on-device (Magic Keyboard + external monitor, via `npm run dev:ipad`): multi-pane render, gap-free attach, divider feel, split/close via buttons and keyboard, focus ring + pty routing, per-tab layout persistence across app relaunch (Preferences).
- [ ] Open PR from `feat/83-ipad-tiling` → `main`, referencing #83 and the spec.

## Spec coverage self-check

| Spec item | Task |
|---|---|
| Move `workspaceTreeOps` to shared, rewire desktop, move tests | 1 |
| iPad reuses the same ops, no duplication (type-safe) | 2 (genericize — fills the spec's under-specified type story) |
| `computePaneRects` pure + unit tests | 3 |
| Per-tab trees + Preferences persistence + actions + unit tests | 4 (pure model + tests) + 5 (hook) |
| Terminal liveness: flat absolute pool, never reparented, non-active tabs disposed | 6 (extract) + 7 (pool + wire) |
| Resize dividers (1-D drag → setSizes) | 8 |
| Pane chrome (split/close) + pane picker, dedup guard | 9 |
| Magic Keyboard shortcuts (split/close/focus, geometric neighbour) | 10 |
| Focus & pty sizing (reuse #74 ownership; per-pane fit/resize) | 6 (ResizeObserver→ptyResize) + 7/10 (terminalFocus on focus) |
| Out of scope: dnd-kit, keeping all tabs' terminals alive, TerminalPool/SlotRegistry/react-resizable-panels | honored — none introduced |
