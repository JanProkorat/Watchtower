import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DASHBOARD_TAB_ID,
  SETTINGS_KEYS,
  type NodeId,
  type PersistedLayout,
  type TabId,
  type WorkspaceNode,
} from '@watchtower/shared/layout.js';
import {
  leaf,
  splitLeaf,
  unmountLeaf,
  replaceLeafTab,
  setSizes,
  firstLeafInPreOrder,
  findLeafById,
} from '@watchtower/shared/workspaceTreeOps.js';
import { newNodeId } from '@watchtower/shared/newNodeId.js';

const PERSIST_DEBOUNCE_MS = 500;

export interface WorkspaceLayoutActions {
  replaceLeafTab(leafId: NodeId, tabId: TabId): void;
  splitLeafAt(
    targetLeafId: NodeId,
    dir: 'row' | 'col',
    position: 'before' | 'after',
    newTabId: TabId,
  ): void;
  unmountLeafAt(leafId: NodeId): void;
  setSplitSizes(splitId: NodeId, sizes: number[]): void;
  focusLeaf(leafId: NodeId | null): void;
  focusColumnInTab(tabId: TabId, instanceId: string | null): void;
  setTabStripOrder(order: TabId[]): void;
  replaceTree(root: WorkspaceNode): void;
}

export interface UseWorkspaceLayoutResult {
  loaded: boolean;
  layout: PersistedLayout;
  actions: WorkspaceLayoutActions;
}

const DEFAULT_LAYOUT = (): PersistedLayout => {
  const id = newNodeId();
  return {
    root: leaf(id, DASHBOARD_TAB_ID as TabId),
    focusedLeafId: id,
    tabFocus: {},
    tabStripOrder: [],
  };
};

export function useWorkspaceLayout(): UseWorkspaceLayoutResult {
  const [layout, setLayout] = useState<PersistedLayout>(DEFAULT_LAYOUT);
  const [loaded, setLoaded] = useState(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void hydrate().then((hydrated) => {
      if (cancelled) return;
      setLayout(hydrated);
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
      void persist(layout);
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [layout, loaded]);

  const actions = useMemo<WorkspaceLayoutActions>(
    () => ({
      replaceLeafTab: (leafId, tabId) =>
        setLayout((p) => ({ ...p, root: replaceLeafTab(p.root, leafId, tabId) })),
      splitLeafAt: (targetLeafId, dir, position, newTabId) =>
        setLayout((p) => ({
          ...p,
          root: splitLeaf(p.root, targetLeafId, dir, position, newTabId),
        })),
      unmountLeafAt: (leafId) =>
        setLayout((p) => {
          const next =
            unmountLeaf(p.root, leafId) ?? leaf(newNodeId(), DASHBOARD_TAB_ID as TabId);
          const stillFocused = p.focusedLeafId && findLeafById(next, p.focusedLeafId);
          const focusedLeafId = stillFocused
            ? p.focusedLeafId
            : firstLeafInPreOrder(next)?.id ?? null;
          return { ...p, root: next, focusedLeafId };
        }),
      setSplitSizes: (splitId, sizes) =>
        setLayout((p) => ({ ...p, root: setSizes(p.root, splitId, sizes) })),
      focusLeaf: (leafId) => setLayout((p) => ({ ...p, focusedLeafId: leafId })),
      focusColumnInTab: (tabId, instanceId) =>
        setLayout((p) => ({ ...p, tabFocus: { ...p.tabFocus, [tabId]: instanceId } })),
      setTabStripOrder: (order) => setLayout((p) => ({ ...p, tabStripOrder: order })),
      replaceTree: (root) =>
        setLayout((p) => {
          const stillFocused = p.focusedLeafId && findLeafById(root, p.focusedLeafId);
          return {
            ...p,
            root,
            focusedLeafId: stillFocused
              ? p.focusedLeafId
              : firstLeafInPreOrder(root)?.id ?? null,
          };
        }),
    }),
    [],
  );

  return { loaded, layout, actions };
}

export async function hydrate(): Promise<PersistedLayout> {
  const [tree, focused, tabFocus, stripOrder] = await Promise.all([
    readSetting<WorkspaceNode>(SETTINGS_KEYS.workspaceTree),
    readSetting<NodeId | null>(SETTINGS_KEYS.focusedLeafId),
    readSetting<Record<string, string | null>>(SETTINGS_KEYS.tabFocus),
    readSetting<TabId[]>(SETTINGS_KEYS.tabStripOrder),
  ]);
  const base = DEFAULT_LAYOUT();
  const root = tree ?? base.root;
  return {
    root,
    focusedLeafId: focused ?? firstLeafInPreOrder(root)?.id ?? null,
    tabFocus: tabFocus ?? {},
    tabStripOrder: stripOrder ?? [],
  };
}

async function readSetting<T>(key: string): Promise<T | null> {
  try {
    const r = await window.watchtower.invoke('getSetting', { key });
    if (!r.value) return null;
    return JSON.parse(r.value) as T;
  } catch {
    return null;
  }
}

export async function persist(layout: PersistedLayout): Promise<void> {
  await Promise.all([
    window.watchtower.invoke('setSetting', {
      key: SETTINGS_KEYS.workspaceTree,
      value: JSON.stringify(layout.root),
    }),
    window.watchtower.invoke('setSetting', {
      key: SETTINGS_KEYS.focusedLeafId,
      value: JSON.stringify(layout.focusedLeafId),
    }),
    window.watchtower.invoke('setSetting', {
      key: SETTINGS_KEYS.tabFocus,
      value: JSON.stringify(layout.tabFocus),
    }),
    window.watchtower.invoke('setSetting', {
      key: SETTINGS_KEYS.tabStripOrder,
      value: JSON.stringify(layout.tabStripOrder),
    }),
  ]);
}

