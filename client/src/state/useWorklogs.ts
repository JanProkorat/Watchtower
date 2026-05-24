import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  WorklogInputPayload,
  WorklogListFilterPayload,
  WorklogViewPayload,
} from '../../../shared/ipcContract.js';

export type PeriodPreset = 'today' | 'week' | 'month' | 'all';
export type SourceFilter = 'all' | 'manual' | 'watchtower-auto' | 'jira-sync';

export interface WorklogsState {
  worklogs: WorklogViewPayload[];
  loading: boolean;
  error: string | null;
  filter: {
    period: PeriodPreset;
    source: SourceFilter;
    search: string;
    /** When non-null, list is server-side narrowed to this project. */
    projectId: number | null;
    /** Optional epic narrowing (project detail · Worklogs tab). */
    epicId: number | null;
  };
  setPeriod(p: PeriodPreset): void;
  setSource(s: SourceFilter): void;
  setSearch(q: string): void;
  setProjectId(id: number | null): void;
  setEpicId(id: number | null): void;
  refresh(): Promise<void>;
  create(input: WorklogInputPayload): Promise<WorklogViewPayload>;
  update(id: number, input: Partial<WorklogInputPayload>): Promise<WorklogViewPayload>;
  remove(id: number): Promise<void>;
}

function ymd(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function periodToDateRange(p: PeriodPreset): { from?: string; to?: string } {
  if (p === 'all') return {};
  const today = new Date();
  if (p === 'today') {
    const t = ymd(today);
    return { from: t, to: t };
  }
  if (p === 'week') {
    const d = new Date(today);
    // Monday-first week (Czech / ISO convention)
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return { from: ymd(d), to: ymd(today) };
  }
  // month
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: ymd(first), to: ymd(today) };
}

interface InitialFilter {
  projectId?: number | null;
  epicId?: number | null;
  period?: PeriodPreset;
}

export function useWorklogs(initial: InitialFilter = {}): WorklogsState {
  const [period, setPeriod] = useState<PeriodPreset>(initial.period ?? 'week');
  const [source, setSource] = useState<SourceFilter>('all');
  const [search, setSearch] = useState<string>('');
  const [projectId, setProjectId] = useState<number | null>(initial.projectId ?? null);
  const [epicId, setEpicId] = useState<number | null>(initial.epicId ?? null);

  const [worklogs, setWorklogs] = useState<WorklogViewPayload[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const ipcFilter = useMemo((): WorklogListFilterPayload => {
    const { from, to } = periodToDateRange(period);
    const f: WorklogListFilterPayload = {};
    if (from) f.from = from;
    if (to) f.to = to;
    if (source !== 'all') f.source = source;
    if (projectId != null) f.projectId = projectId;
    if (epicId != null) f.epicId = epicId;
    const q = search.trim();
    if (q) f.search = q;
    return f;
  }, [period, source, projectId, epicId, search]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.watchtower.invoke('worklogs:list', ipcFilter);
      setWorklogs(res.worklogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ipcFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: WorklogInputPayload) => {
      const res = await window.watchtower.invoke('worklogs:create', input);
      await refresh();
      return res.worklog;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: number, input: Partial<WorklogInputPayload>) => {
      const res = await window.watchtower.invoke('worklogs:update', { id, input });
      await refresh();
      return res.worklog;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      await window.watchtower.invoke('worklogs:delete', { id });
      await refresh();
    },
    [refresh],
  );

  return {
    worklogs,
    loading,
    error,
    filter: { period, source, search, projectId, epicId },
    setPeriod,
    setSource,
    setSearch,
    setProjectId,
    setEpicId,
    refresh,
    create,
    update,
    remove,
  };
}
