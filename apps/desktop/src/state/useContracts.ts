import { useCallback, useEffect, useState } from 'react';
import type {
  ContractInputPayload,
  ContractViewPayload,
} from '@watchtower/shared/ipcContract.js';

export interface OverlapErrorInfo {
  conflictingId: number;
  conflictingFrom: string;
  conflictingTo: string | null;
  conflictingProjectId: number;
  conflictingProjectName: string;
}

export interface ContractsState {
  contracts: ContractViewPayload[];
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  /**
   * Returns the new contract on success or `OverlapErrorInfo` if the
   * orchestrator rejected the range as overlapping. Anything else rethrows.
   */
  create(input: ContractInputPayload): Promise<ContractViewPayload | OverlapErrorInfo>;
  update(
    id: number,
    input: Partial<ContractInputPayload>,
  ): Promise<ContractViewPayload | OverlapErrorInfo>;
  remove(id: number): Promise<void>;
}

function isOverlap(p: unknown): p is OverlapErrorInfo & { error: 'overlap' } {
  return (
    typeof p === 'object' &&
    p != null &&
    (p as { error?: string }).error === 'overlap'
  );
}

export function useContracts(projectId: number): ContractsState {
  const [contracts, setContracts] = useState<ContractViewPayload[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.watchtower.invoke('contracts:listForProject', { projectId });
      setContracts(res.contracts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: ContractInputPayload) => {
      const res = await window.watchtower.invoke('contracts:create', input);
      if (isOverlap(res)) {
        return {
          conflictingId: res.conflictingId,
          conflictingFrom: res.conflictingFrom,
          conflictingTo: res.conflictingTo,
          conflictingProjectId: res.conflictingProjectId,
          conflictingProjectName: res.conflictingProjectName,
        };
      }
      await refresh();
      return res.contract;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: number, input: Partial<ContractInputPayload>) => {
      const res = await window.watchtower.invoke('contracts:update', { id, input });
      if (isOverlap(res)) {
        return {
          conflictingId: res.conflictingId,
          conflictingFrom: res.conflictingFrom,
          conflictingTo: res.conflictingTo,
          conflictingProjectId: res.conflictingProjectId,
          conflictingProjectName: res.conflictingProjectName,
        };
      }
      await refresh();
      return res.contract;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      await window.watchtower.invoke('contracts:delete', { id });
      await refresh();
    },
    [refresh],
  );

  return { contracts, loading, error, refresh, create, update, remove };
}
