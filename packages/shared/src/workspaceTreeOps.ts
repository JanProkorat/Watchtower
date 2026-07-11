import type {
  NodeId,
  TabId,
  WorkspaceLeaf,
  WorkspaceNode,
  WorkspaceSplit,
} from './layout.js';
import { newNodeId } from './newNodeId.js';

export function leaf<TLeaf = TabId>(id: NodeId, tabId: TLeaf): WorkspaceLeaf<TLeaf> {
  return { kind: 'leaf', id, tabId };
}

export function split<TLeaf = TabId>(
  id: NodeId,
  dir: 'row' | 'col',
  children: WorkspaceNode<TLeaf>[],
  sizes?: number[],
): WorkspaceSplit<TLeaf> {
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
  arr[arr.length - 1] = +(100 - s * (n - 1)).toFixed(4);
  return arr;
}

export function findLeafById<TLeaf = TabId>(node: WorkspaceNode<TLeaf>, id: NodeId): WorkspaceLeaf<TLeaf> | null {
  if (node.kind === 'leaf') return node.id === id ? node : null;
  for (const child of node.children) {
    const hit = findLeafById(child, id);
    if (hit) return hit;
  }
  return null;
}

export function findLeafByTabId<TLeaf = TabId>(node: WorkspaceNode<TLeaf>, tabId: TLeaf): WorkspaceLeaf<TLeaf> | null {
  if (node.kind === 'leaf') return node.tabId === tabId ? node : null;
  for (const child of node.children) {
    const hit = findLeafByTabId(child, tabId);
    if (hit) return hit;
  }
  return null;
}

export function firstLeafInPreOrder<TLeaf = TabId>(node: WorkspaceNode<TLeaf>): WorkspaceLeaf<TLeaf> | null {
  if (node.kind === 'leaf') return node;
  for (const child of node.children) {
    const hit = firstLeafInPreOrder(child);
    if (hit) return hit;
  }
  return null;
}

export function collectTabIds<TLeaf = TabId>(node: WorkspaceNode<TLeaf>): TLeaf[] {
  if (node.kind === 'leaf') return [node.tabId];
  return node.children.flatMap(collectTabIds);
}

export function replaceLeafTab<TLeaf = TabId>(
  node: WorkspaceNode<TLeaf>,
  leafId: NodeId,
  newTabId: TLeaf,
): WorkspaceNode<TLeaf> {
  if (node.kind === 'leaf') {
    return node.id === leafId ? { ...node, tabId: newTabId } : node;
  }
  return {
    ...node,
    children: node.children.map((c) => replaceLeafTab(c, leafId, newTabId)),
  };
}

export type SplitPosition = 'before' | 'after';

function containsTabId<TLeaf>(node: WorkspaceNode<TLeaf>, tabId: TLeaf): boolean {
  if (node.kind === 'leaf') return node.tabId === tabId;
  return node.children.some((c) => containsTabId(c, tabId));
}

export function splitLeaf<TLeaf = TabId>(
  node: WorkspaceNode<TLeaf>,
  targetLeafId: NodeId,
  dir: 'row' | 'col',
  position: SplitPosition,
  newTabId: TLeaf,
): WorkspaceNode<TLeaf> {
  // Mounting the same tab in two leaves collides on the xterm slot
  // registry (the host can only attach to one DOM node), so the second
  // leaf would steal the terminal and leave the first blank. Refuse.
  if (containsTabId(node, newTabId)) return node;
  return splitLeafInner(node, targetLeafId, dir, position, newTabId);
}

function splitLeafInner<TLeaf>(
  node: WorkspaceNode<TLeaf>,
  targetLeafId: NodeId,
  dir: 'row' | 'col',
  position: SplitPosition,
  newTabId: TLeaf,
): WorkspaceNode<TLeaf> {
  if (node.kind === 'leaf') {
    if (node.id !== targetLeafId) return node;
    const newLeaf = leaf(newNodeId(), newTabId);
    const children = position === 'before' ? [newLeaf, node] : [node, newLeaf];
    return split(newNodeId(), dir, children);
  }
  return {
    ...node,
    children: node.children.map((c) =>
      splitLeafInner(c, targetLeafId, dir, position, newTabId),
    ),
  };
}

export function unmountLeaf<TLeaf = TabId>(node: WorkspaceNode<TLeaf>, leafId: NodeId): WorkspaceNode<TLeaf> | null {
  if (node.kind === 'leaf') {
    return node.id === leafId ? null : node;
  }
  const newChildren: WorkspaceNode<TLeaf>[] = [];
  for (const c of node.children) {
    const after = unmountLeaf(c, leafId);
    if (after) newChildren.push(after);
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0]!;
  return {
    ...node,
    children: newChildren,
    sizes: evenSizes(newChildren.length),
  };
}

export function setSizes<TLeaf = TabId>(
  node: WorkspaceNode<TLeaf>,
  splitId: NodeId,
  sizes: number[],
): WorkspaceNode<TLeaf> {
  if (node.kind === 'leaf') return node;
  if (node.id === splitId) {
    return { ...node, sizes };
  }
  return {
    ...node,
    children: node.children.map((c) => setSizes(c, splitId, sizes)),
  };
}
