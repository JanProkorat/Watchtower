import type { NodeId, WorkspaceNode } from '@watchtower/shared/layout.js';
import {
  leaf, split, splitLeaf, unmountLeaf, setSizes, replaceLeafTab,
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

/**
 * Default layout for a tab with no saved layout: tile ALL the group's live
 * instances in a row (even widths), focusing `focusedInstanceId` if present
 * (else the first). This is why reconnecting/relaunching shows every running
 * instance instead of just one. Leaf ids are deterministic (`d-<instanceId>`)
 * so the layout is stable across renders (no xterm remount) and matches the
 * copy `ensureTab` seeds into state.
 */
export function tiledDefaultLayout(instanceIds: string[], focusedInstanceId: string): TabLayout {
  const ids = instanceIds.length > 0 ? instanceIds : [focusedInstanceId];
  if (ids.length === 1) {
    const root = leaf<string>(`d-${ids[0]}`, ids[0]!);
    return { root, focusedLeafId: root.id };
  }
  const children = ids.map((id) => leaf<string>(`d-${id}`, id));
  const root = split<string>('d-root', 'row', children); // even sizes
  const focused = children.find((c) => c.tabId === focusedInstanceId) ?? children[0]!;
  return { root, focusedLeafId: focused.id };
}

export function defaultTabLayout(instanceId: string): TabLayout {
  // Deterministic leaf id (not newNodeId()): an unstored tab's default layout
  // is rebuilt inline on every render by useWorkspaceLayout.getTabLayout, so a
  // random id would change each render, flip WorkspacePane's key={leafId}, and
  // remount the xterm — defeating the "terminals never remount" invariant. A
  // stable id keyed by the instance keeps the default pane mounted until a real
  // (persisted) mutation replaces it. New leaves from splits still use
  // newNodeId(); 'd-' vs 'n' prefixes can't collide.
  const root = leaf<string>(`d-${instanceId}`, instanceId);
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

/**
 * Add `instanceId` as a new pane on the FAR RIGHT and even out the widths, so a
 * newly-spawned instance lands rightmost and every pane takes an equal share
 * (2 -> halves, 3 -> thirds, ...). If the root is already a row split we append
 * to it and re-even its sizes; otherwise (a single leaf, or a column split) we
 * wrap the current root in a new row split with the new pane on the right.
 * Refuses (returns unchanged) if the instance is already mounted.
 */
export function appendPaneRight(layout: TabLayout, instanceId: string): TabLayout {
  if (mountedInstanceIds(layout).includes(instanceId)) return layout;
  const newLeaf = leaf<string>(newNodeId(), instanceId);
  const root: PaneTree =
    layout.root.kind === 'split' && layout.root.dir === 'row'
      ? split<string>(layout.root.id, 'row', [...layout.root.children, newLeaf]) // re-evens sizes
      : split<string>(newNodeId(), 'row', [layout.root, newLeaf]); // wrap: 50/50
  return { root, focusedLeafId: newLeaf.id };
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
