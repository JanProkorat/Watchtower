import { useCallback, useEffect, useState } from 'react';
import type { TaskGridResponsePayload } from '@watchtower/shared/ipcContract.js';
import { invoke } from './ipc';

export interface TaskGridState {
  data: TaskGridResponsePayload | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

export function useTaskGrid(
  year: number,
  month: number,
  projectIds?: number[],
): TaskGridState {
  const [data, setData] = useState<TaskGridResponsePayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Arrays are a fresh reference each render — key the callback on a stable
  // serialisation so refresh only re-fires when the selection actually changes.
  const projectIdsKey = projectIds && projectIds.length > 0 ? projectIds.join(',') : '';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = projectIdsKey === '' ? [] : projectIdsKey.split(',').map(Number);
      const payload = ids.length > 0 ? { year, month, projectIds: ids } : { year, month };
      const res = await invoke('taskGrid:get', payload);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [year, month, projectIdsKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
