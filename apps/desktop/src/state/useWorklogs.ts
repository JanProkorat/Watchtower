import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  WorklogInputPayload,
  WorklogListFilterPayload,
  WorklogViewPayload,
} from '@watchtower/shared/ipcContract.js';

function asLockedError(
  p: unknown,
): { error: 'locked'; lockedThrough: string; message: string } | null {
  return p && typeof p === 'object' && (p as { error?: unknown }).error === 'locked'
    ? (p as { error: 'locked'; lockedThrough: string; message: string })
    : null;
}

export interface WorklogsState {
  worklogs: WorklogViewPayload[];
  loading: boolean;
  error: string | null;
  filter: {
    /** Inclusive date range (YYYY-MM-DD), like the Reports page. */
    from: string;
    to: string;
    search: string;
    /** When non-null, list is server-side narrowed to this project. */
    projectId: number | null;
    /** Optional epic narrowing (project detail · Worklogs tab). */
    epicId: number | null;
  };
  setFrom(d: string): void;
  setTo(d: string): void;
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

function todayYmd(): string {
  return ymd(new Date());
}

function daysAgoYmd(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

interface InitialFilter {
  projectId?: number | null;
  epicId?: number | null;
  from?: string;
  to?: string;
}

export function useWorklogs(initial: InitialFilter = {}): WorklogsState {
  // Default to the last 7 days (inclusive), matching the old "this week" span.
  const [from, setFrom] = useState<string>(initial.from ?? daysAgoYmd(6));
  const [to, setTo] = useState<string>(initial.to ?? todayYmd());
  const [search, setSearch] = useState<string>('');
  const [projectId, setProjectId] = useState<number | null>(initial.projectId ?? null);
  const [epicId, setEpicId] = useState<number | null>(initial.epicId ?? null);

  const [worklogs, setWorklogs] = useState<WorklogViewPayload[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const ipcFilter = useMemo((): WorklogListFilterPayload => {
    const f: WorklogListFilterPayload = {};
    if (from) f.from = from;
    if (to) f.to = to;
    if (projectId != null) f.projectId = projectId;
    if (epicId != null) f.epicId = epicId;
    const q = search.trim();
    if (q) f.search = q;
    return f;
  }, [from, to, projectId, epicId, search]);

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
      const locked = asLockedError(res);
      if (locked) throw new Error(locked.message);
      await refresh();
      return (res as { worklog: WorklogViewPayload }).worklog;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: number, input: Partial<WorklogInputPayload>) => {
      const res = await window.watchtower.invoke('worklogs:update', { id, input });
      const locked = asLockedError(res);
      if (locked) throw new Error(locked.message);
      await refresh();
      return (res as { worklog: WorklogViewPayload }).worklog;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      const res = await window.watchtower.invoke('worklogs:delete', { id });
      const locked = asLockedError(res);
      if (locked) throw new Error(locked.message);
      await refresh();
    },
    [refresh],
  );

  return {
    worklogs,
    loading,
    error,
    filter: { from, to, search, projectId, epicId },
    setFrom,
    setTo,
    setSearch,
    setProjectId,
    setEpicId,
    refresh,
    create,
    update,
    remove,
  };
}
