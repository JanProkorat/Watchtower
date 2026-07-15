import { useCallback, useEffect, useRef, useState } from 'react';
import { SETTINGS_KEYS } from '@watchtower/shared/layout.js';
import { invoke } from './ipc';

const PERSIST_DEBOUNCE_MS = 300;

export interface UseHiddenInstancesResult {
  hidden: Set<string>;
  hide(instanceId: string): void;
  unhide(instanceId: string): void;
  /** Drop ids that no longer correspond to any live instance row. */
  pruneStale(liveIds: Set<string>): void;
}

export function useHiddenInstances(): UseHiddenInstancesResult {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke('getSetting', { key: SETTINGS_KEYS.hiddenInstanceIds })
      .then((r) => {
        if (cancelled) return;
        try {
          const parsed = r.value ? (JSON.parse(r.value) as unknown) : [];
          if (Array.isArray(parsed)) {
            setHidden(new Set(parsed.filter((x): x is string => typeof x === 'string')));
          }
        } catch {
          /* corrupt value — start from empty set */
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void invoke('setSetting', {
        key: SETTINGS_KEYS.hiddenInstanceIds,
        value: JSON.stringify([...hidden]),
      });
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [hidden, loaded]);

  const hide = useCallback((instanceId: string) => {
    setHidden((curr) => {
      if (curr.has(instanceId)) return curr;
      const next = new Set(curr);
      next.add(instanceId);
      return next;
    });
  }, []);

  const unhide = useCallback((instanceId: string) => {
    setHidden((curr) => {
      if (!curr.has(instanceId)) return curr;
      const next = new Set(curr);
      next.delete(instanceId);
      return next;
    });
  }, []);

  const pruneStale = useCallback((liveIds: Set<string>) => {
    setHidden((curr) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of curr) {
        if (liveIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : curr;
    });
  }, []);

  return { hidden, hide, unhide, pruneStale };
}
