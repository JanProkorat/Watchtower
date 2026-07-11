import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useInstances, type InstanceView } from './useInstances.js';
import { useProjects, type ProjectSummary } from './useProjects.js';

interface InstancesData {
  instances: InstanceView[];
  projects: ProjectSummary[];
}

const InstancesDataContext = createContext<InstancesData | null>(null);

/**
 * Fetches the instance + project lists ONCE and shares them via context.
 *
 * Previously both the Shell (via useAttention → useAttentionInstances) and the
 * InstancesModule each called useInstances() + useProjects() independently, so
 * opening the Instances tab spun up a SECOND listInstances / projects:list
 * fetch plus a duplicate `stateChanged` subscription and reconnect refetch — a
 * visible hitch on the first switch into Instances. One provider, two consumers.
 */
export function InstancesDataProvider({ children }: { children: ReactNode }) {
  const { instances } = useInstances();
  const { projects } = useProjects();
  const value = useMemo<InstancesData>(() => ({ instances, projects }), [instances, projects]);
  return <InstancesDataContext.Provider value={value}>{children}</InstancesDataContext.Provider>;
}

export function useInstancesData(): InstancesData {
  const ctx = useContext(InstancesDataContext);
  if (!ctx) throw new Error('useInstancesData must be used inside <InstancesDataProvider>');
  return ctx;
}
