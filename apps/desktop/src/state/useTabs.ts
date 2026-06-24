import { useMemo } from 'react';
import type { InstanceView } from './useInstances.js';
import type { ProjectViewPayload } from '@watchtower/shared/ipcContract.js';
import type { TabRecord } from '@watchtower/shared/layout.js';
import { deriveTabs } from '../layout/deriveTabs.js';

export function useTabs(
  instances: InstanceView[],
  projects: ProjectViewPayload[],
  openAdHocCwds: Set<string>,
  tabFocus: Record<string, string | null>,
  hiddenInstanceIds: Set<string>,
): TabRecord[] {
  return useMemo(
    () => deriveTabs(instances, projects, openAdHocCwds, tabFocus, hiddenInstanceIds),
    [instances, projects, openAdHocCwds, tabFocus, hiddenInstanceIds],
  );
}
