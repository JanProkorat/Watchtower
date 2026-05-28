/**
 * URL-hash routing for the Billing module (formerly TimeTracker).
 *
 * Canonical hash format:
 *   #billing/projects               — Projects tab, no project selected
 *   #billing/projects/<id>          — Projects tab, project <id> selected
 *   #billing/worklogs               — Worklogs tab
 *   #billing/grid                   — Task grid tab
 *   #billing/timeoff                — Time off tab
 *   #billing/reports                — Reports tab
 *   #billing/board                  — Board tab
 *
 * Parsing accepts both `#billing/...` and the legacy `#timetracker/...`
 * prefix so old bookmarks / persisted state keep working; serialisation
 * always emits the canonical `#billing/...` form. An unknown tab or
 * non-numeric project id returns null and the caller falls back to the
 * default landing (Projects, no selection).
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
  let body: string;
  if (trimmed.startsWith('billing/')) {
    body = trimmed.slice('billing/'.length);
  } else if (trimmed.startsWith('timetracker/')) {
    // Legacy prefix — keep accepting so existing localStorage entries +
    // bookmarks survive the rename. Serialisation always emits the new form.
    body = trimmed.slice('timetracker/'.length);
  } else {
    return null;
  }
  const parts = body.split('/');

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
    return `#billing/projects/${view.projectId}`;
  }
  return `#billing/${view.tab}`;
}

/** Convenience equality so callers can avoid redundant history.pushState. */
export function viewsEqual(a: TimeTrackerView, b: TimeTrackerView): boolean {
  if (a.tab !== b.tab) return false;
  // projectId only matters on the projects tab.
  if (a.tab === 'projects') return a.projectId === b.projectId;
  return true;
}
