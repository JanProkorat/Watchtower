# Multi-pane / Multi-instance Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show multiple tabs side-by-side via a recursive workspace tree, and inside each tab show all of its project instances as horizontal columns.

**Architecture:** Pure-data layer (shared types + tree-mutation functions, fully unit-testable) + React state hook (`useWorkspaceLayout`) with debounced persistence to `settings.layout.*` + portal-keepalive Terminal pool that survives layout mutations + new component tree (`TabStrip` → `WorkspaceRoot` → recursive `SplitView`/`LeafView` → `ColumnsRow` → `ColumnSlot`).

**Tech Stack:** TypeScript, React 18, MUI v5, vitest, `@dnd-kit/core` (existing), `react-resizable-panels` (new), portal-based xterm reparenting via `appendChild`.

**Spec:** `docs/superpowers/specs/2026-05-28-multi-pane-multi-instance-tabs-design.md`

---

## Phase A — Foundation: types and pure functions

These tasks are renderer-only, no UI yet. They produce pure data + tested functions that the later UI tasks compose.

### Task 1: Shared layout types

**Files:**
- Create: `shared/layout.ts`

- [ ] **Step 1: Create the file with type definitions**

```ts
// shared/layout.ts
// Shared layout types for the multi-pane / multi-instance feature.
// Tab ids are tagged-string unions so we can switch on them safely.

export const DASHBOARD_TAB_ID = '__dashboard__' as const;
export type DashboardTabId = typeof DASHBOARD_TAB_ID;
export type ProjectTabId = `project:${number}`;
export type CwdTabId = `cwd:${string}`;
export type TabId = ProjectTabId | CwdTabId | DashboardTabId;

export type TabKind = 'project' | 'cwd' | 'dashboard';

export interface TabRecord {
  id: TabId;
  kind: TabKind;
  label: string;
  color: string | null;
  columnOrder: string[]; // instance IDs, left → right
  focusedInstanceId: string | null;
}

export type NodeId = string;

export type WorkspaceNode = WorkspaceLeaf | WorkspaceSplit;

export interface WorkspaceLeaf {
  kind: 'leaf';
  id: NodeId;
  tabId: TabId;
}

export interface WorkspaceSplit {
  kind: 'split';
  id: NodeId;
  dir: 'row' | 'col';
  sizes: number[]; // percent, must sum to ~100
  children: WorkspaceNode[];
}

export interface PersistedLayout {
  root: WorkspaceNode;
  focusedLeafId: NodeId | null;
  tabFocus: Record<string, string | null>; // TabId → instanceId
  tabStripOrder: TabId[];
}

export const SETTINGS_KEYS = {
  workspaceTree: 'layout.workspaceTree',
  focusedLeafId: 'layout.focusedLeafId',
  tabFocus: 'layout.tabFocus',
  tabStripOrder: 'layout.tabStripOrder',
} as const;
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -E "layout\.ts" || echo "no errors in layout.ts"`
Expected: `no errors in layout.ts`

- [ ] **Step 3: Commit**

```bash
git add shared/layout.ts
git commit -m "$(cat <<'EOF'
feat(layout): shared types for workspace tree + tab records

Adds TabId tagged union, WorkspaceNode (leaf | split), PersistedLayout
and the four `layout.*` settings-key constants. No consumers yet; these
shapes are imported by upcoming renderer-side state and component code.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: tabId helpers

**Files:**
- Create: `client/src/layout/tabId.ts`
- Test: `tests/client/layout/tabId.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/client/layout/tabId.test.ts
import { describe, expect, it } from 'vitest';
import {
  projectTabId,
  cwdTabId,
  isProjectTabId,
  isCwdTabId,
  isDashboardTabId,
  parseTabId,
} from '../../../client/src/layout/tabId.js';
import { DASHBOARD_TAB_ID } from '../../../shared/layout.js';

describe('tabId helpers', () => {
  it('builds project tab ids', () => {
    expect(projectTabId(42)).toBe('project:42');
  });
  it('builds cwd tab ids', () => {
    expect(cwdTabId('/Users/me/repo')).toBe('cwd:/Users/me/repo');
  });
  it('classifies tab ids', () => {
    expect(isProjectTabId('project:1')).toBe(true);
    expect(isCwdTabId('cwd:/x')).toBe(true);
    expect(isDashboardTabId(DASHBOARD_TAB_ID)).toBe(true);
    expect(isProjectTabId('cwd:/x')).toBe(false);
  });
  it('parses project ids', () => {
    expect(parseTabId('project:7')).toEqual({ kind: 'project', projectId: 7 });
    expect(parseTabId('cwd:/Users/x')).toEqual({ kind: 'cwd', cwd: '/Users/x' });
    expect(parseTabId(DASHBOARD_TAB_ID)).toEqual({ kind: 'dashboard' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/layout/tabId.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// client/src/layout/tabId.ts
import {
  DASHBOARD_TAB_ID,
  type CwdTabId,
  type DashboardTabId,
  type ProjectTabId,
  type TabId,
} from '../../../shared/layout.js';

export function projectTabId(projectId: number): ProjectTabId {
  return `project:${projectId}`;
}

export function cwdTabId(cwd: string): CwdTabId {
  return `cwd:${cwd}`;
}

export function isProjectTabId(id: string): id is ProjectTabId {
  return id.startsWith('project:');
}

export function isCwdTabId(id: string): id is CwdTabId {
  return id.startsWith('cwd:');
}

export function isDashboardTabId(id: string): id is DashboardTabId {
  return id === DASHBOARD_TAB_ID;
}

export type ParsedTabId =
  | { kind: 'project'; projectId: number }
  | { kind: 'cwd'; cwd: string }
  | { kind: 'dashboard' };

export function parseTabId(id: TabId): ParsedTabId {
  if (isDashboardTabId(id)) return { kind: 'dashboard' };
  if (isProjectTabId(id)) {
    const n = Number(id.slice('project:'.length));
    return { kind: 'project', projectId: n };
  }
  // cwd:<rest>
  return { kind: 'cwd', cwd: id.slice('cwd:'.length) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/layout/tabId.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/layout/tabId.ts tests/client/layout/tabId.test.ts
git commit -m "$(cat <<'EOF'
feat(layout): tabId build/parse helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: deriveTabs

**Files:**
- Create: `client/src/layout/deriveTabs.ts`
- Test: `tests/client/layout/deriveTabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/client/layout/deriveTabs.test.ts
import { describe, expect, it } from 'vitest';
import { deriveTabs } from '../../../client/src/layout/deriveTabs.js';
import type { InstanceView } from '../../../client/src/state/useInstances.js';
import type { ProjectViewPayload } from '../../../shared/ipcContract.js';
import { DASHBOARD_TAB_ID } from '../../../shared/layout.js';

const inst = (id: string, cwd: string): InstanceView => ({
  id,
  cwd,
  status: 'working',
  lastActivityAt: 0,
});

const proj = (id: number, folderPath: string | null, color = '#0af'): ProjectViewPayload =>
  ({
    id,
    name: `P${id}`,
    color,
    archived: false,
    kind: 'work',
    isDefault: false,
    folderPath,
    jiraGlobs: [],
    jiraBoardUrl: null,
    taskUrlTemplate: null,
    description: null,
    createdAt: '',
    epicCount: 0,
  }) as unknown as ProjectViewPayload;

describe('deriveTabs', () => {
  it('always includes the dashboard tab first', () => {
    const tabs = deriveTabs([], [], new Set(), {});
    expect(tabs.map((t) => t.id)).toEqual([DASHBOARD_TAB_ID]);
  });

  it('groups instances by matching project folderPath', () => {
    const projects = [proj(1, '/a'), proj(2, '/b')];
    const instances = [inst('i1', '/a'), inst('i2', '/a'), inst('i3', '/b')];
    const tabs = deriveTabs(instances, projects, new Set(), {});
    expect(tabs.find((t) => t.id === 'project:1')?.columnOrder).toEqual(['i1', 'i2']);
    expect(tabs.find((t) => t.id === 'project:2')?.columnOrder).toEqual(['i3']);
  });

  it('puts unmatched instances in ad-hoc cwd tabs', () => {
    const tabs = deriveTabs([inst('i1', '/x'), inst('i2', '/x')], [], new Set(), {});
    expect(tabs.find((t) => t.id === 'cwd:/x')?.columnOrder).toEqual(['i1', 'i2']);
  });

  it('preserves ad-hoc tabs that the user opened even with no instances', () => {
    const tabs = deriveTabs([], [], new Set(['/empty']), {});
    expect(tabs.some((t) => t.id === 'cwd:/empty')).toBe(true);
  });

  it('applies tabFocus when provided', () => {
    const tabs = deriveTabs(
      [inst('i1', '/a'), inst('i2', '/a')],
      [proj(1, '/a')],
      new Set(),
      { 'project:1': 'i2' },
    );
    expect(tabs.find((t) => t.id === 'project:1')?.focusedInstanceId).toBe('i2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/layout/deriveTabs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// client/src/layout/deriveTabs.ts
import type { InstanceView } from '../state/useInstances.js';
import type { ProjectViewPayload } from '../../../shared/ipcContract.js';
import { DASHBOARD_TAB_ID, type TabId, type TabRecord } from '../../../shared/layout.js';
import { cwdTabId, projectTabId } from './tabId.js';

export function deriveTabs(
  instances: InstanceView[],
  projects: ProjectViewPayload[],
  openAdHocCwds: Set<string>,
  tabFocus: Record<string, string | null>,
): TabRecord[] {
  // Build cwd → projectId map for routing.
  const cwdToProjectId = new Map<string, number>();
  for (const p of projects) {
    if (p.folderPath) cwdToProjectId.set(p.folderPath, p.id);
  }

  // Group instances by tabId.
  const groups = new Map<TabId, string[]>();
  for (const i of instances) {
    const projectId = cwdToProjectId.get(i.cwd);
    const tabId: TabId = projectId !== undefined ? projectTabId(projectId) : cwdTabId(i.cwd);
    const list = groups.get(tabId) ?? [];
    list.push(i.id);
    groups.set(tabId, list);
  }

  // Always include project tabs the user has opened ad-hoc, even empty.
  for (const cwd of openAdHocCwds) {
    const id = cwdTabId(cwd);
    if (!groups.has(id)) groups.set(id, []);
  }

  const records: TabRecord[] = [];

  // Dashboard first.
  records.push({
    id: DASHBOARD_TAB_ID,
    kind: 'dashboard',
    label: 'Dashboard',
    color: null,
    columnOrder: [],
    focusedInstanceId: null,
  });

  // Project tabs (sorted by project id for determinism — caller can re-order).
  const sortedProjects = [...projects].sort((a, b) => a.id - b.id);
  for (const p of sortedProjects) {
    const id = projectTabId(p.id);
    const cols = groups.get(id);
    if (!cols) continue;
    records.push({
      id,
      kind: 'project',
      label: p.name,
      color: p.color,
      columnOrder: cols,
      focusedInstanceId: pickFocused(tabFocus[id] ?? null, cols),
    });
    groups.delete(id);
  }

  // Remaining ad-hoc cwd tabs.
  for (const [id, cols] of groups) {
    if (id === DASHBOARD_TAB_ID) continue;
    records.push({
      id,
      kind: 'cwd',
      label: basenameOf(id.slice('cwd:'.length)),
      color: null,
      columnOrder: cols,
      focusedInstanceId: pickFocused(tabFocus[id] ?? null, cols),
    });
  }

  return records;
}

function pickFocused(saved: string | null, cols: string[]): string | null {
  if (saved && cols.includes(saved)) return saved;
  return cols[0] ?? null;
}

function basenameOf(cwd: string): string {
  if (!cwd) return cwd;
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/layout/deriveTabs.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/layout/deriveTabs.ts tests/client/layout/deriveTabs.test.ts
git commit -m "$(cat <<'EOF'
feat(layout): derive TabRecord[] from instances + projects + ad-hoc set

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: routeSpawnToTab

**Files:**
- Create: `client/src/layout/routeSpawnToTab.ts`
- Test: `tests/client/layout/routeSpawnToTab.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/client/layout/routeSpawnToTab.test.ts
import { describe, expect, it } from 'vitest';
import { routeSpawnToTab } from '../../../client/src/layout/routeSpawnToTab.js';

describe('routeSpawnToTab', () => {
  const projects = [
    { id: 1, folderPath: '/Users/me/foo' },
    { id: 2, folderPath: '/Users/me/bar' },
    { id: 3, folderPath: null },
  ];

  it('returns project tab id when cwd matches a project folderPath', () => {
    expect(routeSpawnToTab('/Users/me/foo', projects)).toBe('project:1');
    expect(routeSpawnToTab('/Users/me/bar', projects)).toBe('project:2');
  });

  it('returns cwd tab id when no project matches', () => {
    expect(routeSpawnToTab('/Users/me/orphan', projects)).toBe('cwd:/Users/me/orphan');
  });

  it('ignores projects with null folderPath', () => {
    expect(routeSpawnToTab('/x', [{ id: 3, folderPath: null }])).toBe('cwd:/x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/layout/routeSpawnToTab.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// client/src/layout/routeSpawnToTab.ts
import type { TabId } from '../../../shared/layout.js';
import { cwdTabId, projectTabId } from './tabId.js';

interface ProjectLike {
  id: number;
  folderPath: string | null;
}

export function routeSpawnToTab(cwd: string, projects: ProjectLike[]): TabId {
  for (const p of projects) {
    if (p.folderPath && p.folderPath === cwd) return projectTabId(p.id);
  }
  return cwdTabId(cwd);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/layout/routeSpawnToTab.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/layout/routeSpawnToTab.ts tests/client/layout/routeSpawnToTab.test.ts
git commit -m "$(cat <<'EOF'
feat(layout): route spawned cwd to project tab or ad-hoc cwd tab

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Workspace tree ops

**Files:**
- Create: `client/src/layout/workspaceTreeOps.ts`
- Create: `client/src/layout/newNodeId.ts`
- Test: `tests/client/layout/workspaceTreeOps.test.ts`

- [ ] **Step 1: Implement node id helper**

```ts
// client/src/layout/newNodeId.ts
// Short, monotonic-ish ids stable enough for React keys + DnD identifiers.
let counter = 0;
export function newNodeId(): string {
  counter += 1;
  return `n${Date.now().toString(36)}-${counter.toString(36)}`;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/client/layout/workspaceTreeOps.test.ts
import { describe, expect, it } from 'vitest';
import {
  leaf,
  split,
  findLeafById,
  findLeafByTabId,
  firstLeafInPreOrder,
  splitLeaf,
  replaceLeafTab,
  unmountLeaf,
  setSizes,
  collectTabIds,
} from '../../../client/src/layout/workspaceTreeOps.js';
import type { WorkspaceNode } from '../../../shared/layout.js';

const L = (id: string, tabId: string): WorkspaceNode =>
  ({ kind: 'leaf', id, tabId: tabId as never });

describe('workspaceTreeOps', () => {
  it('findLeafById finds nested', () => {
    const root: WorkspaceNode = split('r', 'row', [L('a', 'project:1'), split('s', 'col', [L('b', 'project:2'), L('c', 'project:3')])]);
    expect(findLeafById(root, 'b')?.tabId).toBe('project:2');
    expect(findLeafById(root, 'missing')).toBeNull();
  });

  it('findLeafByTabId returns first match in pre-order', () => {
    const root = split('r', 'row', [L('a', 'project:1'), L('b', 'project:1')]);
    expect(findLeafByTabId(root, 'project:1' as never)?.id).toBe('a');
  });

  it('firstLeafInPreOrder returns leftmost', () => {
    const root = split('r', 'row', [split('s', 'col', [L('a', 'project:1'), L('b', 'project:2')]), L('c', 'project:3')]);
    expect(firstLeafInPreOrder(root)?.id).toBe('a');
  });

  it('splitLeaf wraps target leaf in a split', () => {
    const root = L('a', 'project:1');
    const next = splitLeaf(root, 'a', 'row', 'after', 'project:2');
    expect(next.kind).toBe('split');
    if (next.kind !== 'split') return;
    expect(next.dir).toBe('row');
    expect(next.children.map((c) => (c.kind === 'leaf' ? c.tabId : 'split'))).toEqual(['project:1', 'project:2']);
    expect(next.sizes).toEqual([50, 50]);
  });

  it('splitLeaf inserts before target when position=before', () => {
    const root = L('a', 'project:1');
    const next = splitLeaf(root, 'a', 'row', 'before', 'project:9');
    if (next.kind !== 'split') return;
    expect(next.children.map((c) => (c.kind === 'leaf' ? c.tabId : 'x'))).toEqual(['project:9', 'project:1']);
  });

  it('replaceLeafTab swaps tabId without restructuring', () => {
    const root = split('r', 'row', [L('a', 'project:1'), L('b', 'project:2')]);
    const next = replaceLeafTab(root, 'a', 'project:9' as never);
    expect(findLeafById(next, 'a')?.tabId).toBe('project:9');
  });

  it('unmountLeaf removes leaf and flattens single-child splits', () => {
    const root = split('r', 'row', [L('a', 'project:1'), L('b', 'project:2')]);
    const next = unmountLeaf(root, 'a');
    expect(next?.kind).toBe('leaf');
    if (next?.kind === 'leaf') expect(next.id).toBe('b');
  });

  it('unmountLeaf returns null when removing the only leaf', () => {
    const root = L('a', 'project:1');
    expect(unmountLeaf(root, 'a')).toBeNull();
  });

  it('unmountLeaf prunes deeply nested', () => {
    const root = split('r', 'row', [L('a', 'project:1'), split('s', 'col', [L('b', 'project:2'), L('c', 'project:3')])]);
    const next = unmountLeaf(root, 'b');
    // s now has 1 child → flattens to just 'c'; root becomes [a, c]
    if (next?.kind !== 'split') throw new Error('expected split');
    expect(next.children.map((c) => (c.kind === 'leaf' ? c.id : 'split'))).toEqual(['a', 'c']);
  });

  it('setSizes updates sizes on a split by id', () => {
    const root = split('r', 'row', [L('a', 'project:1'), L('b', 'project:2')]);
    const next = setSizes(root, 'r', [30, 70]);
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.sizes).toEqual([30, 70]);
  });

  it('collectTabIds returns all referenced tabs', () => {
    const root = split('r', 'row', [L('a', 'project:1'), split('s', 'col', [L('b', 'project:2'), L('c', 'project:1')])]);
    expect(new Set(collectTabIds(root))).toEqual(new Set(['project:1', 'project:2']));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/client/layout/workspaceTreeOps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement workspaceTreeOps**

```ts
// client/src/layout/workspaceTreeOps.ts
import type {
  NodeId,
  TabId,
  WorkspaceLeaf,
  WorkspaceNode,
  WorkspaceSplit,
} from '../../../shared/layout.js';
import { newNodeId } from './newNodeId.js';

export function leaf(id: NodeId, tabId: TabId): WorkspaceLeaf {
  return { kind: 'leaf', id, tabId };
}

export function split(
  id: NodeId,
  dir: 'row' | 'col',
  children: WorkspaceNode[],
  sizes?: number[],
): WorkspaceSplit {
  return {
    kind: 'split',
    id,
    dir,
    children,
    sizes: sizes ?? evenSizes(children.length),
  };
}

function evenSizes(n: number): number[] {
  if (n === 0) return [];
  const s = +(100 / n).toFixed(4);
  const arr = new Array(n).fill(s) as number[];
  // Snap last to avoid rounding drift.
  arr[arr.length - 1] = +(100 - s * (n - 1)).toFixed(4);
  return arr;
}

export function findLeafById(node: WorkspaceNode, id: NodeId): WorkspaceLeaf | null {
  if (node.kind === 'leaf') return node.id === id ? node : null;
  for (const child of node.children) {
    const hit = findLeafById(child, id);
    if (hit) return hit;
  }
  return null;
}

export function findLeafByTabId(node: WorkspaceNode, tabId: TabId): WorkspaceLeaf | null {
  if (node.kind === 'leaf') return node.tabId === tabId ? node : null;
  for (const child of node.children) {
    const hit = findLeafByTabId(child, tabId);
    if (hit) return hit;
  }
  return null;
}

export function firstLeafInPreOrder(node: WorkspaceNode): WorkspaceLeaf | null {
  if (node.kind === 'leaf') return node;
  for (const child of node.children) {
    const hit = firstLeafInPreOrder(child);
    if (hit) return hit;
  }
  return null;
}

export function collectTabIds(node: WorkspaceNode): TabId[] {
  if (node.kind === 'leaf') return [node.tabId];
  return node.children.flatMap(collectTabIds);
}

export function replaceLeafTab(
  node: WorkspaceNode,
  leafId: NodeId,
  newTabId: TabId,
): WorkspaceNode {
  if (node.kind === 'leaf') {
    return node.id === leafId ? { ...node, tabId: newTabId } : node;
  }
  return {
    ...node,
    children: node.children.map((c) => replaceLeafTab(c, leafId, newTabId)),
  };
}

export type SplitPosition = 'before' | 'after';

export function splitLeaf(
  node: WorkspaceNode,
  targetLeafId: NodeId,
  dir: 'row' | 'col',
  position: SplitPosition,
  newTabId: TabId,
): WorkspaceNode {
  if (node.kind === 'leaf') {
    if (node.id !== targetLeafId) return node;
    const newLeaf = leaf(newNodeId(), newTabId);
    const children = position === 'before' ? [newLeaf, node] : [node, newLeaf];
    return split(newNodeId(), dir, children);
  }
  return {
    ...node,
    children: node.children.map((c) => splitLeaf(c, targetLeafId, dir, position, newTabId)),
  };
}

export function unmountLeaf(node: WorkspaceNode, leafId: NodeId): WorkspaceNode | null {
  if (node.kind === 'leaf') {
    return node.id === leafId ? null : node;
  }
  const newChildren: WorkspaceNode[] = [];
  for (const c of node.children) {
    const after = unmountLeaf(c, leafId);
    if (after) newChildren.push(after);
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0]!; // flatten single-child split
  return {
    ...node,
    children: newChildren,
    sizes: evenSizes(newChildren.length),
  };
}

export function setSizes(
  node: WorkspaceNode,
  splitId: NodeId,
  sizes: number[],
): WorkspaceNode {
  if (node.kind === 'leaf') return node;
  if (node.id === splitId) {
    return { ...node, sizes };
  }
  return {
    ...node,
    children: node.children.map((c) => setSizes(c, splitId, sizes)),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/client/layout/workspaceTreeOps.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/layout/workspaceTreeOps.ts client/src/layout/newNodeId.ts tests/client/layout/workspaceTreeOps.test.ts
git commit -m "$(cat <<'EOF'
feat(layout): pure workspace-tree mutation ops + traversal helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: pruneLayout

**Files:**
- Create: `client/src/layout/pruneLayout.ts`
- Test: `tests/client/layout/pruneLayout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/client/layout/pruneLayout.test.ts
import { describe, expect, it } from 'vitest';
import { pruneLayout } from '../../../client/src/layout/pruneLayout.js';
import { leaf, split } from '../../../client/src/layout/workspaceTreeOps.js';
import { DASHBOARD_TAB_ID } from '../../../shared/layout.js';

describe('pruneLayout', () => {
  it('keeps the tree intact when all tabIds are valid', () => {
    const root = split('r', 'row', [leaf('a', 'project:1'), leaf('b', 'project:2')]);
    const validTabs = new Set(['project:1', 'project:2']);
    expect(pruneLayout(root, validTabs)).toEqual(root);
  });

  it('removes leaves whose tabId is missing', () => {
    const root = split('r', 'row', [leaf('a', 'project:1'), leaf('b', 'project:99')]);
    const out = pruneLayout(root, new Set(['project:1']));
    expect(out.kind).toBe('leaf');
    if (out.kind === 'leaf') expect(out.tabId).toBe('project:1');
  });

  it('falls back to dashboard when everything is invalid', () => {
    const root = split('r', 'row', [leaf('a', 'project:1'), leaf('b', 'project:2')]);
    const out = pruneLayout(root, new Set());
    expect(out.kind).toBe('leaf');
    if (out.kind === 'leaf') expect(out.tabId).toBe(DASHBOARD_TAB_ID);
  });

  it('flattens single-child splits', () => {
    const inner = split('s', 'col', [leaf('b', 'project:1'), leaf('c', 'project:99')]);
    const root = split('r', 'row', [leaf('a', 'project:99'), inner]);
    const out = pruneLayout(root, new Set(['project:1']));
    // root: 'a' dropped, inner becomes leaf('b'); root has 1 child → flattens to leaf b
    expect(out.kind).toBe('leaf');
    if (out.kind === 'leaf') expect(out.tabId).toBe('project:1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/layout/pruneLayout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// client/src/layout/pruneLayout.ts
import { DASHBOARD_TAB_ID, type TabId, type WorkspaceNode } from '../../../shared/layout.js';
import { leaf } from './workspaceTreeOps.js';
import { newNodeId } from './newNodeId.js';

export function pruneLayout(node: WorkspaceNode, validTabs: Set<string>): WorkspaceNode {
  const cleaned = pruneRec(node, validTabs);
  if (!cleaned) {
    return leaf(newNodeId(), DASHBOARD_TAB_ID as TabId);
  }
  return cleaned;
}

function pruneRec(node: WorkspaceNode, validTabs: Set<string>): WorkspaceNode | null {
  if (node.kind === 'leaf') {
    return validTabs.has(node.tabId) || node.tabId === DASHBOARD_TAB_ID ? node : null;
  }
  const kept: WorkspaceNode[] = [];
  for (const c of node.children) {
    const after = pruneRec(c, validTabs);
    if (after) kept.push(after);
  }
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]!;
  return { ...node, children: kept };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/layout/pruneLayout.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/layout/pruneLayout.ts tests/client/layout/pruneLayout.test.ts
git commit -m "$(cat <<'EOF'
feat(layout): pruneLayout removes orphan leaves + falls back to dashboard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Install react-resizable-panels

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `npm install react-resizable-panels@^2.1.7`
Expected: dependency added, no peer warnings.

- [ ] **Step 2: Verify**

Run: `node -e "require('react-resizable-panels')" 2>&1 || echo 'esm only, skip require check'`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add react-resizable-panels for workspace splits

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — State + persistence hooks

### Task 8: useWorkspaceLayout hook

**Files:**
- Create: `client/src/state/useWorkspaceLayout.ts`
- Test: `tests/client/state/useWorkspaceLayout.test.ts`

- [ ] **Step 1: Write the test (persistence round-trip + mutations)**

```ts
// tests/client/state/useWorkspaceLayout.test.ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceLayout } from '../../../client/src/state/useWorkspaceLayout.js';
import {
  DASHBOARD_TAB_ID,
  SETTINGS_KEYS,
  type PersistedLayout,
} from '../../../shared/layout.js';

interface Bridge {
  invoke: ReturnType<typeof vi.fn>;
}

function mockBridge(initial: Partial<Record<string, string>> = {}): Bridge {
  const store: Record<string, string> = { ...initial };
  return {
    invoke: vi.fn(async (kind: string, payload: { key: string; value?: string }) => {
      if (kind === 'getSetting') return { value: store[payload.key] ?? null };
      if (kind === 'setSetting') {
        store[payload.key] = payload.value!;
        return { ok: true };
      }
      throw new Error('unexpected ipc kind: ' + kind);
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as { watchtower?: unknown }).watchtower;
});

describe('useWorkspaceLayout', () => {
  it('hydrates from empty settings → dashboard fallback', async () => {
    (window as unknown as { watchtower: Bridge }).watchtower = mockBridge();
    const { result } = renderHook(() => useWorkspaceLayout());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.layout.root.kind).toBe('leaf');
    if (result.current.layout.root.kind === 'leaf') {
      expect(result.current.layout.root.tabId).toBe(DASHBOARD_TAB_ID);
    }
  });

  it('round-trips a non-trivial tree through getSetting/setSetting', async () => {
    const tree: PersistedLayout = {
      root: {
        kind: 'split',
        id: 'r',
        dir: 'row',
        sizes: [50, 50],
        children: [
          { kind: 'leaf', id: 'a', tabId: 'project:1' },
          { kind: 'leaf', id: 'b', tabId: 'project:2' },
        ],
      },
      focusedLeafId: 'a',
      tabFocus: {},
      tabStripOrder: [],
    };
    (window as unknown as { watchtower: Bridge }).watchtower = mockBridge({
      [SETTINGS_KEYS.workspaceTree]: JSON.stringify(tree.root),
      [SETTINGS_KEYS.focusedLeafId]: JSON.stringify(tree.focusedLeafId),
      [SETTINGS_KEYS.tabFocus]: JSON.stringify(tree.tabFocus),
      [SETTINGS_KEYS.tabStripOrder]: JSON.stringify(tree.tabStripOrder),
    });
    const { result } = renderHook(() => useWorkspaceLayout());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.layout).toEqual(tree);
  });

  it('persists a mutation after debounce', async () => {
    const bridge = mockBridge();
    (window as unknown as { watchtower: Bridge }).watchtower = bridge;
    const { result } = renderHook(() => useWorkspaceLayout());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.actions.focusLeaf('new-leaf-id'));
    // Within the debounce window, no setSetting yet.
    expect(bridge.invoke).not.toHaveBeenCalledWith('setSetting', expect.anything());
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(bridge.invoke).toHaveBeenCalledWith(
      'setSetting',
      expect.objectContaining({ key: SETTINGS_KEYS.focusedLeafId }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/state/useWorkspaceLayout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// client/src/state/useWorkspaceLayout.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DASHBOARD_TAB_ID,
  SETTINGS_KEYS,
  type NodeId,
  type PersistedLayout,
  type TabId,
  type WorkspaceNode,
} from '../../../shared/layout.js';
import { leaf, splitLeaf, unmountLeaf, replaceLeafTab, setSizes, firstLeafInPreOrder, findLeafById } from '../layout/workspaceTreeOps.js';
import { newNodeId } from '../layout/newNodeId.js';

const PERSIST_DEBOUNCE_MS = 500;

export interface WorkspaceLayoutActions {
  replaceLeafTab(leafId: NodeId, tabId: TabId): void;
  splitLeafAt(targetLeafId: NodeId, dir: 'row' | 'col', position: 'before' | 'after', newTabId: TabId): void;
  unmountLeafAt(leafId: NodeId): void;
  setSplitSizes(splitId: NodeId, sizes: number[]): void;
  focusLeaf(leafId: NodeId | null): void;
  focusColumnInTab(tabId: TabId, instanceId: string | null): void;
  setTabStripOrder(order: TabId[]): void;
  replaceTree(root: WorkspaceNode): void;  // App.tsx uses this after pruning against live tabs
}

export interface UseWorkspaceLayoutResult {
  loaded: boolean;
  layout: PersistedLayout;
  actions: WorkspaceLayoutActions;
}

const DEFAULT_LAYOUT = (): PersistedLayout => {
  const id = newNodeId();
  return {
    root: leaf(id, DASHBOARD_TAB_ID as TabId),
    focusedLeafId: id,
    tabFocus: {},
    tabStripOrder: [],
  };
};

export function useWorkspaceLayout(): UseWorkspaceLayoutResult {
  const [layout, setLayout] = useState<PersistedLayout>(DEFAULT_LAYOUT);
  const [loaded, setLoaded] = useState(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate once on mount. Pruning happens in App.tsx once `tabs` are derived.
  useEffect(() => {
    let cancelled = false;
    void hydrate().then((hydrated) => {
      if (cancelled) return;
      setLayout(hydrated);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced persist whenever layout changes (after hydration).
  useEffect(() => {
    if (!loaded) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void persist(layout);
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [layout, loaded]);

  const actions = useMemo<WorkspaceLayoutActions>(() => ({
    replaceLeafTab: (leafId, tabId) =>
      setLayout((p) => ({ ...p, root: replaceLeafTab(p.root, leafId, tabId) })),
    splitLeafAt: (targetLeafId, dir, position, newTabId) =>
      setLayout((p) => ({ ...p, root: splitLeaf(p.root, targetLeafId, dir, position, newTabId) })),
    unmountLeafAt: (leafId) =>
      setLayout((p) => {
        const next = unmountLeaf(p.root, leafId) ?? leaf(newNodeId(), DASHBOARD_TAB_ID as TabId);
        // If the focused leaf was just removed, retarget to leftmost.
        const stillFocused = p.focusedLeafId && findLeafById(next, p.focusedLeafId);
        const focusedLeafId = stillFocused ? p.focusedLeafId : (firstLeafInPreOrder(next)?.id ?? null);
        return { ...p, root: next, focusedLeafId };
      }),
    setSplitSizes: (splitId, sizes) =>
      setLayout((p) => ({ ...p, root: setSizes(p.root, splitId, sizes) })),
    focusLeaf: (leafId) => setLayout((p) => ({ ...p, focusedLeafId: leafId })),
    focusColumnInTab: (tabId, instanceId) =>
      setLayout((p) => ({ ...p, tabFocus: { ...p.tabFocus, [tabId]: instanceId } })),
    setTabStripOrder: (order) => setLayout((p) => ({ ...p, tabStripOrder: order })),
    replaceTree: (root) => setLayout((p) => {
      const stillFocused = p.focusedLeafId && findLeafById(root, p.focusedLeafId);
      return {
        ...p,
        root,
        focusedLeafId: stillFocused ? p.focusedLeafId : (firstLeafInPreOrder(root)?.id ?? null),
      };
    }),
  }), []);

  return { loaded, layout, actions };
}

async function hydrate(): Promise<PersistedLayout> {
  const [tree, focused, tabFocus, stripOrder] = await Promise.all([
    readSetting<WorkspaceNode>(SETTINGS_KEYS.workspaceTree),
    readSetting<NodeId | null>(SETTINGS_KEYS.focusedLeafId),
    readSetting<Record<string, string | null>>(SETTINGS_KEYS.tabFocus),
    readSetting<TabId[]>(SETTINGS_KEYS.tabStripOrder),
  ]);
  const base = DEFAULT_LAYOUT();
  const root = tree ?? base.root;
  return {
    root,
    focusedLeafId: focused ?? firstLeafInPreOrder(root)?.id ?? null,
    tabFocus: tabFocus ?? {},
    tabStripOrder: stripOrder ?? [],
  };
}

async function readSetting<T>(key: string): Promise<T | null> {
  try {
    const r = await window.watchtower.invoke('getSetting', { key });
    if (!r.value) return null;
    return JSON.parse(r.value) as T;
  } catch {
    return null;
  }
}

async function persist(layout: PersistedLayout): Promise<void> {
  await Promise.all([
    window.watchtower.invoke('setSetting', { key: SETTINGS_KEYS.workspaceTree, value: JSON.stringify(layout.root) }),
    window.watchtower.invoke('setSetting', { key: SETTINGS_KEYS.focusedLeafId, value: JSON.stringify(layout.focusedLeafId) }),
    window.watchtower.invoke('setSetting', { key: SETTINGS_KEYS.tabFocus, value: JSON.stringify(layout.tabFocus) }),
    window.watchtower.invoke('setSetting', { key: SETTINGS_KEYS.tabStripOrder, value: JSON.stringify(layout.tabStripOrder) }),
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/state/useWorkspaceLayout.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/state/useWorkspaceLayout.ts tests/client/state/useWorkspaceLayout.test.ts
git commit -m "$(cat <<'EOF'
feat(state): useWorkspaceLayout — hydrate + debounced persist + mutation actions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: useTabs hook

**Files:**
- Create: `client/src/state/useTabs.ts`

- [ ] **Step 1: Implement**

```ts
// client/src/state/useTabs.ts
import { useMemo } from 'react';
import type { InstanceView } from './useInstances.js';
import type { ProjectViewPayload } from '../../../shared/ipcContract.js';
import type { TabRecord } from '../../../shared/layout.js';
import { deriveTabs } from '../layout/deriveTabs.js';

export function useTabs(
  instances: InstanceView[],
  projects: ProjectViewPayload[],
  openAdHocCwds: Set<string>,
  tabFocus: Record<string, string | null>,
): TabRecord[] {
  return useMemo(
    () => deriveTabs(instances, projects, openAdHocCwds, tabFocus),
    [instances, projects, openAdHocCwds, tabFocus],
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep "useTabs" || echo "no errors"`
Expected: `no errors`.

- [ ] **Step 3: Commit**

```bash
git add client/src/state/useTabs.ts
git commit -m "$(cat <<'EOF'
feat(state): useTabs memoised derivation hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: useFocusedInstance hook

**Files:**
- Create: `client/src/state/useFocusedInstance.ts`

- [ ] **Step 1: Implement**

```ts
// client/src/state/useFocusedInstance.ts
import { useEffect, useMemo } from 'react';
import type { TabRecord, PersistedLayout, WorkspaceNode } from '../../../shared/layout.js';
import { findLeafById } from '../layout/workspaceTreeOps.js';

export function useFocusedInstance(
  layout: PersistedLayout,
  tabs: TabRecord[],
): string | null {
  const focusedInstanceId = useMemo(
    () => computeFocused(layout, tabs),
    [layout, tabs],
  );

  // Emit focusChanged to the orchestrator whenever the focused id changes.
  useEffect(() => {
    void window.watchtower.invoke('focusChanged', { instanceId: focusedInstanceId });
  }, [focusedInstanceId]);

  return focusedInstanceId;
}

function computeFocused(layout: PersistedLayout, tabs: TabRecord[]): string | null {
  if (!layout.focusedLeafId) return null;
  const leafNode = findLeafById(layout.root, layout.focusedLeafId);
  if (!leafNode) return null;
  const tab = tabs.find((t) => t.id === leafNode.tabId);
  return tab?.focusedInstanceId ?? null;
}

// Re-exported for unit access.
export const _internal = { computeFocused };
```

- [ ] **Step 2: Commit**

```bash
git add client/src/state/useFocusedInstance.ts
git commit -m "$(cat <<'EOF'
feat(state): useFocusedInstance — single focusChanged id from layout+tabs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Terminal portal keepalive

The current `<Terminal>` mounts xterm into its own container ref. To survive layout mutations, we keep `<Terminal>` mounted at a stable position in the React tree (the App-level `TerminalPool`) and reparent its xterm DOM node into a target slot via `appendChild`. Slots register themselves into a shared `SlotRegistry` so terminals know which DOM element to render into.

### Task 11: SlotRegistry context

**Files:**
- Create: `client/src/components/instances/SlotRegistry.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/instances/SlotRegistry.tsx
import { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';

interface RegistryAPI {
  registerSlot(instanceId: string, el: HTMLElement | null): () => void;
  subscribe(cb: () => void): () => void;
  getSlot(instanceId: string): HTMLElement | null;
}

const SlotRegistryContext = createContext<RegistryAPI | null>(null);

export function SlotRegistryProvider({ children }: { children: ReactNode }) {
  const slots = useRef(new Map<string, HTMLElement | null>());
  const subscribers = useRef(new Set<() => void>());

  const notify = () => {
    for (const cb of subscribers.current) cb();
  };

  const registerSlot = useCallback((instanceId: string, el: HTMLElement | null) => {
    slots.current.set(instanceId, el);
    notify();
    return () => {
      if (slots.current.get(instanceId) === el) {
        slots.current.delete(instanceId);
        notify();
      }
    };
  }, []);

  const subscribe = useCallback((cb: () => void) => {
    subscribers.current.add(cb);
    return () => {
      subscribers.current.delete(cb);
    };
  }, []);

  const getSlot = useCallback(
    (instanceId: string) => slots.current.get(instanceId) ?? null,
    [],
  );

  const api = useMemo<RegistryAPI>(() => ({ registerSlot, subscribe, getSlot }), [registerSlot, subscribe, getSlot]);
  return <SlotRegistryContext.Provider value={api}>{children}</SlotRegistryContext.Provider>;
}

export function useSlotForInstance(instanceId: string): HTMLElement | null {
  const api = useContext(SlotRegistryContext);
  if (!api) throw new Error('useSlotForInstance must be inside SlotRegistryProvider');
  return useSyncExternalStore(
    api.subscribe,
    () => api.getSlot(instanceId),
    () => null,
  );
}

export function useSlotRegistration() {
  const api = useContext(SlotRegistryContext);
  if (!api) throw new Error('useSlotRegistration must be inside SlotRegistryProvider');
  return api.registerSlot;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/instances/SlotRegistry.tsx
git commit -m "$(cat <<'EOF'
feat(instances): SlotRegistry context for slot ⇆ terminal binding

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Refactor Terminal to reparent into a slot

**Files:**
- Modify: `client/src/components/Terminal.tsx`

- [ ] **Step 1: Replace the body of Terminal to subscribe to its slot**

```tsx
// client/src/components/Terminal.tsx — full file replacement
import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useSlotForInstance } from './instances/SlotRegistry.js';

interface Props {
  instanceId: string;
  status: string;
}

const STARTING_STATUSES = new Set(['spawning', 'resuming']);
const SPINNER_FALLBACK_MS = 10_000;

export function Terminal({ instanceId, status }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [fallbackElapsed, setFallbackElapsed] = useState(false);
  const slot = useSlotForInstance(instanceId);
  const isStarting = STARTING_STATUSES.has(status) && !fallbackElapsed;

  useEffect(() => {
    if (!STARTING_STATUSES.has(status)) return;
    const t = setTimeout(() => setFallbackElapsed(true), SPINNER_FALLBACK_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount xterm once per instance into the host element. The host then gets
  // reparented into the visible slot (or stays in the pool when slot=null).
  useEffect(() => {
    if (!hostRef.current) return;
    const term = new XTerm({
      fontFamily: 'Menlo, Monaco, "SF Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#0e0f12',
        foreground: '#e5e7eb',
        cursor: '#e5e7eb',
        cursorAccent: '#0e0f12',
      },
      convertEol: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* hidden */ }
    });
    termRef.current = term;
    fitRef.current = fit;

    const offData = window.watchtower.on('ptyData', (p) => {
      if (p.instanceId !== instanceId) return;
      term.write(p.chunk);
    });
    const inputDisp = term.onData((data) => {
      void window.watchtower.invoke('ptyWrite', { instanceId, data });
    });
    void window.watchtower.invoke('ptyResize', { instanceId, cols: term.cols, rows: term.rows });

    return () => {
      offData();
      inputDisp.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [instanceId]);

  // Reparent host into the current slot. When slot=null, the host returns to
  // its original DOM position (inside the hidden pool element below).
  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    if (!host) return;
    if (slot) {
      slot.appendChild(host);
      if (overlay) slot.appendChild(overlay);
      // Re-fit + focus after reparent.
      const fit = fitRef.current;
      const term = termRef.current;
      requestAnimationFrame(() => {
        try {
          fit?.fit();
          if (term) {
            void window.watchtower.invoke('ptyResize', {
              instanceId,
              cols: term.cols,
              rows: term.rows,
            });
            term.focus();
          }
        } catch { /* hidden */ }
      });
    }
    // else: leave host where it is; either still attached to the previous
    // slot (will be cleaned up by that slot's own unmount) or in pool.
  }, [slot, instanceId]);

  // Re-fit on slot resize.
  useEffect(() => {
    if (!slot) return;
    const fit = fitRef.current;
    if (!fit) return;
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const term = termRef.current;
        if (term) {
          void window.watchtower.invoke('ptyResize', {
            instanceId,
            cols: term.cols,
            rows: term.rows,
          });
        }
      } catch { /* hidden */ }
    });
    ro.observe(slot);
    return () => ro.disconnect();
  }, [slot, instanceId]);

  return (
    <Box sx={{ display: 'none' }} aria-hidden>
      <Box ref={hostRef} sx={{ position: 'absolute', inset: 0, backgroundColor: '#0e0f12' }} />
      {isStarting && (
        <Box ref={overlayRef} sx={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 1.5,
          backgroundColor: '#0e0f12', color: 'text.secondary',
        }}>
          <CircularProgress size={22} thickness={4} />
          <Typography variant="caption">
            {status === 'resuming' ? 'Resuming claude…' : 'Starting claude…'}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Verify the existing TerminalErrorBoundary still type-matches**

Run: `grep -n "Terminal" client/src/components/TerminalErrorBoundary.tsx | head`
Inspect: TerminalErrorBoundary should still accept `instanceId` + `cwd` + `active` + children — children type is unchanged. No edits required.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Terminal.tsx
git commit -m "$(cat <<'EOF'
refactor(terminal): reparent xterm host into a slot via SlotRegistry

Drops the `active` prop; visibility is now governed by slot presence
(slot=null → host stays in hidden pool). ResizeObserver and re-fit
fire whenever the bound slot resizes or changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: TerminalPool component

**Files:**
- Create: `client/src/components/instances/TerminalPool.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/instances/TerminalPool.tsx
import { Box } from '@mui/material';
import { Terminal } from '../Terminal.js';
import { TerminalErrorBoundary } from '../TerminalErrorBoundary.js';
import type { InstanceView } from '../../state/useInstances.js';

interface Props {
  instances: InstanceView[];
}

// Hidden, off-DOM-flow container that holds the xterm hosts for every
// instance. Reparenting into a visible slot is handled by `Terminal`.
export function TerminalPool({ instances }: Props) {
  return (
    <Box sx={{ display: 'none' }} aria-hidden>
      {instances.map((i) => (
        <TerminalErrorBoundary key={i.id} instanceId={i.id} cwd={i.cwd} active={false}>
          <Terminal instanceId={i.id} status={i.status} />
        </TerminalErrorBoundary>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/instances/TerminalPool.tsx
git commit -m "$(cat <<'EOF'
feat(instances): TerminalPool — hidden stable home for all xterm hosts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Workspace rendering

### Task 14: ColumnSlot component

**Files:**
- Create: `client/src/components/instances/ColumnSlot.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/instances/ColumnSlot.tsx
import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { useSlotRegistration } from './SlotRegistry.js';

interface Props {
  instanceId: string;
  focused: boolean;
  onFocus(): void;
}

export function ColumnSlot({ instanceId, focused, onFocus }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const register = useSlotRegistration();
  useEffect(() => {
    return register(instanceId, ref.current);
  }, [instanceId, register]);

  return (
    <Box
      ref={ref}
      onMouseDown={onFocus}
      sx={{
        position: 'relative',
        flex: 1,
        height: '100%',
        minWidth: 0,
        backgroundColor: '#0e0f12',
        outline: focused ? '2px solid' : 'none',
        outlineColor: 'primary.main',
        outlineOffset: -2,
      }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/instances/ColumnSlot.tsx
git commit -m "$(cat <<'EOF'
feat(instances): ColumnSlot — visible slot div bound to a single instance

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: LeafView (tab content with horizontal columns)

**Files:**
- Create: `client/src/components/instances/LeafView.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/instances/LeafView.tsx
import { Box, Typography } from '@mui/material';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ColumnSlot } from './ColumnSlot.js';
import { DashboardTab } from '../DashboardTab.js';
import type { TabRecord } from '../../../../shared/layout.js';
import type { InstanceView } from '../../state/useInstances.js';

interface Props {
  tab: TabRecord;
  focused: boolean;
  instances: InstanceView[];
  onFocusColumn(instanceId: string): void;
  // Dashboard-tab callbacks (only used when tab.kind === 'dashboard')
  dashboardOnOpen?(id: string): void;
  dashboardOnKill?(id: string): void;
  dashboardOnRemove?(id: string): void;
  dashboardOnNew?(): void;
}

export function LeafView({
  tab,
  focused,
  instances,
  onFocusColumn,
  dashboardOnOpen,
  dashboardOnKill,
  dashboardOnRemove,
  dashboardOnNew,
}: Props) {
  if (tab.kind === 'dashboard') {
    return (
      <Box sx={{ flex: 1, height: '100%', position: 'relative', outline: focused ? '2px solid' : 'none', outlineColor: 'primary.main', outlineOffset: -2 }}>
        <DashboardTab
          instances={instances}
          onOpen={dashboardOnOpen ?? (() => {})}
          onKill={dashboardOnKill ?? (() => {})}
          onRemove={dashboardOnRemove ?? (() => {})}
          onNew={dashboardOnNew ?? (() => {})}
        />
      </Box>
    );
  }

  if (tab.columnOrder.length === 0) {
    return (
      <Box sx={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'text.secondary', fontSize: 13,
      }}>
        <Typography variant="body2">No instances in {tab.label} yet</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, height: '100%' }}>
      <PanelGroup direction="horizontal" autoSaveId={`columns-${tab.id}`}>
        {tab.columnOrder.map((instanceId, idx) => (
          <Panel key={instanceId} defaultSize={100 / tab.columnOrder.length} minSize={10}>
            <ColumnSlot
              instanceId={instanceId}
              focused={focused && tab.focusedInstanceId === instanceId}
              onFocus={() => onFocusColumn(instanceId)}
            />
            {idx < tab.columnOrder.length - 1 && (
              <PanelResizeHandle style={{ width: 4, background: 'rgba(255,255,255,0.06)' }} />
            )}
          </Panel>
        ))}
      </PanelGroup>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/instances/LeafView.tsx
git commit -m "$(cat <<'EOF'
feat(instances): LeafView — horizontal column row for a tab + dashboard slot

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: WorkspaceNodeView recursive renderer

**Files:**
- Create: `client/src/components/instances/WorkspaceNodeView.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/instances/WorkspaceNodeView.tsx
import { Box } from '@mui/material';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { LeafView } from './LeafView.js';
import type { TabRecord, WorkspaceNode } from '../../../../shared/layout.js';
import type { InstanceView } from '../../state/useInstances.js';

interface Props {
  node: WorkspaceNode;
  tabs: TabRecord[];
  focusedLeafId: string | null;
  instances: InstanceView[];
  onFocusColumn(tabId: string, instanceId: string): void;
  onFocusLeaf(leafId: string): void;
  onResizeSplit(splitId: string, sizes: number[]): void;
  dashboardOnOpen?(id: string): void;
  dashboardOnKill?(id: string): void;
  dashboardOnRemove?(id: string): void;
  dashboardOnNew?(): void;
}

export function WorkspaceNodeView(props: Props) {
  const { node, tabs, focusedLeafId, instances, onFocusColumn, onFocusLeaf, onResizeSplit } = props;

  if (node.kind === 'leaf') {
    const tab = tabs.find((t) => t.id === node.tabId);
    if (!tab) return null;
    return (
      <Box
        onMouseDown={() => onFocusLeaf(node.id)}
        sx={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}
      >
        <LeafView
          tab={tab}
          focused={focusedLeafId === node.id}
          instances={instances}
          onFocusColumn={(instanceId) => onFocusColumn(tab.id, instanceId)}
          dashboardOnOpen={props.dashboardOnOpen}
          dashboardOnKill={props.dashboardOnKill}
          dashboardOnRemove={props.dashboardOnRemove}
          dashboardOnNew={props.dashboardOnNew}
        />
      </Box>
    );
  }

  return (
    <PanelGroup
      direction={node.dir === 'row' ? 'horizontal' : 'vertical'}
      onLayout={(sizes) => onResizeSplit(node.id, sizes)}
    >
      {node.children.map((child, i) => (
        <PanelGroupSlot
          key={child.id}
          isLast={i === node.children.length - 1}
          defaultSize={node.sizes[i] ?? 100 / node.children.length}
          dir={node.dir}
        >
          <WorkspaceNodeView {...props} node={child} />
        </PanelGroupSlot>
      ))}
    </PanelGroup>
  );
}

function PanelGroupSlot({
  isLast,
  defaultSize,
  dir,
  children,
}: {
  isLast: boolean;
  defaultSize: number;
  dir: 'row' | 'col';
  children: React.ReactNode;
}) {
  return (
    <>
      <Panel defaultSize={defaultSize} minSize={10}>
        {children}
      </Panel>
      {!isLast && (
        <PanelResizeHandle style={dir === 'row'
          ? { width: 4, background: 'rgba(255,255,255,0.08)' }
          : { height: 4, background: 'rgba(255,255,255,0.08)' }} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/instances/WorkspaceNodeView.tsx
git commit -m "$(cat <<'EOF'
feat(instances): WorkspaceNodeView — recursive renderer for leaf/split tree

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: WorkspaceRoot wiring

**Files:**
- Create: `client/src/components/instances/WorkspaceRoot.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/instances/WorkspaceRoot.tsx
import { Box } from '@mui/material';
import { WorkspaceNodeView } from './WorkspaceNodeView.js';
import type { PersistedLayout, TabRecord } from '../../../../shared/layout.js';
import type { InstanceView } from '../../state/useInstances.js';
import type { WorkspaceLayoutActions } from '../../state/useWorkspaceLayout.js';

interface Props {
  layout: PersistedLayout;
  tabs: TabRecord[];
  instances: InstanceView[];
  actions: WorkspaceLayoutActions;
  dashboardOnOpen(id: string): void;
  dashboardOnKill(id: string): void;
  dashboardOnRemove(id: string): void;
  dashboardOnNew(): void;
}

export function WorkspaceRoot({
  layout,
  tabs,
  instances,
  actions,
  dashboardOnOpen,
  dashboardOnKill,
  dashboardOnRemove,
  dashboardOnNew,
}: Props) {
  return (
    <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <WorkspaceNodeView
        node={layout.root}
        tabs={tabs}
        focusedLeafId={layout.focusedLeafId}
        instances={instances}
        onFocusColumn={actions.focusColumnInTab}
        onFocusLeaf={actions.focusLeaf}
        onResizeSplit={actions.setSplitSizes}
        dashboardOnOpen={dashboardOnOpen}
        dashboardOnKill={dashboardOnKill}
        dashboardOnRemove={dashboardOnRemove}
        dashboardOnNew={dashboardOnNew}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/instances/WorkspaceRoot.tsx
git commit -m "$(cat <<'EOF'
feat(instances): WorkspaceRoot wiring component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — TabStrip rewrite

### Task 18: Rewrite TabStrip to iterate tabs

**Files:**
- Modify: `client/src/components/TabStrip.tsx`

- [ ] **Step 1: Replace Props + body to iterate `tabs: TabRecord[]`**

Replace the existing `Props` interface and the `TabStrip` function body with the version below. Keep the `TabButton`, `SortableTab`, `dotColor`, and palette helpers from the existing file — they're reused.

```tsx
// client/src/components/TabStrip.tsx — replace Props + TabStrip export.
// (Keep existing imports + TabButton/SortableTab/INSTANCE_PALETTE/ATTENTION_COLORS/dotColor.)

import { useMemo, useState, type CSSProperties } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { InstanceView } from '../state/useInstances.js';
import type { TabRecord, TabId } from '../../../shared/layout.js';
import { DASHBOARD_TAB_ID } from '../../../shared/layout.js';

// ... keep INSTANCE_PALETTE, instanceColor(), ATTENTION_COLORS, dotColor() ...

interface Props {
  tabs: TabRecord[];
  instances: InstanceView[];
  mountedTabIds: Set<string>;      // tabs currently mounted in the workspace tree
  focusedTabId: TabId | null;      // tab whose leaf is currently focused
  onSelect(id: TabId): void;       // single click → focus or replace focused leaf
  onContextSplit(id: TabId, dir: 'row' | 'col'): void;  // "Split right" / "Split down"
  onCloseInWorkspace(id: TabId): void;
  onNew(): void;
}

export function TabStrip({
  tabs, instances, mountedTabIds, focusedTabId,
  onSelect, onContextSplit, onCloseInWorkspace, onNew,
}: Props) {
  const ids = tabs.map((t) => t.id);
  const [ctxMenu, setCtxMenu] = useState<{ id: TabId; x: number; y: number } | null>(null);

  const aggregateStatus = useMemo(() => {
    const map = new Map<TabId, string>();
    for (const t of tabs) {
      if (t.kind === 'dashboard') { map.set(t.id, 'dashboard'); continue; }
      let pick: string | null = null;
      for (const id of t.columnOrder) {
        const inst = instances.find((i) => i.id === id);
        if (!inst) continue;
        const s = inst.status;
        if (s === 'waiting-permission' || s === 'crashed') { pick = s; break; }
        if (s === 'idle-notify' && pick !== 'waiting-permission' && pick !== 'crashed') pick = s;
        if (!pick) pick = s;
      }
      map.set(t.id, pick ?? 'working');
    }
    return map;
  }, [tabs, instances]);

  return (
    <Box sx={{
      display: 'flex', alignItems: 'stretch', borderBottom: 1, borderColor: 'divider',
      backgroundColor: 'background.paper', flexShrink: 0, overflowX: 'auto', overflowY: 'hidden',
    }}>
      {/* No DndContext here — App provides one so a tab drag can also drop on workspace leaves. */}
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
            {tabs.map((t) => (
              <Box
                key={t.id}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ id: t.id, x: e.clientX, y: e.clientY }); }}
              >
                <SortableTab
                  id={t.id}
                  label={t.label}
                  status={aggregateStatus.get(t.id) ?? 'working'}
                  accent={t.color ?? undefined}
                  mounted={mountedTabIds.has(t.id)}
                  active={focusedTabId === t.id}
                  onClick={() => onSelect(t.id)}
                  onClose={t.id === DASHBOARD_TAB_ID ? undefined : () => onCloseInWorkspace(t.id)}
                />
              </Box>
            ))}
          </Box>
        </SortableContext>
      <Box sx={{ flex: 1, minWidth: 0 }} />
      <Tooltip title="New instance" placement="left">
        <IconButton onClick={onNew} size="small" sx={{ mr: 1, color: 'text.secondary', ':hover': { color: 'primary.main' } }}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        open={Boolean(ctxMenu)}
        onClose={() => setCtxMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={ctxMenu ? { left: ctxMenu.x, top: ctxMenu.y } : undefined}
      >
        <MenuItem onClick={() => { if (ctxMenu) onSelect(ctxMenu.id); setCtxMenu(null); }}>Open here</MenuItem>
        <Divider />
        <MenuItem onClick={() => { if (ctxMenu) onContextSplit(ctxMenu.id, 'row'); setCtxMenu(null); }}>Split right</MenuItem>
        <MenuItem onClick={() => { if (ctxMenu) onContextSplit(ctxMenu.id, 'col'); setCtxMenu(null); }}>Split down</MenuItem>
        <Divider />
        <MenuItem
          onClick={() => { if (ctxMenu) onCloseInWorkspace(ctxMenu.id); setCtxMenu(null); }}
          sx={{ color: 'error.main' }}
        >
          Close in workspace
        </MenuItem>
      </Menu>
    </Box>
  );
}
```

- [ ] **Step 2: Update TabButton/SortableTab to accept `mounted`**

Concrete edits to the existing `TabButton` block in `TabStrip.tsx`:

```tsx
interface TabButtonProps {
  id: string;
  label: string;
  status: string;
  active: boolean;
  draggable: boolean;
  accent?: string;
  mounted?: boolean;          // NEW — true if tab is currently mounted in the workspace
  dragRef?: (node: HTMLElement | null) => void;
  dragListeners?: React.HTMLAttributes<HTMLElement>;
  dragStyle?: CSSProperties;
  onClick(): void;
  onClose?(): void;
}

function TabButton({
  id, label, status, active, draggable, accent, mounted,
  dragRef, dragListeners, dragStyle, onClick, onClose,
}: TabButtonProps) {
  return (
    <Box
      ref={dragRef}
      onClick={onClick}
      style={dragStyle}
      {...(dragListeners ?? {})}
      role="tab"
      aria-selected={active}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, minHeight: 40, px: 1.5,
        cursor: draggable ? 'grab' : 'pointer',
        userSelect: 'none',
        color: active ? 'text.primary' : 'text.secondary',
        backgroundColor: active ? 'background.default' : 'transparent',
        borderBottom: 2,
        borderBottomColor: active
          ? (accent ?? 'primary.main')
          : (mounted ? (accent ?? 'rgba(255,255,255,0.18)') : 'transparent'),
        ':hover': { backgroundColor: active ? 'background.default' : 'action.hover' },
        ':active': { cursor: draggable ? 'grabbing' : 'pointer' },
        fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {/* …existing dot + label + close-X markup is unchanged… */}
    </Box>
  );
}
```

And in `SortableTab`, forward the new prop:

```tsx
interface SortableTabProps extends Omit<TabButtonProps, 'dragRef' | 'dragListeners' | 'dragStyle' | 'draggable'> {
  id: string;
}

function SortableTab(props: SortableTabProps) {
  // …existing useSortable / style …
  return <TabButton {...props} draggable dragRef={setNodeRef} dragListeners={{ ...attributes, ...listeners }} dragStyle={style} />;
}
```

- [ ] **Step 3: Update App.tsx call sites**

App.tsx no longer passes `activeId`, `onRemove`, `onSnooze`. Those flows move into the workspace; for now, leave Tab onClose mapped to `onCloseInWorkspace`. Spawn callers shift to the new spawn router in Phase G.

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -E "TabStrip|App\.tsx" | head`
Expect any errors here to be call-site updates in App.tsx — those will be fixed in Task 25.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TabStrip.tsx
git commit -m "$(cat <<'EOF'
refactor(tabstrip): iterate TabRecord[] with mounted/focused dual highlight

Strip now reflects the layout model: one pill per tab (project / ad-hoc /
dashboard), with multiple pills allowed to look "mounted" simultaneously
and the single focused leaf's tab getting the strong fill. Context menu
exposes Open / Split right / Split down / Close in workspace.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — Drag & drop splitting

### Task 19: Make tab pills draggable with drop-zone overlay

**Files:**
- Create: `client/src/components/instances/SplitDropZones.tsx`
- Modify: `client/src/components/TabStrip.tsx` (wrap pills in useDraggable)
- Modify: `client/src/components/instances/LeafView.tsx` (render drop zones overlay)

- [ ] **Step 1: Implement SplitDropZones**

```tsx
// client/src/components/instances/SplitDropZones.tsx
import { Box } from '@mui/material';
import { useDroppable } from '@dnd-kit/core';

interface Props {
  leafId: string;
  visible: boolean;  // only show while a tab pill is being dragged
}

const ZONES = ['centre', 'left', 'right', 'top', 'bottom'] as const;
type Zone = (typeof ZONES)[number];

export function SplitDropZones({ leafId, visible }: Props) {
  if (!visible) return null;
  return (
    <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {ZONES.map((z) => (
        <DropZone key={z} leafId={leafId} zone={z} />
      ))}
    </Box>
  );
}

function DropZone({ leafId, zone }: { leafId: string; zone: Zone }) {
  const { isOver, setNodeRef } = useDroppable({ id: `leaf:${leafId}:${zone}` });
  const style = zoneStyle(zone, isOver);
  return <Box ref={setNodeRef} sx={style} />;
}

function zoneStyle(zone: Zone, isOver: boolean) {
  const base = {
    position: 'absolute' as const,
    pointerEvents: 'auto' as const,
    backgroundColor: isOver ? 'rgba(125, 99, 255, 0.30)' : 'rgba(125, 99, 255, 0.05)',
    border: isOver ? '2px dashed rgba(255,255,255,0.6)' : '2px dashed transparent',
    transition: 'background-color 120ms',
  };
  switch (zone) {
    case 'left':   return { ...base, top: 0, left: 0, bottom: 0, width: '25%' };
    case 'right':  return { ...base, top: 0, right: 0, bottom: 0, width: '25%' };
    case 'top':    return { ...base, top: 0, left: '25%', right: '25%', height: '25%' };
    case 'bottom': return { ...base, bottom: 0, left: '25%', right: '25%', height: '25%' };
    case 'centre': return { ...base, top: '25%', left: '25%', right: '25%', bottom: '25%' };
  }
}
```

- [ ] **Step 2: Reuse the existing sortable drag source as the drag-to-split source too**

No new draggable wiring is needed in `TabStrip` itself. `SortableTab` already exposes a drag source via `useSortable`; its `id` matches the tab id pattern (`project:N` / `cwd:/x` / `__dashboard__`). The hoisted-to-App `DndContext` (Task 20) inspects `over.id` on drag-end:

- If `over.id` matches another tab id (a sortable peer) → fall through to the existing strip-reorder behaviour (calls `onReorder(arrayMove(...))`).
- If `over.id` matches the `leaf:<leafId>:<zone>` pattern → dispatch the split/replace action.

So the TabStrip code does not change in this step. Wiring of the over-id parsing happens in Task 20.

- [ ] **Step 3: Render `SplitDropZones` inside `LeafView`**

In LeafView, accept a `dragInProgress: boolean` prop; render `<SplitDropZones leafId={...} visible={dragInProgress} />` as the last child of the outer Box.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/instances/SplitDropZones.tsx client/src/components/TabStrip.tsx client/src/components/instances/LeafView.tsx
git commit -m "$(cat <<'EOF'
feat(instances): drag-tab-onto-leaf drop zones with 5 split positions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Wire drag-end to layout mutations

**Files:**
- Modify: `client/src/App.tsx` (hoist DndContext to App; handler routes to actions)

- [ ] **Step 1: Hoist a single DndContext to App**

Remove the `<DndContext sensors=… onDragEnd=…>` wrapper from inside `TabStrip` (left over from Task 18) — keep only the `<SortableContext>`. The `DndContext` now lives in `App.tsx` so a single drag can hit either another tab pill (reorder) or a leaf drop zone (split/replace).

Add this to App.tsx, wrapping the Instances-module subtree:

```tsx
import { DndContext, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

function handleDragStart(_e: DragStartEvent) {
  setDragging(true);
}

function handleDragEnd(e: DragEndEvent) {
  setDragging(false);
  const activeId = String(e.active.id);
  const overId = e.over ? String(e.over.id) : null;
  if (!overId) return;

  // Drop on a leaf zone → split or replace.
  const leafZone = /^leaf:([^:]+):(centre|left|right|top|bottom)$/.exec(overId);
  if (leafZone) {
    const [, leafId, zone] = leafZone;
    const tabId = activeId as TabId;
    if (zone === 'centre') {
      layoutActions.replaceLeafTab(leafId!, tabId);
    } else {
      const dir: 'row' | 'col' = (zone === 'left' || zone === 'right') ? 'row' : 'col';
      const position: 'before' | 'after' = (zone === 'left' || zone === 'top') ? 'before' : 'after';
      layoutActions.splitLeafAt(leafId!, dir, position, tabId);
    }
    return;
  }

  // Drop on a peer tab → reorder strip.
  if (activeId !== overId) {
    const ids = tabs.map((t) => t.id);
    const oldIdx = ids.indexOf(activeId as TabId);
    const newIdx = ids.indexOf(overId as TabId);
    if (oldIdx >= 0 && newIdx >= 0) {
      layoutActions.setTabStripOrder(arrayMove(ids, oldIdx, newIdx) as TabId[]);
    }
  }
}

// …wrap Instances pane: <DndContext sensors={dndSensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>{ … }</DndContext>
```

- [ ] **Step 2: Pass `dragInProgress` down**

Track drag state via `onDragStart` / `onDragEnd` and provide a context value or prop to LeafView so it shows drop zones only during drag.

- [ ] **Step 3: Commit**

```bash
git add client/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(app): hoist DndContext to App; route tab-drop → layout actions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase G — Spawn routing + App integration

### Task 21: Spawn routing helper used by all entry points

**Files:**
- Create: `client/src/state/spawnIntoTab.ts`

- [ ] **Step 1: Implement**

```ts
// client/src/state/spawnIntoTab.ts
import type { TabId, WorkspaceNode, PersistedLayout } from '../../../shared/layout.js';
import type { WorkspaceLayoutActions } from './useWorkspaceLayout.js';
import { findLeafByTabId } from '../layout/workspaceTreeOps.js';

export interface RouteContext {
  layout: PersistedLayout;
  actions: WorkspaceLayoutActions;
}

/**
 * Ensure the given tab is mounted somewhere in the workspace tree and focused.
 * If not mounted, replaces the focused leaf's tabId with it.
 * Returns the leaf id where this tab is now mounted.
 */
export function ensureTabMountedAndFocused(ctx: RouteContext, tabId: TabId): string | null {
  const existing = findLeafByTabId(ctx.layout.root, tabId);
  if (existing) {
    ctx.actions.focusLeaf(existing.id);
    return existing.id;
  }
  const focusedLeafId = ctx.layout.focusedLeafId;
  if (!focusedLeafId) return null;
  ctx.actions.replaceLeafTab(focusedLeafId, tabId);
  return focusedLeafId;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/state/spawnIntoTab.ts
git commit -m "$(cat <<'EOF'
feat(state): ensureTabMountedAndFocused — spawn routing helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: Integrate everything into App.tsx

**Files:**
- Modify: `client/src/App.tsx`

This is the biggest visual change. Replace the Instances-module subtree that currently renders `<TabStrip />` + the per-instance Terminal map with `<TabStrip>` + `<WorkspaceRoot>` + `<TerminalPool>`. Wire up:

- [ ] **Step 1: Add new imports + state**

```tsx
import { useState, useMemo } from 'react';
import {
  DndContext, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useTabs } from './state/useTabs.js';
import { useWorkspaceLayout } from './state/useWorkspaceLayout.js';
import { useFocusedInstance } from './state/useFocusedInstance.js';
import { SlotRegistryProvider } from './components/instances/SlotRegistry.js';
import { TerminalPool } from './components/instances/TerminalPool.js';
import { WorkspaceRoot } from './components/instances/WorkspaceRoot.js';
import { routeSpawnToTab } from './layout/routeSpawnToTab.js';
import { ensureTabMountedAndFocused } from './state/spawnIntoTab.js';
import { collectTabIds, findLeafById, findLeafByTabId } from './layout/workspaceTreeOps.js';
import type { TabId } from '../../shared/layout.js';

// inside App():
const [openAdHocCwds, setOpenAdHocCwds] = useState<Set<string>>(new Set());
const [dragging, setDragging] = useState(false);
const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

// useProjects is already mounted above — keep it.
const { projects } = useProjects();

const { loaded: layoutLoaded, layout, actions: layoutActions } = useWorkspaceLayout();
const tabs = useTabs(instances, projects, openAdHocCwds, layout.tabFocus);
useFocusedInstance(layout, tabs);

// Prune the layout once after both hydration completes and tabs first derive.
// Any leaves whose tabId no longer exists (deleted project, etc.) are dropped
// and orphan splits flatten. Subsequent edits don't need re-pruning — they're
// guarded by the action set.
const pruneDoneRef = useRef(false);
useEffect(() => {
  if (!layoutLoaded || pruneDoneRef.current) return;
  const validTabIds = new Set(tabs.map((t) => t.id));
  const pruned = pruneLayout(layout.root, validTabIds);
  if (pruned !== layout.root) layoutActions.replaceTree(pruned);
  pruneDoneRef.current = true;
  // depend only on layoutLoaded — we want a single prune pass, not a re-prune
  // on every tab change (mutations clean up themselves).
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [layoutLoaded]);

const mountedTabIds = useMemo(() => new Set(collectTabIds(layout.root)), [layout.root]);
const focusedTab: TabId | null = useMemo(() => {
  if (!layout.focusedLeafId) return null;
  const node = findLeafById(layout.root, layout.focusedLeafId);
  return node ? node.tabId : null;
}, [layout]);
```

Additional imports for this step:

```tsx
import { useRef, useEffect } from 'react';
import { pruneLayout } from './layout/pruneLayout.js';
```

- [ ] **Step 2: Update doSpawn to route into tabs**

```tsx
const doSpawn = async (cwd: string) => {
  try {
    // Route first so the leaf exists before pty data arrives.
    const tabId = routeSpawnToTab(cwd, projects);
    if (tabId.startsWith('cwd:')) setOpenAdHocCwds((s) => new Set(s).add(cwd));
    ensureTabMountedAndFocused({ layout, actions: layoutActions }, tabId);
    const res = await spawn(cwd);
    if (res.instanceId) {
      // Focus the new column inside its tab.
      layoutActions.focusColumnInTab(tabId, res.instanceId);
      setActiveModule('instances');
    } else {
      setSpawnError(res.error ?? 'spawn failed — no instance id returned');
    }
  } catch (err) {
    setSpawnError(err instanceof Error ? err.message : String(err));
  }
};
```

- [ ] **Step 3: Replace the Instances pane**

Replace the existing `<TabStrip />` + per-instance Terminal map (App.tsx:284–340) with:

```tsx
<SlotRegistryProvider>
  <DndContext sensors={dndSensors} onDragStart={() => setDragging(true)} onDragEnd={handleDragEnd}>
    <TabStrip
      tabs={tabs}
      instances={instances}
      mountedTabIds={mountedTabIds}
      focusedTabId={focusedTab}
      onSelect={(id) => ensureTabMountedAndFocused({ layout, actions: layoutActions }, id)}
      onContextSplit={(id, dir) => layout.focusedLeafId && layoutActions.splitLeafAt(layout.focusedLeafId, dir, 'after', id)}
      onCloseInWorkspace={(id) => {
        const node = findLeafByTabId(layout.root, id);
        if (node) layoutActions.unmountLeafAt(node.id);
      }}
      onNew={() => setNewOpen(true)}
    />
    {layoutLoaded && (
      <WorkspaceRoot
        layout={layout}
        tabs={tabs}
        instances={instances}
        actions={layoutActions}
        dashboardOnOpen={(id) => {
          // open the tab whose project owns this instance, then focus column
          const inst = instances.find((i) => i.id === id);
          if (!inst) return;
          const tabId = routeSpawnToTab(inst.cwd, projects);
          ensureTabMountedAndFocused({ layout, actions: layoutActions }, tabId);
          layoutActions.focusColumnInTab(tabId, id);
        }}
        dashboardOnKill={(id) => void remove(id)}
        dashboardOnRemove={(id) => void remove(id)}
        dashboardOnNew={() => setNewOpen(true)}
      />
    )}
    <TerminalPool instances={instances} />
  </DndContext>
</SlotRegistryProvider>
```

Drop the previously-passed `activeId` / `onRemove` / `onSnooze` props — those flows now live inside `layoutActions` + dashboard callbacks.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -E "^client/src/App\.tsx" | head`
Expected: no errors *from App.tsx* (pre-existing drift listed in CLAUDE.md is fine).

- [ ] **Step 5: Run full vitest suite**

Run: `npm test 2>&1 | tail -10`
Expected: all tests pass (including the new layout tests).

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`
- The app launches with the dashboard tab visible.
- Spawn an instance from the dashboard or `+` button → a column appears in the matching tab.
- Right-click a tab in the strip → "Split right" with another tab → two tabs visible side-by-side.
- Drag a tab pill onto a leaf's right edge → split.
- Drag a column separator → columns resize.
- Drag a workspace separator → tabs resize.
- Close all columns in a tab → tab disappears from strip; leaf collapses.
- Quit and relaunch → layout restores.

- [ ] **Step 7: Commit**

```bash
git add client/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(app): mount Instances module on the workspace tree + tab routing

Replaces the single-active Instances pane with TabStrip+WorkspaceRoot
backed by useWorkspaceLayout, plus a hidden TerminalPool that keeps all
xterm hosts alive across layout mutations. Spawn flows route through
routeSpawnToTab → ensureTabMountedAndFocused so a new column always
lands in its project's tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase H — Polish

### Task 23: Column reorder inside ColumnsRow

**Files:**
- Modify: `client/src/components/instances/LeafView.tsx`

- [ ] **Step 1: Wrap the columns map in a `SortableContext`**

Inside the project / cwd branch of LeafView, wrap `tab.columnOrder.map(…)` in `<SortableContext items={tab.columnOrder} strategy={horizontalListSortingStrategy}>` so each column becomes a sortable. On dragEnd, compute `arrayMove(columnOrder, oldIdx, newIdx)` and call `window.watchtower.invoke('reorderInstances', { orderedIds: <full ordering of all instances with the new column order spliced in> })`. The simplest correct call: re-emit the entire instances list ordered as `[tab1 columns…, tab2 columns…, …]` so the global `display_order` keeps each tab's columns contiguous.

- [ ] **Step 2: Commit**

```bash
git add client/src/components/instances/LeafView.tsx
git commit -m "$(cat <<'EOF'
feat(instances): drag-reorder columns within a tab via display_order

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: Persist column sizes per tab via PanelGroup autoSaveId

**Files:** none — already set in Task 15 (`autoSaveId={`columns-${tab.id}`}`). Verify:

- [ ] **Step 1: Verify size persistence works through reloads**

Run: `npm run dev`, drag column separators, quit, relaunch.
Expected: column widths restore (handled by react-resizable-panels' built-in autoSave).

- [ ] **Step 2: No commit needed** (no code change).

---

### Task 25: Final typecheck + full test run

- [ ] **Step 1: Typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npx tsc -p client/tsconfig.json --noEmit 2>&1 | grep -vE "(SettingsPanel|HooksTab|McpTab|SettingsJsonTab|SkillsTab|main\.tsx|dev/|useThemeMode|useInstances\.ts\(131|BoardTab\.tsx\(200|EpicDrawer)" | head`
Expected: only pre-existing drift documented in CLAUDE.md. No errors in the files this plan touched.

- [ ] **Step 2: Run full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: all tests pass.

- [ ] **Step 3: Commit any final fixes (if needed)**

```bash
git add -p
git commit -m "$(cat <<'EOF'
chore(layout): final cleanup post-integration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **Tests are mandatory** for the pure-function tasks (1–6 + 8). They lock in semantics; the component tasks rely on those guarantees.
- **xterm reparenting** (Task 12) is the highest-risk piece. Verify by mounting two tabs side-by-side, typing in each in turn, and watching that both buffers persist after closing/reopening one tab.
- **CLAUDE.md drift**: don't fix the `slotProps` / `dev/` rootDir / `useInstances.spawn` errors. They're explicitly out of scope.
- **No new IPC kinds.** If a task seems to need one, re-check — the design intentionally rides on `getSetting` / `setSetting`.
- **Frequent commits**: each task ends with a commit. Use the suggested messages; keep them small.
