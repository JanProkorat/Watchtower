import { useCallback, useEffect, useState } from 'react';
import type { TaskGridResponsePayload } from '../../../shared/ipcContract.js';

export interface TaskGridState {
  data: TaskGridResponsePayload | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

export function useTaskGrid(
  year: number,
  month: number,
  projectId?: number,
): TaskGridState {
  const [data, setData] = useState<TaskGridResponsePayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = projectId !== undefined ? { year, month, projectId } : { year, month };
      const res = await window.watchtower.invoke('taskGrid:get', payload);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [year, month, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
