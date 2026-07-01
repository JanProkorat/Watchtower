import { DASHBOARD_TAB_ID, type TabId, type WorkspaceNode } from '@watchtower/shared/layout.js';
import { leaf } from '@watchtower/shared/workspaceTreeOps.js';
import { newNodeId } from '@watchtower/shared/newNodeId.js';

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
