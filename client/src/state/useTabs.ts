import { useMemo } from 'react';
import type { InstanceView } from './useInstances.js';
import type { ProjectViewPayload } from '../../../shared/ipcContract.js';
import type { TabRecord } from '../../../shared/layout.js';
import { deriveTabs } from '../layout/deriveTabs.js';

export function useTabs(
  instances: InstanceView[],
  projects: ProjectViewPayload[],
  openAdHocCwds: Set<string>,
  tabFocus: Record<string, string | null>,
): TabRecord[] {
  return useMemo(
    () => deriveTabs(instances, projects, openAdHocCwds, tabFocus),
    [instances, projects, openAdHocCwds, tabFocus],
  );
}
