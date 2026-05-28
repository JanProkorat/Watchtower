import type { PersistedLayout, TabId } from '../../../shared/layout.js';
import type { WorkspaceLayoutActions } from './useWorkspaceLayout.js';
import { findLeafByTabId } from '../layout/workspaceTreeOps.js';

export interface RouteContext {
  layout: PersistedLayout;
  actions: WorkspaceLayoutActions;
}

/**
 * Ensure `tabId` is mounted somewhere in the workspace tree and focus its leaf.
 * If not already mounted, replaces the focused leaf's tabId with this one.
 * Returns the leaf id where this tab is now mounted, or null if there's no
 * focusable leaf to mount into.
 */
export function ensureTabMountedAndFocused(
  ctx: RouteContext,
  tabId: TabId,
): string | null {
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
