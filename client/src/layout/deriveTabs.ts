import type { InstanceView } from '../state/useInstances.js';
import type { ProjectViewPayload } from '../../../shared/ipcContract.js';
import { DASHBOARD_TAB_ID, type TabId, type TabRecord } from '../../../shared/layout.js';
import { cwdTabId, projectTabId } from './tabId.js';

export function deriveTabs(
  instances: InstanceView[],
  projects: ProjectViewPayload[],
  openAdHocCwds: Set<string>,
  tabFocus: Record<string, string | null>,
): TabRecord[] {
  // Build cwd → projectId map for routing.
  const cwdToProjectId = new Map<string, number>();
  for (const p of projects) {
    if (p.folderPath) cwdToProjectId.set(p.folderPath, p.id);
  }

  // Group instances by tabId.
  const groups = new Map<TabId, string[]>();
  for (const i of instances) {
    const projectId = cwdToProjectId.get(i.cwd);
    const tabId: TabId = projectId !== undefined ? projectTabId(projectId) : cwdTabId(i.cwd);
    const list = groups.get(tabId) ?? [];
    list.push(i.id);
    groups.set(tabId, list);
  }

  // Always include project tabs the user has opened ad-hoc, even empty.
  for (const cwd of openAdHocCwds) {
    const id = cwdTabId(cwd);
    if (!groups.has(id)) groups.set(id, []);
  }

  const records: TabRecord[] = [];

  // Dashboard first.
  records.push({
    id: DASHBOARD_TAB_ID,
    kind: 'dashboard',
    label: 'Dashboard',
    color: null,
    columnOrder: [],
    focusedInstanceId: null,
  });

  // Project tabs (sorted by project id for determinism — caller can re-order).
  const sortedProjects = [...projects].sort((a, b) => a.id - b.id);
  for (const p of sortedProjects) {
    const id = projectTabId(p.id);
    const cols = groups.get(id);
    if (!cols) continue;
    records.push({
      id,
      kind: 'project',
      label: p.name,
      color: p.color,
      columnOrder: cols,
      focusedInstanceId: pickFocused(tabFocus[id] ?? null, cols),
    });
    groups.delete(id);
  }

  // Remaining ad-hoc cwd tabs.
  for (const [id, cols] of groups) {
    if (id === DASHBOARD_TAB_ID) continue;
    records.push({
      id,
      kind: 'cwd',
      label: basenameOf(id.slice('cwd:'.length)),
      color: null,
      columnOrder: cols,
      focusedInstanceId: pickFocused(tabFocus[id] ?? null, cols),
    });
  }

  return records;
}

function pickFocused(saved: string | null, cols: string[]): string | null {
  if (saved && cols.includes(saved)) return saved;
  return cols[0] ?? null;
}

function basenameOf(cwd: string): string {
  if (!cwd) return cwd;
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}
