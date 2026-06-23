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
 * Single-call dashboard fetcher. Refetches whenever projectId, sprintAnchor,
 * or todayDate change. The "today" date is passed in by the caller so the
 * orchestrator doesn't need to know the user's local timezone.
 */
export function useDashboardOverview(
  projectId: number | null,
  sprintAnchor: string,
  todayDate: string,
): DashboardOverviewState {
  const [data, setData] = useState<DashboardOverviewResponsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: DashboardOverviewRequestPayload = { projectId, sprintAnchor, todayDate };
      const res = await window.watchtower.invoke('dashboard:overview', payload);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, sprintAnchor, todayDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
