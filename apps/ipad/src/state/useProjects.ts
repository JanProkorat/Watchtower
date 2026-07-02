import { useCallback, useEffect, useState } from 'react';
import { useConnection } from './connectionContext.js';

export interface ProjectSummary {
  id: number;
  name: string;
  folderPath: string | null;
}

export function useProjects(): { projects: ProjectSummary[] } {
  const { bridge, status } = useConnection();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  const refetch = useCallback(() => {
    void bridge
      .invoke('projects:list', {})
      .then((r) => {
        const res = r as { projects: Array<{ id: number; name: string; folderPath: string | null }> };
        setProjects(res.projects.map(({ id, name, folderPath }) => ({ id, name, folderPath })));
      })
      .catch(() => { /* not connected yet; a later (re)connect refetch covers it */ });
  }, [bridge]);

  // Refetch on every (re)connect. Without this, projects fetched once at mount
  // stay empty after a reconnect, so instance→project grouping fails and every
  // instance falls into the "Other" tab instead of its project tab.
  useEffect(() => {
    if (status === 'connected') refetch();
  }, [status, refetch]);

  return { projects };
}
