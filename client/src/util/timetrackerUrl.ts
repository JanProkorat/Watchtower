/**
 * URL-hash routing for the TimeTracker module.
 *
 * Hash format:
 *   #timetracker/projects                       — list mode, Projects tab
 *   #timetracker/worklogs                       — list mode, Worklogs tab
 *   #timetracker/grid                           — list mode, Task grid tab
 *   #timetracker/timeoff                        — list mode, Time off tab
 *   #timetracker/reports                        — list mode, Reports tab
 *   #timetracker/detail/<projectId>/epics       — detail mode, Epics & Tasks tab
 *   #timetracker/detail/<projectId>/worklogs    — detail mode, Worklogs tab
 *   #timetracker/detail/<projectId>/contracts   — detail mode, Contracts tab
 *
 * Parsing is strict: an unknown tab or non-numeric project id returns null and
 * the caller falls back to the default landing (list mode, Projects tab).
 */

export const LIST_TABS = ['projects', 'worklogs', 'grid', 'timeoff', 'reports'] as const;
export type ListTab = (typeof LIST_TABS)[number];

export const DETAIL_TABS = ['epics', 'worklogs', 'contracts'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export type TimeTrackerView =
  | { mode: 'list'; tab: ListTab }
  | { mode: 'detail'; projectId: number; tab: DetailTab };

export const DEFAULT_VIEW: TimeTrackerView = { mode: 'list', tab: 'projects' };

function isListTab(s: string | undefined): s is ListTab {
  return s !== undefined && (LIST_TABS as readonly string[]).includes(s);
}

function isDetailTab(s: string | undefined): s is DetailTab {
  return s !== undefined && (DETAIL_TABS as readonly string[]).includes(s);
}

/** Strip the leading '#' if present. */
function trimHash(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

export function parseTimeTrackerHash(hash: string): TimeTrackerView | null {
  const trimmed = trimHash(hash);
  if (!trimmed.startsWith('timetracker/')) return null;
  const parts = trimmed.slice('timetracker/'.length).split('/');

  if (parts[0] === 'detail') {
    // detail/<projectId>/<tab>
    if (parts.length !== 3) return null;
    const projectId = Number(parts[1]);
    if (!Number.isFinite(projectId) || !Number.isInteger(projectId) || projectId <= 0) {
      return null;
    }
    if (!isDetailTab(parts[2])) return null;
    return { mode: 'detail', projectId, tab: parts[2] };
  }

  if (parts.length === 1 && isListTab(parts[0])) {
    return { mode: 'list', tab: parts[0] };
  }

  return null;
}

export function timetrackerHash(view: TimeTrackerView): string {
  if (view.mode === 'list') return `#timetracker/${view.tab}`;
  return `#timetracker/detail/${view.projectId}/${view.tab}`;
}

/** Convenience equality so callers can avoid redundant history.pushState. */
export function viewsEqual(a: TimeTrackerView, b: TimeTrackerView): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === 'list' && b.mode === 'list') return a.tab === b.tab;
  if (a.mode === 'detail' && b.mode === 'detail') {
    return a.projectId === b.projectId && a.tab === b.tab;
  }
  return false;
}
