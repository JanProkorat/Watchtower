import { useState, useCallback } from 'react';
import { getSupabase } from '../lib/supabaseClient.js';
import { contractsOverlap } from '@watchtower/shared/billing/contracts-overlap.js';
import { previousDay } from '@watchtower/shared/billing/date-helpers.js';
import type { ContractRow, WorklogRow } from '@watchtower/shared/billing/types.js';
import { formatDateCz } from '../lib/czFormat.js';
import {
  buildContractInsert,
  buildContractUpdate,
  buildContractEndDateUpdate,
  buildContractDelete,
  buildOptimisticContractRow,
  applyContractWrite,
  rebillProjectWorklogs,
  type ContractWriteInput,
} from './billingWrites.js';

interface Args {
  contracts: ContractRow[];
  worklogs: WorklogRow[];
  patchContracts(next: ContractRow[]): void;
  patchWorklogs(next: WorklogRow[]): void;
}

export function useContractMutations({ contracts, worklogs, patchContracts, patchWorklogs }: Args) {
  const [pending, setPending] = useState<string | null>(null); // syncId being written
  const [error, setError] = useState<string | null>(null);

  // First overlapping contract on the same project (excluding `excludeSyncId`), or null.
  const findOverlap = useCallback(
    (input: ContractWriteInput, excludeSyncId: string | null): ContractRow | null => {
      return (
        contracts.find(
          (c) =>
            c.projectId === input.projectId &&
            c.syncId !== excludeSyncId &&
            contractsOverlap(c.effectiveFrom, c.endDate, input.effectiveFrom, input.endDate),
        ) ?? null
      );
    },
    [contracts],
  );

  // Apply contract change + cache rebill of the project's worklogs, optimistically.
  const applyOptimistic = useCallback(
    (nextContracts: ContractRow[], projectId: number) => {
      patchContracts(nextContracts);
      patchWorklogs(rebillProjectWorklogs(worklogs, projectId, nextContracts));
    },
    [worklogs, patchContracts, patchWorklogs],
  );

  const overlapMsg = (c: ContractRow) =>
    `Sazba se překrývá s obdobím od ${formatDateCz(c.effectiveFrom)}${c.endDate ? ` do ${formatDateCz(c.endDate)}` : ''}`;

  const createContract = useCallback(
    async (input: ContractWriteInput) => {
      const prevC = contracts;
      const prevW = worklogs;
      const syncId = crypto.randomUUID();
      const now = new Date().toISOString();
      // Auto-close a prior open-ended contract on the same project starting earlier.
      const prior = contracts.find(
        (c) => c.projectId === input.projectId && c.endDate === null && c.effectiveFrom < input.effectiveFrom,
      );
      const closedPrior = prior ? { ...prior, endDate: previousDay(input.effectiveFrom) } : null;
      // Guard against the POST-auto-close projection so the prior we're about to close
      // doesn't false-trip the overlap check; any other overlapping contract still blocks.
      const projected = closedPrior ? contracts.map((c) => (c.syncId === prior!.syncId ? closedPrior : c)) : contracts;
      const conflict = projected.find(
        (c) => c.projectId === input.projectId && contractsOverlap(c.effectiveFrom, c.endDate, input.effectiveFrom, input.endDate),
      ) ?? null;
      if (conflict) { setError(overlapMsg(conflict)); return; }
      setError(null);
      let nextContracts = contracts;
      if (closedPrior) {
        nextContracts = applyContractWrite(nextContracts, { type: 'upsert', row: closedPrior });
      }
      nextContracts = applyContractWrite(nextContracts, { type: 'upsert', row: buildOptimisticContractRow(input, syncId) });
      setPending(syncId);
      applyOptimistic(nextContracts, input.projectId);
      try {
        if (prior) {
          const { error: e1 } = await getSupabase().from('contracts').update(buildContractEndDateUpdate(previousDay(input.effectiveFrom), now)).eq('sync_id', prior.syncId);
          if (e1) throw e1;
        }
        const { error: e2 } = await getSupabase().from('contracts').insert(buildContractInsert(input, { syncId, now }));
        if (e2) throw e2;
      } catch (err) {
        patchContracts(prevC);
        patchWorklogs(prevW);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [contracts, worklogs, applyOptimistic, patchContracts, patchWorklogs],
  );

  const updateContract = useCallback(
    async (syncId: string, input: ContractWriteInput) => {
      const prevC = contracts;
      const prevW = worklogs;
      const conflict = findOverlap(input, syncId);
      if (conflict) { setError(overlapMsg(conflict)); return; }
      const now = new Date().toISOString();
      const nextContracts = applyContractWrite(contracts, { type: 'upsert', row: buildOptimisticContractRow(input, syncId) });
      setError(null);
      setPending(syncId);
      applyOptimistic(nextContracts, input.projectId);
      try {
        const { error: e } = await getSupabase().from('contracts').update(buildContractUpdate(input, { now })).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchContracts(prevC);
        patchWorklogs(prevW);
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [contracts, worklogs, findOverlap, applyOptimistic, patchContracts, patchWorklogs],
  );

  const deleteContract = useCallback(
    async (syncId: string) => {
      const prevC = contracts;
      const prevW = worklogs;
      const existing = prevC.find((c) => c.syncId === syncId);
      if (!existing) return;
      const now = new Date().toISOString();
      const nextContracts = applyContractWrite(contracts, { type: 'remove', syncId });
      setError(null);
      setPending(syncId);
      applyOptimistic(nextContracts, existing.projectId);
      try {
        const { error: e } = await getSupabase().from('contracts').update(buildContractDelete(now)).eq('sync_id', syncId);
        if (e) throw e;
      } catch (err) {
        patchContracts(prevC);
        patchWorklogs(prevW);
        setError(err instanceof Error ? err.message : 'Smazání selhalo');
      } finally {
        setPending(null);
      }
    },
    [contracts, worklogs, applyOptimistic, patchContracts, patchWorklogs],
  );

  return { createContract, updateContract, deleteContract, pending, error };
}
