import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import type { NodeId } from '@watchtower/shared/layout.js';
import type { SplitPosition } from '@watchtower/shared/workspaceTreeOps.js';
import {
  type WorkspaceState, type TabLayout,
  defaultTabLayout, splitPane, closePane, resizeSplitSizes, replacePane, focusPane,
  serializeWorkspace, deserializeWorkspace,
} from './workspaceLayoutModel.js';

const PREF_KEY = 'watchtower.ipad.workspace';

export interface WorkspaceLayoutActions {
  split(tabKey: string, leafId: NodeId, dir: 'row' | 'col', position: SplitPosition, instanceId: string): void;
  close(tabKey: string, leafId: NodeId, fallbackInstanceId: string): void;
  resize(tabKey: string, splitId: NodeId, sizes: number[]): void;
  replace(tabKey: string, leafId: NodeId, instanceId: string): void;
  focus(tabKey: string, leafId: NodeId): void;
}

export function useWorkspaceLayout(): {
  loaded: boolean;
  getTabLayout(tabKey: string, defaultInstanceId: string): TabLayout;
  actions: WorkspaceLayoutActions;
} {
  const [state, setState] = useState<WorkspaceState>({});
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void Preferences.get({ key: PREF_KEY }).then(({ value }) => {
      if (!alive) return;
      setState(deserializeWorkspace(value));
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  // Debounced persist on every state change (after hydration).
  useEffect(() => {
    if (!loaded) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void Preferences.set({ key: PREF_KEY, value: serializeWorkspace(state) });
    }, 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [state, loaded]);

  const getTabLayout = useCallback(
    (tabKey: string, defaultInstanceId: string): TabLayout =>
      state[tabKey] ?? defaultTabLayout(defaultInstanceId),
    [state],
  );

  // Mutate a tab's layout, seeding a default from `instanceId` if absent.
  const mutate = useCallback(
    (tabKey: string, seedInstanceId: string, fn: (l: TabLayout) => TabLayout): void => {
      setState((prev) => {
        const current = prev[tabKey] ?? defaultTabLayout(seedInstanceId);
        return { ...prev, [tabKey]: fn(current) };
      });
    },
    [],
  );

  const actions = useMemo<WorkspaceLayoutActions>(() => ({
    split: (tabKey, leafId, dir, position, instanceId) =>
      mutate(tabKey, instanceId, (l) => splitPane(l, leafId, dir, position, instanceId)),
    close: (tabKey, leafId, fallbackInstanceId) =>
      mutate(tabKey, fallbackInstanceId, (l) => closePane(l, leafId, fallbackInstanceId)),
    resize: (tabKey, splitId, sizes) =>
      mutate(tabKey, '', (l) => resizeSplitSizes(l, splitId, sizes)),
    replace: (tabKey, leafId, instanceId) =>
      mutate(tabKey, instanceId, (l) => replacePane(l, leafId, instanceId)),
    focus: (tabKey, leafId) =>
      mutate(tabKey, '', (l) => focusPane(l, leafId)),
  }), [mutate]);

  return { loaded, getTabLayout, actions };
}
