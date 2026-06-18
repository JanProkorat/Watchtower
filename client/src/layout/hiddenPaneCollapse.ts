import type { NodeId, TabId, WorkspaceNode } from '../../../shared/layout.js';
import { collectTabIds, findLeafByTabId } from './workspaceTreeOps.js';

/**
 * Decide whether hiding the last visible session in `tabId`'s pane should
 * collapse that pane out of the workspace tree.
 *
 * Returns the leaf id to unmount, or null to leave the layout untouched.
 *
 * We only collapse when the pane is part of a split (the tree holds more than
 * one leaf). A sole pane keeps its "all hidden" placeholder so the in-pane
 * "N hidden" tray stays reachable — collapsing it would drop the user to the
 * dashboard fallback with no obvious pane to click back into. In a split the
 * placeholder is just dead space the siblings should reclaim; the tab itself
 * stays in the strip (deriveTabs keeps hidden-only tabs) so it can be re-opened.
 */
export function leafToCollapseOnHide(
  root: WorkspaceNode,
  tabId: TabId,
): NodeId | null {
  if (collectTabIds(root).length <= 1) return null;
  return findLeafByTabId(root, tabId)?.id ?? null;
}
