import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  EpicInputPayload,
  EpicViewPayload,
  TaskInputPayload,
  TaskViewPayload,
} from '@watchtower/shared/ipcContract.js';
import { invoke } from './ipc';

export interface EpicsAndTasksState {
  epics: EpicViewPayload[];
  tasksByEpic: Map<number, TaskViewPayload[]>;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  createEpic(input: Omit<EpicInputPayload, 'projectId'>): Promise<EpicViewPayload>;
  updateEpic(id: number, input: Partial<EpicInputPayload>): Promise<EpicViewPayload>;
  deleteEpic(id: number): Promise<void>;
  reorderEpics(orderedIds: number[]): Promise<void>;
  createTask(input: TaskInputPayload): Promise<TaskViewPayload>;
  updateTask(id: number, input: Partial<TaskInputPayload>): Promise<TaskViewPayload>;
  deleteTask(id: number): Promise<void>;
}

/**
 * Loads all epics for a project plus all tasks across those epics in two
 * round-trips, then groups tasks by epic for the tree. Avoids the N+1 of
 * fetching tasks per epic separately.
 */
export function useEpicsAndTasks(projectId: number): EpicsAndTasksState {
  const [epics, setEpics] = useState<EpicViewPayload[]>([]);
  const [tasks, setTasks] = useState<TaskViewPayload[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [epicsRes, tasksRes] = await Promise.all([
        invoke('epics:list', { projectId }),
        invoke('tasks:listForProject', { projectId }),
      ]);
      setEpics(epicsRes.epics);
      setTasks(tasksRes.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tasksByEpic = useMemo(() => {
    const map = new Map<number, TaskViewPayload[]>();
    for (const t of tasks) {
      const list = map.get(t.epicId) ?? [];
      list.push(t);
      map.set(t.epicId, list);
    }
    return map;
  }, [tasks]);

  const createEpic = useCallback(
    async (input: Omit<EpicInputPayload, 'projectId'>) => {
      const res = await invoke('epics:create', { projectId, ...input });
      await refresh();
      return res.epic;
    },
    [projectId, refresh],
  );

  const updateEpic = useCallback(
    async (id: number, input: Partial<EpicInputPayload>) => {
      const res = await invoke('epics:update', { id, input });
      await refresh();
      return res.epic;
    },
    [refresh],
  );

  const deleteEpic = useCallback(
    async (id: number) => {
      await invoke('epics:delete', { id });
      await refresh();
    },
    [refresh],
  );

  const reorderEpics = useCallback(
    async (orderedIds: number[]) => {
      await invoke('epics:reorder', { projectId, orderedIds });
      await refresh();
    },
    [projectId, refresh],
  );

  const createTask = useCallback(
    async (input: TaskInputPayload) => {
      const res = await invoke('tasks:create', input);
      await refresh();
      return res.task;
    },
    [refresh],
  );

  const updateTask = useCallback(
    async (id: number, input: Partial<TaskInputPayload>) => {
      const res = await invoke('tasks:update', { id, input });
      await refresh();
      return res.task;
    },
    [refresh],
  );

  const deleteTask = useCallback(
    async (id: number) => {
      await invoke('tasks:delete', { id });
      await refresh();
    },
    [refresh],
  );

  return {
    epics,
    tasksByEpic,
    loading,
    error,
    refresh,
    createEpic,
    updateEpic,
    deleteEpic,
    reorderEpics,
    createTask,
    updateTask,
    deleteTask,
  };
}
