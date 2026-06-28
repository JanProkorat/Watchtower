import { useState, useCallback } from 'react';
import { getSupabase } from '../lib/supabaseClient.js';
import type { WorklogRow, ContractRow, TaskRow } from '@watchtower/shared/billing/types.js';
import {
  computeDerivedForWrite,
  buildWorklogInsert,
  buildWorklogUpdate,
  buildWorklogDelete,
  buildOptimisticWorklogRow,
  buildEditedWorklogRow,
  applyWorklogWrite,
  type WorklogWriteInput,
} from './billingWrites.js';

interface Args {
  worklogs: WorklogRow[];
  contracts: ContractRow[];
  patchWorklogs(next: WorklogRow[]): void;
}

type WorklogEdit = { workDate: string; minutes: number; reportedMinutes: number | null; description: string | null };

export function useWorklogMutations({ worklogs, contracts, patchWorklogs }: Args) {
  const [pending, setPending] = useState<string | null>(null); // syncId being written
  const [error, setError] = useState<string | null>(null);

  const createWorklog = useCallback(
    async (task: TaskRow, input: WorklogWriteInput) => {
      const prev = worklogs;
      const syncId = crypto.randomUUID();
      const now = new Date().toISOString();
      const billing = computeDerivedForWrite(contracts, task.projectId, input);
      setError(null);
      setPending(syncId);
      patchWorklogs(applyWorklogWrite(prev, { type: 'upsert', row: buildOptimisticWorklogRow(task, input, billing, syncId) }));
      try {
        const { error: e } = await getSupabase().from('worklogs').insert(buildWorklogInsert(input, { syncId, now, billing }));
        if (e) throw e;
      } catch (err) {
        patchWorklogs(prev);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [worklogs, contracts, patchWorklogs],
  );

  const updateWorklog = useCallback(
    async (syncId: string, input: WorklogEdit) => {
      const prev = worklogs;
      const existing = prev.find((w) => w.syncId === syncId);
      if (!existing) return;
      const now = new Date().toISOString();
      const billing = computeDerivedForWrite(contracts, existing.projectId, input);
      setError(null);
      setPending(syncId);
      patchWorklogs(applyWorklogWrite(prev, { type: 'upsert', row: buildEditedWorklogRow(existing, input, billing) }));
      try {
        const { error: e } = await getSupabase().from('worklogs').update(buildWorklogUpdate(input, { now, billing })).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchWorklogs(prev);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [worklogs, contracts, patchWorklogs],
  );

  const deleteWorklog = useCallback(
    async (syncId: string) => {
      const prev = worklogs;
      const now = new Date().toISOString();
      setError(null);
      setPending(syncId);
      patchWorklogs(applyWorklogWrite(prev, { type: 'remove', syncId }));
      try {
        const { error: e } = await getSupabase().from('worklogs').update(buildWorklogDelete(now)).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchWorklogs(prev);
        setError(err instanceof Error ? err.message : 'Smazání selhalo');
      } finally {
        setPending(null);
      }
    },
    [worklogs, patchWorklogs],
  );

  return { createWorklog, updateWorklog, deleteWorklog, pending, error };
}
