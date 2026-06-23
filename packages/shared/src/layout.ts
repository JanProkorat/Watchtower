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
  columnOrder: string[]; // instance IDs, left → right (hidden ones excluded)
  hiddenInstanceIds: string[]; // instances belonging to this tab the user hid
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
  hiddenInstanceIds: 'layout.hiddenInstanceIds',
} as const;
