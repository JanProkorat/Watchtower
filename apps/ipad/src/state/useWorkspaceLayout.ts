import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import type { NodeId } from '@watchtower/shared/layout.js';
import type { SplitPosition } from '@watchtower/shared/workspaceTreeOps.js';
import {
  type WorkspaceState, type TabLayout,
  defaultTabLayout, splitPane, closePane, resizeSplitSizes, focusPane, appendPaneRight,
  serializeWorkspace, deserializeWorkspace,
} from './workspaceLayoutModel.js';

const PREF_KEY = 'watchtower.ipad.workspace';

export interface WorkspaceLayoutActions {
  split(tabKey: string, leafId: NodeId, dir: 'row' | 'col', position: SplitPosition, instanceId: string): void;
  close(tabKey: string, leafId: NodeId, fallbackInstanceId: string): void;
  // resize/focus carry a seed instanceId: if the tab isn't in state yet (its
  // default layout hasn't been persisted), the seed builds the SAME default the
  // UI is currently rendering, so focusedLeafId/sizes land on a real leaf
  // instead of a placeholder-'' default.
  resize(tabKey: string, splitId: NodeId, sizes: number[], seedInstanceId: string): void;
  focus(tabKey: string, leafId: NodeId, seedInstanceId: string): void;
  // Append a new pane on the far right, evening the widths. seedInstanceId is
  // the instance the tab's default is seeded from when it isn't in state yet.
  appendRight(tabKey: string, instanceId: string, seedInstanceId: string): void;
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
      // Don't clobber a layout the user already mutated before Preferences
      // resolved — only seed from storage while state is still pristine.
      setState((prev) => (Object.keys(prev).length === 0 ? deserializeWorkspace(value) : prev));
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
    resize: (tabKey, splitId, sizes, seedInstanceId) =>
      mutate(tabKey, seedInstanceId, (l) => resizeSplitSizes(l, splitId, sizes)),
    focus: (tabKey, leafId, seedInstanceId) =>
      mutate(tabKey, seedInstanceId, (l) => focusPane(l, leafId)),
    appendRight: (tabKey, instanceId, seedInstanceId) =>
      mutate(tabKey, seedInstanceId, (l) => appendPaneRight(l, instanceId)),
  }), [mutate]);

  return { loaded, getTabLayout, actions };
}
