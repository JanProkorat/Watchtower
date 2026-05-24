import { useCallback, useEffect, useState } from 'react';
import type { ProjectInputPayload, ProjectViewPayload } from '../../../shared/ipcContract.js';

export interface ProjectState {
  project: ProjectViewPayload | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  update(input: Partial<ProjectInputPayload>): Promise<ProjectViewPayload>;
  archive(archived: boolean): Promise<void>;
}

/**
 * Single-project fetch + mutations for the detail page. Re-fetches on
 * mutation rather than mutating local state — keeps the joined epic_count /
 * total_minutes accurate when epics or worklogs change underneath.
 */
export function useProject(projectId: number): ProjectState {
  const [project, setProject] = useState<ProjectViewPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.watchtower.invoke('projects:get', { id: projectId });
      setProject(res.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (input: Partial<ProjectInputPayload>) => {
      const res = await window.watchtower.invoke('projects:update', { id: projectId, input });
      setProject(res.project);
      return res.project;
    },
    [projectId],
  );

  const archive = useCallback(
    async (archived: boolean) => {
      await window.watchtower.invoke('projects:archive', { id: projectId, archived });
      await refresh();
    },
    [projectId, refresh],
  );

  return { project, loading, error, refresh, update, archive };
}
