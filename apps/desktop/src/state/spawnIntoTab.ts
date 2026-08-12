import type { PersistedLayout, TabId } from '@watchtower/shared/layout.js';
import type { WorkspaceLayoutActions } from './useWorkspaceLayout.js';
import { findLeafByTabId } from '@watchtower/shared/workspaceTreeOps.js';
import { routeSpawnToTab } from '../layout/routeSpawnToTab.js';

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

export interface LaunchedSession {
  instanceId: string;
  /** The session's cwd — for a PR-implement session, its worktree. */
  cwd: string;
  projects: { id: number; folderPath: string | null }[];
}

export interface LaunchedSessionEffects {
  /**
   * Force-show the cwd's tab until its instance row reaches the renderer.
   * Without it the freshly-mounted leaf has no tab in `deriveTabs` output and
   * the reactive layout prune unmounts it again.
   */
  addAdHocCwd(cwd: string): void;
  showInstances(): void;
  activateInstance(id: string): void;
}

/**
 * Reveal a session the *orchestrator* created (Reviews → "Fix with agent"), as
 * opposed to one spawned through `doSpawn`. Same four steps `doSpawn` does after
 * its spawn resolves — register the ad-hoc cwd, mount + focus the tab, focus the
 * column, activate — because switching module and setting `activeId` alone
 * leaves the workspace rendering whichever tab was mounted before, i.e. looking
 * like the launch never happened.
 */
export function focusLaunchedSession(
  ctx: RouteContext,
  session: LaunchedSession,
  effects: LaunchedSessionEffects,
): void {
  const tabId = routeSpawnToTab(session.cwd, session.projects);
  if (tabId.startsWith('cwd:')) effects.addAdHocCwd(session.cwd);
  ensureTabMountedAndFocused(ctx, tabId);
  ctx.actions.focusColumnInTab(tabId, session.instanceId);
  effects.showInstances();
  effects.activateInstance(session.instanceId);
}
