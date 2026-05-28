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
  if (newChildren.length === 1) return newChildren[0]!;
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
