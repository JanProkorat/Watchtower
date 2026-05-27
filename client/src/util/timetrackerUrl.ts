/**
 * URL-hash routing for the TimeTracker module.
 *
 * Hash format:
 *   #timetracker/projects           — Projects tab, no project selected
 *   #timetracker/projects/<id>      — Projects tab, project <id> selected
 *   #timetracker/worklogs           — Worklogs tab
 *   #timetracker/grid               — Task grid tab
 *   #timetracker/timeoff            — Time off tab
 *   #timetracker/reports            — Reports tab
 *   #timetracker/board              — Board tab
 *
 * Parsing is strict: an unknown tab or non-numeric project id returns null
 * and the caller falls back to the default landing (Projects, no selection).
 */

export const LIST_TABS = ['projects', 'worklogs', 'grid', 'timeoff', 'reports', 'board'] as const;
export type ListTab = (typeof LIST_TABS)[number];

/**
 * Single, flat view shape. `projectId` is only meaningful when
 * `tab === 'projects'`; other tabs ignore it (the helpers below keep it
 * `null` for those tabs as a normalisation).
 */
export interface TimeTrackerView {
  tab: ListTab;
  /** Only valid when tab === 'projects'. */
  projectId: number | null;
}

export const DEFAULT_VIEW: TimeTrackerView = { tab: 'projects', projectId: null };

function isListTab(s: string | undefined): s is ListTab {
  return s !== undefined && (LIST_TABS as readonly string[]).includes(s);
}

/** Strip the leading '#' if present. */
function trimHash(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

export function parseTimeTrackerHash(hash: string): TimeTrackerView | null {
  const trimmed = trimHash(hash);
  if (!trimmed.startsWith('timetracker/')) return null;
  const parts = trimmed.slice('timetracker/'.length).split('/');

  // Projects can optionally carry a project id: /projects[/<id>]
  if (parts[0] === 'projects') {
    if (parts.length === 1) return { tab: 'projects', projectId: null };
    if (parts.length === 2) {
      const projectId = Number(parts[1]);
      if (!Number.isFinite(projectId) || !Number.isInteger(projectId) || projectId <= 0) {
        return null;
      }
      return { tab: 'projects', projectId };
    }
    return null;
  }

  if (parts.length === 1 && isListTab(parts[0])) {
    return { tab: parts[0], projectId: null };
  }

  return null;
}

export function timetrackerHash(view: TimeTrackerView): string {
  if (view.tab === 'projects' && view.projectId !== null) {
    return `#timetracker/projects/${view.projectId}`;
  }
  return `#timetracker/${view.tab}`;
}

/** Convenience equality so callers can avoid redundant history.pushState. */
export function viewsEqual(a: TimeTrackerView, b: TimeTrackerView): boolean {
  if (a.tab !== b.tab) return false;
  // projectId only matters on the projects tab.
  if (a.tab === 'projects') return a.projectId === b.projectId;
  return true;
}
