import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_VIEW,
  parseTimeTrackerHash,
  timetrackerHash,
  viewsEqual,
  type DetailTab,
  type ListTab,
  type TimeTrackerView,
} from '../util/timetrackerUrl.js';

const STORAGE_KEY = 'watchtower.timetracker.view';

/**
 * Persisted, hash-routable state for the TimeTracker module.
 *
 * Three sources of truth, in priority order on first mount:
 *   1. URL hash — supports back/forward and deep links
 *   2. localStorage — survives a hash that other modules have stomped
 *   3. DEFAULT_VIEW (list mode, Projects tab)
 *
 * Updates write to both history.pushState and localStorage. A popstate
 * listener re-syncs from the hash on Cmd+[ / Cmd+].
 *
 * `enabled` gates the hash sync — App.tsx flips it off when another module
 * is active so list-mode tab clicks in TimeTracker don't repaint the hash
 * while the user is on, say, Settings.
 */
export interface UseTimeTrackerViewResult {
  view: TimeTrackerView;
  setListTab(tab: ListTab): void;
  openProject(projectId: number, initialTab?: DetailTab): void;
  closeProject(): void;
  setDetailTab(tab: DetailTab): void;
}

function readPersisted(): TimeTrackerView | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimeTrackerView;
    // Re-parse via the URL helper to guarantee shape — JSON could be from an
    // older release with different tab names.
    return parseTimeTrackerHash(timetrackerHash(parsed));
  } catch {
    return null;
  }
}

function writePersisted(view: TimeTrackerView): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    /* best-effort */
  }
}

function readInitial(): TimeTrackerView {
  if (typeof window === 'undefined') return DEFAULT_VIEW;
  const fromHash = parseTimeTrackerHash(window.location.hash);
  if (fromHash) return fromHash;
  return readPersisted() ?? DEFAULT_VIEW;
}

export function useTimeTrackerView(enabled: boolean): UseTimeTrackerViewResult {
  const [view, setView] = useState<TimeTrackerView>(readInitial);

  // popstate keeps view in sync when the user hits back/forward. The hashchange
  // event also fires for direct hash edits, which is rare but harmless to
  // listen for.
  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      const parsed = parseTimeTrackerHash(window.location.hash);
      if (parsed && !viewsEqual(parsed, view)) {
        setView(parsed);
      }
    };
    window.addEventListener('popstate', handler);
    window.addEventListener('hashchange', handler);
    return () => {
      window.removeEventListener('popstate', handler);
      window.removeEventListener('hashchange', handler);
    };
  }, [enabled, view]);

  // When TimeTracker becomes the active module, write the current view to the
  // hash so the URL reflects what's on screen. Skip while another module is
  // active to avoid clobbering its own hash routing.
  useEffect(() => {
    if (!enabled) return;
    const desired = timetrackerHash(view);
    if (window.location.hash !== desired) {
      window.history.replaceState(null, '', desired);
    }
  }, [enabled, view]);

  const update = useCallback(
    (next: TimeTrackerView) => {
      setView((prev) => {
        if (viewsEqual(prev, next)) return prev;
        writePersisted(next);
        if (enabled) {
          window.history.pushState(null, '', timetrackerHash(next));
        }
        return next;
      });
    },
    [enabled],
  );

  const setListTab = useCallback(
    (tab: ListTab) => update({ mode: 'list', tab }),
    [update],
  );

  const openProject = useCallback(
    (projectId: number, initialTab: DetailTab = 'epics') =>
      update({ mode: 'detail', projectId, tab: initialTab }),
    [update],
  );

  const closeProject = useCallback(() => update({ mode: 'list', tab: 'projects' }), [update]);

  const setDetailTab = useCallback(
    (tab: DetailTab) =>
      update(
        view.mode === 'detail'
          ? { mode: 'detail', projectId: view.projectId, tab }
          : { mode: 'list', tab: 'projects' },
      ),
    [update, view],
  );

  return { view, setListTab, openProject, closeProject, setDetailTab };
}
