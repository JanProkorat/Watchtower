import { useCallback, useEffect, useState } from 'react';
import type {
  ByProjectDatumPayload,
  ContractReportRowPayload,
  EarningsResponsePayload,
  HeatmapDatumPayload,
  RateChangeMarkerPayload,
  TrendDatumPayload,
} from '@watchtower/shared/ipcContract.js';

export type Granularity = 'day' | 'week' | 'month';

export interface ReportsState {
  trend: TrendDatumPayload[];
  byProject: ByProjectDatumPayload[];
  earnings: EarningsResponsePayload | null;
  heatmap: HeatmapDatumPayload[];
  contracts: ContractReportRowPayload[];
  rateChanges: RateChangeMarkerPayload[];
  loading: boolean;
  errors: string[];
  refresh(): Promise<void>;
}

/**
 * Fetches every report endpoint in parallel for the given range + granularity.
 * Errors are collected into one array so a single panel hiccup doesn't take
 * the whole page down — the others still render.
 */
export function useReports(
  from: string,
  to: string,
  granularity: Granularity,
  projectId?: number | null,
): ReportsState {
  const [trend, setTrend] = useState<TrendDatumPayload[]>([]);
  const [byProject, setByProject] = useState<ByProjectDatumPayload[]>([]);
  const [earnings, setEarnings] = useState<EarningsResponsePayload | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapDatumPayload[]>([]);
  const [contracts, setContracts] = useState<ContractReportRowPayload[]>([]);
  const [rateChanges, setRateChanges] = useState<RateChangeMarkerPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const errs: string[] = [];
    const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        errs.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    };
    // Only include projectId in the payload when set — keeps the wire shape
    // minimal and matches the "all projects" semantics on the orchestrator.
    const pid = projectId ?? undefined;
    const [trendRes, byProjRes, earningsRes, heatmapRes, contractsRes, rateRes] =
      await Promise.all([
        safe('trend', () =>
          window.watchtower.invoke('reports:trend', { from, to, granularity, projectId: pid }),
        ),
        safe('byProject', () =>
          window.watchtower.invoke('reports:byProject', { from, to, projectId: pid }),
        ),
        safe('earnings', () =>
          window.watchtower.invoke('reports:earnings', { from, to, projectId: pid }),
        ),
        safe('heatmap', () =>
          window.watchtower.invoke('reports:heatmap', { from, to, projectId: pid }),
        ),
        safe('contracts', () => window.watchtower.invoke('reports:contracts', { projectId: pid })),
        safe('rateChanges', () =>
          window.watchtower.invoke('reports:rateChanges', { from, to, projectId: pid }),
        ),
      ]);
    if (trendRes) setTrend(trendRes.trend);
    if (byProjRes) setByProject(byProjRes.byProject);
    if (earningsRes) setEarnings(earningsRes);
    if (heatmapRes) setHeatmap(heatmapRes.heatmap);
    if (contractsRes) setContracts(contractsRes.contracts);
    if (rateRes) setRateChanges(rateRes.rateChanges);
    setErrors(errs);
    setLoading(false);
  }, [from, to, granularity, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { trend, byProject, earnings, heatmap, contracts, rateChanges, loading, errors, refresh };
}
