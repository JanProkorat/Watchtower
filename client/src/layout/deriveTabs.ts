import type { InstanceView } from '../state/useInstances.js';
import type { ProjectViewPayload } from '../../../shared/ipcContract.js';
import { DASHBOARD_TAB_ID, type TabId, type TabRecord } from '../../../shared/layout.js';
import { cwdTabId, projectTabId } from './tabId.js';

export function deriveTabs(
  instances: InstanceView[],
  projects: ProjectViewPayload[],
  openAdHocCwds: Set<string>,
  tabFocus: Record<string, string | null>,
  hiddenInstanceIds: Set<string> = new Set(),
): TabRecord[] {
  // Build cwd → projectId map for routing.
  const cwdToProjectId = new Map<string, number>();
  for (const p of projects) {
    if (p.folderPath) cwdToProjectId.set(p.folderPath, p.id);
  }

  // Group instances by tabId. We keep visible columns and hidden ids in
  // separate buckets so the UI can render a "show hidden" affordance.
  const visible = new Map<TabId, string[]>();
  const hidden = new Map<TabId, string[]>();
  for (const i of instances) {
    const projectId = cwdToProjectId.get(i.cwd);
    const tabId: TabId = projectId !== undefined ? projectTabId(projectId) : cwdTabId(i.cwd);
    const bucket = hiddenInstanceIds.has(i.id) ? hidden : visible;
    const list = bucket.get(tabId) ?? [];
    list.push(i.id);
    bucket.set(tabId, list);
  }

  // Always include cwd tabs the user has opened ad-hoc, even empty.
  for (const cwd of openAdHocCwds) {
    const id = cwdTabId(cwd);
    if (!visible.has(id)) visible.set(id, []);
  }

  // Any tab id that has only-hidden instances should also be in `visible`
  // (with an empty array) so it still appears in the strip — otherwise
  // hiding the last visible session would make the tab vanish.
  for (const id of hidden.keys()) {
    if (!visible.has(id)) visible.set(id, []);
  }

  const records: TabRecord[] = [];

  // Dashboard first.
  records.push({
    id: DASHBOARD_TAB_ID,
    kind: 'dashboard',
    label: 'Dashboard',
    color: null,
    columnOrder: [],
    hiddenInstanceIds: [],
    focusedInstanceId: null,
  });

  // Project tabs (sorted by project id for determinism — caller can re-order).
  const sortedProjects = [...projects].sort((a, b) => a.id - b.id);
  for (const p of sortedProjects) {
    const id = projectTabId(p.id);
    const cols = visible.get(id);
    if (!cols) continue;
    const hiddenCols = hidden.get(id) ?? [];
    records.push({
      id,
      kind: 'project',
      label: p.name,
      color: p.color,
      columnOrder: cols,
      hiddenInstanceIds: hiddenCols,
      focusedInstanceId: pickFocused(tabFocus[id] ?? null, cols),
    });
    visible.delete(id);
  }

  // Remaining ad-hoc cwd tabs.
  for (const [id, cols] of visible) {
    if (id === DASHBOARD_TAB_ID) continue;
    const hiddenCols = hidden.get(id) ?? [];
    records.push({
      id,
      kind: 'cwd',
      label: basenameOf(id.slice('cwd:'.length)),
      color: null,
      columnOrder: cols,
      hiddenInstanceIds: hiddenCols,
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
