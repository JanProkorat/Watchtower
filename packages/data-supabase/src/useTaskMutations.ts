import { useState, useCallback } from 'react';
import { getSupabase } from './supabaseClient.js';
import type { TaskRow, EpicRow, ProjectRow } from '@watchtower/shared/billing/types.js';
import {
  buildTaskInsert,
  buildTaskUpdate,
  buildTaskDelete,
  buildOptimisticTaskRow,
  buildEditedTaskRow,
  applyTaskWrite,
  canEditTask,
  type TaskWriteInput,
} from './billingWrites.js';

interface Args {
  tasks: TaskRow[];
  epics: EpicRow[];
  projects: ProjectRow[];
  patchTasks(next: TaskRow[]): void;
}

export function useTaskMutations({ tasks, epics, projects, patchTasks }: Args) {
  const [pending, setPending] = useState<string | null>(null); // syncId being written
  const [error, setError] = useState<string | null>(null);

  const resolveProject = useCallback(
    (epicId: number): ProjectRow | null => {
      const epic = epics.find((e) => e.epicId === epicId);
      if (!epic) return null;
      return projects.find((p) => p.id === epic.projectId) ?? null;
    },
    [epics, projects],
  );

  const createTask = useCallback(
    async (input: TaskWriteInput) => {
      const prev = tasks;
      const project = resolveProject(input.epicId);
      if (!project) {
        setError('Projekt nenalezen');
        return;
      }
      const syncId = crypto.randomUUID();
      const now = new Date().toISOString();
      setError(null);
      setPending(syncId);
      const optimistic = applyTaskWrite(prev, {
        type: 'upsert',
        row: buildOptimisticTaskRow(input, { syncId, taskId: 0, project }),
      });
      patchTasks(optimistic);
      try {
        const { data, error: e } = await getSupabase()
          .from('tasks')
          .insert(buildTaskInsert(input, { syncId, now }))
          .select('id')
          .single();
        if (e) throw e;
        const realId = (data as { id: number } | null)?.id;
        if (realId) {
          patchTasks(
            applyTaskWrite(optimistic, {
              type: 'upsert',
              row: buildOptimisticTaskRow(input, { syncId, taskId: realId, project }),
            }),
          );
        }
      } catch (err) {
        patchTasks(prev);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [tasks, resolveProject, patchTasks],
  );

  const updateTask = useCallback(
    async (syncId: string, input: TaskWriteInput) => {
      const prev = tasks;
      const existing = prev.find((t) => t.syncId === syncId);
      if (!existing) return;
      if (!canEditTask(existing.status)) {
        setError('Úkol je uzavřen (Hotovo)');
        return;
      }
      const project = resolveProject(input.epicId);
      if (!project) {
        setError('Projekt nenalezen');
        return;
      }
      const now = new Date().toISOString();
      setError(null);
      setPending(syncId);
      patchTasks(applyTaskWrite(prev, { type: 'upsert', row: buildEditedTaskRow(existing, input, project) }));
      try {
        const { error: e } = await getSupabase().from('tasks').update(buildTaskUpdate(input, { now })).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchTasks(prev);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [tasks, resolveProject, patchTasks],
  );

  const deleteTask = useCallback(
    async (syncId: string) => {
      const prev = tasks;
      const existing = prev.find((t) => t.syncId === syncId);
      if (!existing) return;
      if (!canEditTask(existing.status)) {
        setError('Úkol je uzavřen (Hotovo)');
        return;
      }
      const now = new Date().toISOString();
      setError(null);
      setPending(syncId);
      patchTasks(applyTaskWrite(prev, { type: 'remove', syncId }));
      try {
        const { error: e } = await getSupabase().from('tasks').update(buildTaskDelete(now)).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchTasks(prev);
        setError(err instanceof Error ? err.message : 'Smazání selhalo');
      } finally {
        setPending(null);
      }
    },
    [tasks, patchTasks],
  );

  return { createTask, updateTask, deleteTask, pending, error };
}
