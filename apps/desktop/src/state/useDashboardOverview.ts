import { useCallback, useEffect, useState } from 'react';
import type {
  DashboardOverviewRequestPayload,
  DashboardOverviewResponsePayload,
} from '@watchtower/shared/ipcContract.js';

export interface DashboardOverviewState {
  data: DashboardOverviewResponsePayload | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/**
 * Single-call dashboard fetcher. Refetches whenever projectIds, sprintAnchor,
 * or todayDate change. The "today" date is passed in by the caller so the
 * orchestrator doesn't need to know the user's local timezone.
 */
export function useDashboardOverview(
  projectIds: number[],
  sprintAnchor: string,
  todayDate: string,
): DashboardOverviewState {
  const [data, setData] = useState<DashboardOverviewResponsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Arrays are a fresh reference each render — key the callback on a stable
  // serialisation so refresh only re-fires when the selection actually changes.
  const projectIdsKey = projectIds.length > 0 ? projectIds.join(',') : '';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = projectIdsKey === '' ? [] : projectIdsKey.split(',').map(Number);
      const payload: DashboardOverviewRequestPayload = { projectIds: ids, sprintAnchor, todayDate };
      const res = await window.watchtower.invoke('dashboard:overview', payload);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectIdsKey, sprintAnchor, todayDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
