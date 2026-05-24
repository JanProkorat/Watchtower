import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ProjectInputPayload,
  ProjectListFilterPayload,
  ProjectViewPayload,
} from '../../../shared/ipcContract.js';

export type ProjectKind = 'work' | 'time_off';
export type ArchiveFilter = 'active' | 'archived';

export interface ProjectsState {
  projects: ProjectViewPayload[];
  loading: boolean;
  error: string | null;
  filter: {
    archive: ArchiveFilter;
    kind: ProjectKind | 'all';
    search: string;
  };
  setArchiveFilter(next: ArchiveFilter): void;
  setKindFilter(next: ProjectKind | 'all'): void;
  setSearch(next: string): void;
  refresh(): Promise<void>;
  create(input: ProjectInputPayload): Promise<ProjectViewPayload>;
  update(id: number, input: Partial<ProjectInputPayload>): Promise<ProjectViewPayload>;
  archive(id: number, archived: boolean): Promise<void>;
  remove(id: number): Promise<void>;
}

function toIpcFilter(
  archive: ArchiveFilter,
  kind: ProjectKind | 'all',
  search: string,
): ProjectListFilterPayload {
  const f: ProjectListFilterPayload = {
    archived: archive === 'archived',
  };
  if (kind !== 'all') f.kind = kind;
  const trimmed = search.trim();
  if (trimmed) f.search = trimmed;
  return f;
}

/**
 * Projects list + mutation state. Mirrors the useInstances pattern — no react
 * query, just useState + manual refresh after each mutation. Filter state lives
 * here so the server is the source of truth for search / archive / kind
 * narrowing (no client-side filtering, which would diverge once the dataset
 * grows beyond a handful of rows).
 */
export function useProjects(): ProjectsState {
  const [archive, setArchive] = useState<ArchiveFilter>('active');
  const [kind, setKind] = useState<ProjectKind | 'all'>('all');
  const [search, setSearchInput] = useState<string>('');

  const [projects, setProjects] = useState<ProjectViewPayload[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const ipcFilter = useMemo(
    () => toIpcFilter(archive, kind, search),
    [archive, kind, search],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.watchtower.invoke('projects:list', ipcFilter);
      setProjects(res.projects);
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
    async (input: ProjectInputPayload) => {
      const res = await window.watchtower.invoke('projects:create', input);
      await refresh();
      return res.project;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: number, input: Partial<ProjectInputPayload>) => {
      const res = await window.watchtower.invoke('projects:update', { id, input });
      await refresh();
      return res.project;
    },
    [refresh],
  );

  const archiveOp = useCallback(
    async (id: number, archived: boolean) => {
      await window.watchtower.invoke('projects:archive', { id, archived });
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      await window.watchtower.invoke('projects:delete', { id });
      await refresh();
    },
    [refresh],
  );

  return {
    projects,
    loading,
    error,
    filter: { archive, kind, search },
    setArchiveFilter: setArchive,
    setKindFilter: setKind,
    setSearch: setSearchInput,
    refresh,
    create,
    update,
    archive: archiveOp,
    remove,
  };
}
