import { useEffect, useMemo } from 'react';
import type { PersistedLayout, TabRecord } from '@watchtower/shared/layout.js';
import { findLeafById } from '../layout/workspaceTreeOps.js';

export function useFocusedInstance(
  layout: PersistedLayout,
  tabs: TabRecord[],
): string | null {
  const focusedInstanceId = useMemo(
    () => computeFocused(layout, tabs),
    [layout, tabs],
  );

  useEffect(() => {
    void window.watchtower.invoke('focusChanged', { instanceId: focusedInstanceId });
  }, [focusedInstanceId]);

  return focusedInstanceId;
}

function computeFocused(layout: PersistedLayout, tabs: TabRecord[]): string | null {
  if (!layout.focusedLeafId) return null;
  const leafNode = findLeafById(layout.root, layout.focusedLeafId);
  if (!leafNode) return null;
  const tab = tabs.find((t) => t.id === leafNode.tabId);
  return tab?.focusedInstanceId ?? null;
}
