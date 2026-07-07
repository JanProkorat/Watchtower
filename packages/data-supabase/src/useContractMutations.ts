import { useState, useCallback } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabaseClient.js';
import { contractsOverlap } from '@watchtower/shared/billing/contracts-overlap.js';
import { previousDay } from '@watchtower/shared/billing/date-helpers.js';
import type { ContractRow, WorklogRow } from '@watchtower/shared/billing/types.js';
import { formatDateCz } from '@watchtower/ui-core';
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

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const overlapMsg = (c: ContractRow) =>
  `Sazba se překrývá s obdobím od ${formatDateCz(c.effectiveFrom)}${c.endDate ? ` do ${formatDateCz(c.endDate)}` : ''}`;

// Grouped operations touch several projects at once — a plain overlap message
// doesn't say WHICH one conflicted. ContractRow/ContractWriteInput carry no
// project name (that lives on WorklogRow/TaskRow only), so the id is the only
// identifier available here without threading a projects list into this hook
// (out of Task 16's scope — the caller/UI can look the id up if it wants a name).
const overlapMsgForProject = (c: ContractRow, projectId: number) => `Projekt #${projectId}: ${overlapMsg(c)}`;

// ---------------------------------------------------------------------------
// Pure orchestration core — no React. Each function performs exactly what the
// old single-project hook body did (auto-close-prior check, overlap guard,
// optimistic cache patch, Supabase write, rollback-on-error), generalized to
// N member projects sharing one `contract_group_id`. The hook below is a thin
// useState/useCallback shell that injects `getSupabase()` and the two React
// state setters as `setPending`/`setError`.
//
// Exported (not hook-internal) so it's unit-testable with a fake Supabase
// client — this repo has no jsdom/testing-library/react-test-renderer set up,
// so a real hook can't be legally rendered outside a React tree in tests.
// ---------------------------------------------------------------------------

export interface CoreDeps {
  contracts: ContractRow[];
  worklogs: WorklogRow[];
  patchContracts(next: ContractRow[]): void;
  patchWorklogs(next: WorklogRow[]): void;
  setPending(token: string | null): void;
  setError(msg: string | null): void;
  supabase: SupabaseClient;
}

// First overlapping contract on the same project (excluding `excludeSyncId`), or null.
function findOverlap(contracts: ContractRow[], input: ContractWriteInput, excludeSyncId: string | null): ContractRow | null {
  return (
    contracts.find(
      (c) =>
        c.projectId === input.projectId &&
        c.syncId !== excludeSyncId &&
        contractsOverlap(c.effectiveFrom, c.endDate, input.effectiveFrom, input.endDate),
    ) ?? null
  );
}

// Create-like precheck for one project: auto-close a prior open-ended contract
// starting earlier, then overlap-check against the projection with that prior
// already closed (so the prior being closed doesn't false-trip the check).
function precheckCreate(
  contracts: ContractRow[],
  projectId: number,
  input: { effectiveFrom: string; endDate: string | null },
): { prior: ContractRow | null; closedPrior: ContractRow | null; conflict: ContractRow | null } {
  const prior =
    contracts.find((c) => c.projectId === projectId && c.endDate === null && c.effectiveFrom < input.effectiveFrom) ?? null;
  const closedPrior = prior ? { ...prior, endDate: previousDay(input.effectiveFrom) } : null;
  const projected = closedPrior ? contracts.map((c) => (c.syncId === prior!.syncId ? closedPrior : c)) : contracts;
  const conflict =
    projected.find((c) => c.projectId === projectId && contractsOverlap(c.effectiveFrom, c.endDate, input.effectiveFrom, input.endDate)) ??
    null;
  return { prior, closedPrior, conflict };
}

/** createContract — solo (`projectIds.length <= 1`) or shared-group create. */
export async function createContractCore(
  deps: CoreDeps,
  input: ContractWriteInput,
  projectIds: number[],
): Promise<void> {
  const { contracts, worklogs, patchContracts, patchWorklogs, setPending, setError, supabase } = deps;
  const targets = projectIds.length > 0 ? projectIds : [input.projectId];
  const now = new Date().toISOString();

  if (targets.length <= 1) {
    const projectId = targets[0] ?? input.projectId;
    const soloInput: ContractWriteInput = { ...input, projectId };
    const { prior, closedPrior, conflict } = precheckCreate(contracts, projectId, soloInput);
    if (conflict) {
      setError(overlapMsg(conflict));
      return;
    }
    setError(null);

    const syncId = crypto.randomUUID();
    let nextContracts = contracts;
    if (closedPrior) nextContracts = applyContractWrite(nextContracts, { type: 'upsert', row: closedPrior });
    nextContracts = applyContractWrite(nextContracts, { type: 'upsert', row: buildOptimisticContractRow(soloInput, syncId) });

    const prevC = contracts;
    const prevW = worklogs;
    setPending(syncId);
    patchContracts(nextContracts);
    patchWorklogs(rebillProjectWorklogs(worklogs, projectId, nextContracts));
    try {
      if (prior) {
        const { error: e1 } = await supabase
          .from('contracts')
          .update(buildContractEndDateUpdate(previousDay(soloInput.effectiveFrom), now))
          .eq('sync_id', prior.syncId);
        if (e1) throw e1;
      }
      const { error: e2 } = await supabase.from('contracts').insert(buildContractInsert(soloInput, { syncId, now }));
      if (e2) throw e2;
    } catch (err) {
      patchContracts(prevC);
      patchWorklogs(prevW);
      setError(err instanceof Error ? err.message : 'Uložení selhalo');
    } finally {
      setPending(null);
    }
    return;
  }

  // Group create — mint one group id, precheck EVERY member project against
  // the pristine cache before writing anything: any conflict aborts the whole
  // group (no partial group ever gets written).
  const groupId = crypto.randomUUID();
  const plans: Array<{ projectId: number; input: ContractWriteInput; prior: ContractRow | null; closedPrior: ContractRow | null; syncId: string }> = [];
  for (const projectId of targets) {
    const projInput: ContractWriteInput = { ...input, projectId };
    const { prior, closedPrior, conflict } = precheckCreate(contracts, projectId, projInput);
    if (conflict) {
      setError(overlapMsgForProject(conflict, projectId));
      return;
    }
    plans.push({ projectId, input: projInput, prior, closedPrior, syncId: crypto.randomUUID() });
  }
  setError(null);

  let nextContracts = contracts;
  for (const plan of plans) {
    if (plan.closedPrior) nextContracts = applyContractWrite(nextContracts, { type: 'upsert', row: plan.closedPrior });
    nextContracts = applyContractWrite(nextContracts, { type: 'upsert', row: buildOptimisticContractRow(plan.input, plan.syncId, groupId) });
  }
  const prevC = contracts;
  const prevW = worklogs;
  setPending(groupId);
  patchContracts(nextContracts);
  let nextW = worklogs;
  for (const projectId of targets) nextW = rebillProjectWorklogs(nextW, projectId, nextContracts);
  patchWorklogs(nextW);

  try {
    for (const plan of plans) {
      if (plan.prior) {
        const { error: e1 } = await supabase
          .from('contracts')
          .update(buildContractEndDateUpdate(previousDay(plan.input.effectiveFrom), now))
          .eq('sync_id', plan.prior.syncId);
        if (e1) throw e1;
      }
    }
    const rows = plans.map((plan) => buildContractInsert(plan.input, { syncId: plan.syncId, now, groupId }));
    const { error: e2 } = await supabase.from('contracts').insert(rows);
    if (e2) throw e2;
  } catch (err) {
    patchContracts(prevC);
    patchWorklogs(prevW);
    setError(err instanceof Error ? err.message : 'Uložení selhalo');
  } finally {
    setPending(null);
  }
}

/** updateContract — solo (row has no `contractGroupId`) or shared-group update. */
export async function updateContractCore(
  deps: CoreDeps,
  syncId: string,
  input: ContractWriteInput,
  projectIds: number[],
): Promise<void> {
  const { contracts, worklogs, patchContracts, patchWorklogs, setPending, setError, supabase } = deps;
  const now = new Date().toISOString();
  const existing = contracts.find((c) => c.syncId === syncId) ?? null;

  if (!existing?.contractGroupId) {
    // Solo path — unchanged behavior; membership reconciliation (projectIds)
    // doesn't apply to a row that isn't part of a group.
    const conflict = findOverlap(contracts, input, syncId);
    if (conflict) {
      setError(overlapMsg(conflict));
      return;
    }
    setError(null);
    const nextContracts = applyContractWrite(contracts, { type: 'upsert', row: buildOptimisticContractRow(input, syncId) });
    const prevC = contracts;
    const prevW = worklogs;
    setPending(syncId);
    patchContracts(nextContracts);
    patchWorklogs(rebillProjectWorklogs(worklogs, input.projectId, nextContracts));
    try {
      const { error } = await supabase.from('contracts').update(buildContractUpdate(input, { now })).eq('sync_id', syncId);
      if (error) throw error;
    } catch (err) {
      patchContracts(prevC);
      patchWorklogs(prevW);
      setError(err instanceof Error ? err.message : 'Uložení selhalo');
    } finally {
      setPending(null);
    }
    return;
  }

  // Group path — propagate terms to every listed project, reconciling
  // membership: existing members not in `projectIds` are dropped (soft-deleted),
  // newly-listed projects are inserted (auto-close + overlap checked like create).
  const groupId = existing.contractGroupId;
  const currentMembers = contracts.filter((c) => c.contractGroupId === groupId);
  const currentProjectIds = currentMembers.map((c) => c.projectId);
  const target = projectIds.length > 0 ? projectIds : currentProjectIds;

  type Plan =
    | { kind: 'update'; row: ContractRow; input: ContractWriteInput }
    | { kind: 'insert'; input: ContractWriteInput; prior: ContractRow | null; closedPrior: ContractRow | null; syncId: string };
  const plans: Plan[] = [];
  for (const projectId of target) {
    const projInput: ContractWriteInput = { ...input, projectId };
    const member = currentMembers.find((m) => m.projectId === projectId);
    if (member) {
      const conflict = findOverlap(contracts, projInput, member.syncId);
      if (conflict) {
        setError(overlapMsgForProject(conflict, projectId));
        return;
      }
      plans.push({ kind: 'update', row: member, input: projInput });
    } else {
      const { prior, closedPrior, conflict } = precheckCreate(contracts, projectId, projInput);
      if (conflict) {
        setError(overlapMsgForProject(conflict, projectId));
        return;
      }
      plans.push({ kind: 'insert', input: projInput, prior, closedPrior, syncId: crypto.randomUUID() });
    }
  }
  setError(null);

  const removed = currentMembers.filter((m) => !target.includes(m.projectId));

  let nextContracts = contracts;
  for (const m of removed) nextContracts = applyContractWrite(nextContracts, { type: 'remove', syncId: m.syncId });
  for (const plan of plans) {
    if (plan.kind === 'update') {
      nextContracts = applyContractWrite(nextContracts, {
        type: 'upsert',
        row: {
          ...plan.row,
          effectiveFrom: plan.input.effectiveFrom,
          endDate: plan.input.endDate,
          rateType: plan.input.rateType,
          rateAmount: plan.input.rateAmount,
          hoursPerDay: plan.input.hoursPerDay,
          mdLimit: plan.input.mdLimit,
        },
      });
    } else {
      if (plan.closedPrior) nextContracts = applyContractWrite(nextContracts, { type: 'upsert', row: plan.closedPrior });
      nextContracts = applyContractWrite(nextContracts, { type: 'upsert', row: buildOptimisticContractRow(plan.input, plan.syncId, groupId) });
    }
  }

  const prevC = contracts;
  const prevW = worklogs;
  setPending(groupId);
  patchContracts(nextContracts);
  // Rebill every project that was, or now is, a member — a dropped member's
  // worklogs need re-derivation too (they just lost their contract).
  const affected = Array.from(new Set([...currentProjectIds, ...target]));
  let nextW = worklogs;
  for (const projectId of affected) nextW = rebillProjectWorklogs(nextW, projectId, nextContracts);
  patchWorklogs(nextW);

  try {
    for (const m of removed) {
      const { error } = await supabase.from('contracts').update(buildContractDelete(now)).eq('sync_id', m.syncId);
      if (error) throw error;
    }
    for (const plan of plans) {
      if (plan.kind === 'update') {
        const { error } = await supabase.from('contracts').update(buildContractUpdate(plan.input, { now })).eq('sync_id', plan.row.syncId);
        if (error) throw error;
      } else {
        if (plan.prior) {
          const { error: e1 } = await supabase
            .from('contracts')
            .update(buildContractEndDateUpdate(previousDay(plan.input.effectiveFrom), now))
            .eq('sync_id', plan.prior.syncId);
          if (e1) throw e1;
        }
        const { error: e2 } = await supabase.from('contracts').insert(buildContractInsert(plan.input, { syncId: plan.syncId, now, groupId }));
        if (e2) throw e2;
      }
    }
  } catch (err) {
    patchContracts(prevC);
    patchWorklogs(prevW);
    setError(err instanceof Error ? err.message : 'Uložení selhalo');
  } finally {
    setPending(null);
  }
}

/** deleteContract — solo row, or every row sharing the target's `contractGroupId`. */
export async function deleteContractCore(deps: CoreDeps, syncId: string): Promise<void> {
  const { contracts, worklogs, patchContracts, patchWorklogs, setPending, setError, supabase } = deps;
  const existing = contracts.find((c) => c.syncId === syncId);
  if (!existing) return;
  const now = new Date().toISOString();

  if (!existing.contractGroupId) {
    const prevC = contracts;
    const prevW = worklogs;
    const nextContracts = applyContractWrite(contracts, { type: 'remove', syncId });
    setError(null);
    setPending(syncId);
    patchContracts(nextContracts);
    patchWorklogs(rebillProjectWorklogs(worklogs, existing.projectId, nextContracts));
    try {
      const { error } = await supabase.from('contracts').update(buildContractDelete(now)).eq('sync_id', syncId);
      if (error) throw error;
    } catch (err) {
      patchContracts(prevC);
      patchWorklogs(prevW);
      setError(err instanceof Error ? err.message : 'Smazání selhalo');
    } finally {
      setPending(null);
    }
    return;
  }

  const groupId = existing.contractGroupId;
  const members = contracts.filter((c) => c.contractGroupId === groupId);
  const nextContracts = contracts.filter((c) => c.contractGroupId !== groupId);
  const prevC = contracts;
  const prevW = worklogs;
  setError(null);
  setPending(groupId);
  patchContracts(nextContracts);
  let nextW = worklogs;
  for (const m of members) nextW = rebillProjectWorklogs(nextW, m.projectId, nextContracts);
  patchWorklogs(nextW);
  try {
    const { error } = await supabase.from('contracts').update(buildContractDelete(now)).eq('contract_group_id', groupId);
    if (error) throw error;
  } catch (err) {
    patchContracts(prevC);
    patchWorklogs(prevW);
    setError(err instanceof Error ? err.message : 'Smazání selhalo');
  } finally {
    setPending(null);
  }
}

// ---------------------------------------------------------------------------
// Hook — thin React shell around the core functions above.
// ---------------------------------------------------------------------------

export function useContractMutations({ contracts, worklogs, patchContracts, patchWorklogs }: Args) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createContract = useCallback(
    (input: ContractWriteInput, projectIds: number[] = [input.projectId]) =>
      createContractCore(
        { contracts, worklogs, patchContracts, patchWorklogs, setPending, setError, supabase: getSupabase() },
        input,
        projectIds,
      ),
    [contracts, worklogs, patchContracts, patchWorklogs],
  );

  const updateContract = useCallback(
    (syncId: string, input: ContractWriteInput, projectIds: number[] = []) =>
      updateContractCore(
        { contracts, worklogs, patchContracts, patchWorklogs, setPending, setError, supabase: getSupabase() },
        syncId,
        input,
        projectIds,
      ),
    [contracts, worklogs, patchContracts, patchWorklogs],
  );

  const deleteContract = useCallback(
    (syncId: string) =>
      deleteContractCore(
        { contracts, worklogs, patchContracts, patchWorklogs, setPending, setError, supabase: getSupabase() },
        syncId,
      ),
    [contracts, worklogs, patchContracts, patchWorklogs],
  );

  return { createContract, updateContract, deleteContract, pending, error };
}
