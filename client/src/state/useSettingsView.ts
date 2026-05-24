import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_VIEW,
  parseSettingsHash,
  settingsHash,
  viewsEqual,
  type SettingsTab,
  type SettingsView,
} from '../util/settingsUrl.js';

const STORAGE_KEY = 'watchtower.settings.view';

/**
 * Persisted, hash-routable state for the Settings module.
 *
 * Mirrors the TimeTracker view hook: URL hash → localStorage → DEFAULT_VIEW
 * on first mount. Updates write to history and localStorage. The `enabled`
 * flag gates hash writes so tab clicks here don't repaint the hash while
 * another module is active.
 */
export interface UseSettingsViewResult {
  view: SettingsView;
  setTab(tab: SettingsTab): void;
}

function readPersisted(): SettingsView | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SettingsView;
    return parseSettingsHash(settingsHash(parsed));
  } catch {
    return null;
  }
}

function writePersisted(view: SettingsView): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    /* best-effort */
  }
}

function readInitial(): SettingsView {
  if (typeof window === 'undefined') return DEFAULT_VIEW;
  const fromHash = parseSettingsHash(window.location.hash);
  if (fromHash) return fromHash;
  return readPersisted() ?? DEFAULT_VIEW;
}

export function useSettingsView(enabled: boolean): UseSettingsViewResult {
  const [view, setView] = useState<SettingsView>(readInitial);

  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      const parsed = parseSettingsHash(window.location.hash);
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

  useEffect(() => {
    if (!enabled) return;
    const desired = settingsHash(view);
    if (window.location.hash !== desired) {
      window.history.replaceState(null, '', desired);
    }
  }, [enabled, view]);

  const setTab = useCallback(
    (tab: SettingsTab) => {
      setView((prev) => {
        const next: SettingsView = { tab };
        if (viewsEqual(prev, next)) return prev;
        writePersisted(next);
        if (enabled) {
          window.history.pushState(null, '', settingsHash(next));
        }
        return next;
      });
    },
    [enabled],
  );

  return { view, setTab };
}
