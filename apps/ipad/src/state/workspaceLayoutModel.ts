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
