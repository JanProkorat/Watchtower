import {
  DASHBOARD_TAB_ID,
  type CwdTabId,
  type DashboardTabId,
  type ProjectTabId,
  type TabId,
} from '@watchtower/shared/layout.js';

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
  return { kind: 'cwd', cwd: id.slice('cwd:'.length) };
}
