import { useEffect, useState } from 'react';
import { useConnection } from './connectionContext.js';

export interface ProjectSummary {
  id: number;
  name: string;
  folderPath: string | null;
}

export function useProjects(): { projects: ProjectSummary[] } {
  const { bridge } = useConnection();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    void bridge.invoke('projects:list', {}).then((r) => {
      const res = r as { projects: Array<{ id: number; name: string; folderPath: string | null }> };
      setProjects(res.projects.map(({ id, name, folderPath }) => ({ id, name, folderPath })));
    });
  }, [bridge]);

  return { projects };
}
