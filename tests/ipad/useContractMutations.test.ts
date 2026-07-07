// useContractMutations' async orchestration (auto-close-prior, overlap guard,
// optimistic cache patch, Supabase write, rollback-on-error) is extracted into
// plain async "core" functions (createContractCore/updateContractCore/
// deleteContractCore) that take an injected Supabase-shaped client instead of
// calling getSupabase() directly. This repo has no jsdom/testing-library/
// react-test-renderer set up anywhere (grep turned up zero *.test.tsx and no
// hook-rendering harness), so hooks can't be legally invoked outside a React
// render tree; the core functions are the testable surface, and the real hook
// (useContractMutations) is a thin useState/useCallback shell around them.
import { describe, it, expect, vi } from 'vitest';
import {
  createContractCore,
  updateContractCore,
  deleteContractCore,
  type CoreDeps,
} from '@watchtower/data-supabase';
import type { ContractRow, WorklogRow } from '@watchtower/shared/billing/types.js';

// --- fake Supabase client --------------------------------------------------

interface Call {
  table: string;
  op: 'insert' | 'update';
  rows?: unknown;
  row?: unknown;
  col?: string;
  val?: unknown;
}

function fakeSupabase(opts: { failOn?: (call: Call) => boolean } = {}) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => ({
    insert: vi.fn(async (rows: unknown) => {
      const call: Call = { table, op: 'insert', rows };
      calls.push(call);
      if (opts.failOn?.(call)) return { error: new Error('insert failed') };
      return { error: null };
    }),
    update: vi.fn((row: unknown) => ({
      eq: vi.fn(async (col: string, val: unknown) => {
        const call: Call = { table, op: 'update', row, col, val };
        calls.push(call);
        if (opts.failOn?.(call)) return { error: new Error('update failed') };
        return { error: null };
      }),
    })),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: { from } as any, calls };
}

function makeDeps(overrides: Partial<CoreDeps> = {}): CoreDeps & { calls: Call[] } {
  const { supabase, calls } = fakeSupabase();
  return {
    contracts: [],
    worklogs: [],
    patchContracts: vi.fn(),
    patchWorklogs: vi.fn(),
    setPending: vi.fn(),
    setError: vi.fn(),
    supabase,
    calls,
    ...overrides,
  };
}

const contract = (over: Partial<ContractRow> & { projectId: number }): ContractRow => ({
  syncId: `c-${over.projectId}`,
  effectiveFrom: '2026-01-01',
  endDate: null,
  rateType: 'hourly',
  rateAmount: 100,
  hoursPerDay: 8,
  mdLimit: null,
  contractGroupId: null,
  ...over,
});

const wl = (syncId: string, projectId: number): WorklogRow => ({
  syncId, workDate: '2026-06-01', minutes: 60, reportedMinutes: null, effectiveMinutes: 60,
  earnedAmount: 0, description: null, projectId, projectName: 'P', projectColor: null,
  projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null, source: 'manual',
});

const cInput = {
  projectId: 1, effectiveFrom: '2026-02-01', endDate: null as string | null,
  rateType: 'hourly' as const, rateAmount: 200, hoursPerDay: 8, mdLimit: null as number | null,
};

// --- createContractCore — group create ------------------------------------

describe('createContractCore — group create', () => {
  it('writes N rows sharing one contract_group_id and patches the cache with all of them', async () => {
    const deps = makeDeps();
    await createContractCore(deps, cInput, [1, 2, 3]);

    expect(deps.setError).toHaveBeenCalledWith(null);
    const insertCall = deps.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    const rows = insertCall!.rows as Array<{ project_id: number; contract_group_id: string | null; sync_id: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.project_id).sort()).toEqual([1, 2, 3]);
    const groupIds = new Set(rows.map((r) => r.contract_group_id));
    expect(groupIds.size).toBe(1);
    expect([...groupIds][0]).not.toBeNull();
    // Each row gets its own sync_id.
    expect(new Set(rows.map((r) => r.sync_id)).size).toBe(3);

    expect(deps.patchContracts).toHaveBeenCalledTimes(1);
    const patched = (deps.patchContracts as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ContractRow[];
    expect(patched).toHaveLength(3);
    expect(patched.every((c) => c.contractGroupId === [...groupIds][0])).toBe(true);
    expect(patched.map((c) => c.projectId).sort()).toEqual([1, 2, 3]);
  });

  it('rebills worklogs for every member project', async () => {
    const deps = makeDeps({ worklogs: [wl('w1', 1), wl('w2', 2), wl('w3', 9)] });
    await createContractCore(deps, cInput, [1, 2]);
    expect(deps.patchWorklogs).toHaveBeenCalledTimes(1);
    const nextW = (deps.patchWorklogs as ReturnType<typeof vi.fn>).mock.calls[0]![0] as WorklogRow[];
    expect(nextW.find((w) => w.syncId === 'w1')!.earnedAmount).toBeCloseTo(200); // 60min * 200/60
    expect(nextW.find((w) => w.syncId === 'w2')!.earnedAmount).toBeCloseTo(200);
    expect(nextW.find((w) => w.syncId === 'w3')!.earnedAmount).toBe(0); // untouched — project 9 not in the group
  });

  it('an overlap on one target project aborts WITHOUT writing anything, naming the conflicting project', async () => {
    // effectiveFrom AFTER cInput's so this is a genuine overlap, not a
    // "prior open-ended contract that starts earlier" which precheckCreate
    // auto-closes instead of treating as a conflict.
    const conflicting = contract({ projectId: 2, effectiveFrom: '2026-03-01', endDate: null });
    const deps = makeDeps({ contracts: [conflicting] });

    await createContractCore(deps, cInput, [1, 2, 3]);

    expect(deps.supabase.from).not.toHaveBeenCalled();
    expect(deps.patchContracts).not.toHaveBeenCalled();
    expect(deps.patchWorklogs).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledTimes(1);
    const msg = (deps.setError as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(msg).toContain('2'); // names the conflicting project
  });

  it('rolls back the optimistic cache patch if the Supabase insert fails', async () => {
    const prevC: ContractRow[] = [contract({ projectId: 5 })];
    const prevW: WorklogRow[] = [wl('w5', 5)];
    const { supabase } = fakeSupabase({ failOn: (c) => c.op === 'insert' });
    const deps = makeDeps({ contracts: prevC, worklogs: prevW, supabase });

    await createContractCore(deps, cInput, [1, 2]);

    expect(deps.patchContracts).toHaveBeenLastCalledWith(prevC);
    expect(deps.patchWorklogs).toHaveBeenLastCalledWith(prevW);
    expect(deps.setError).toHaveBeenLastCalledWith('insert failed');
  });
});

// --- createContractCore — solo path preserved ------------------------------

describe('createContractCore — solo (single-element projectIds)', () => {
  it('behaves like a plain single-project create: one insert, no group id', async () => {
    const deps = makeDeps();
    await createContractCore(deps, cInput, [1]);
    const insertCall = deps.calls.find((c) => c.op === 'insert');
    // Solo path preserves today's behavior: insert() receives a single row
    // object (not wrapped in an array), unlike the batched group-create insert.
    const row = insertCall!.rows as { contract_group_id: string | null; project_id: number };
    expect(row.contract_group_id).toBeNull();
    expect(row.project_id).toBe(1);
    expect(deps.patchContracts).toHaveBeenCalledTimes(1);
    const patched = (deps.patchContracts as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ContractRow[];
    expect(patched).toHaveLength(1);
  });

  it('defaults projectIds to [input.projectId] when omitted', async () => {
    const deps = makeDeps();
    await createContractCore(deps, cInput, [cInput.projectId]);
    expect(deps.patchContracts).toHaveBeenCalledTimes(1);
  });
});

// --- updateContractCore — group propagate + reconcile ----------------------

describe('updateContractCore — grouped row', () => {
  it('propagates new terms to every group member and reconciles membership (add + drop)', async () => {
    const groupId = 'g-1';
    const m1 = contract({ projectId: 1, syncId: 'c1', contractGroupId: groupId, rateAmount: 100 });
    const m2 = contract({ projectId: 2, syncId: 'c2', contractGroupId: groupId, rateAmount: 100 });
    const m3 = contract({ projectId: 3, syncId: 'c3', contractGroupId: groupId, rateAmount: 100 }); // to be dropped
    const deps = makeDeps({ contracts: [m1, m2, m3], worklogs: [wl('w1', 1), wl('w2', 2), wl('w3', 3), wl('w4', 4)] });

    // New membership: keep 1, keep 2, drop 3, add 4. New rate 150.
    await updateContractCore(deps, 'c1', { ...cInput, projectId: 1, rateAmount: 150 }, [1, 2, 4]);

    expect(deps.setError).toHaveBeenCalledWith(null);
    expect(deps.patchContracts).toHaveBeenCalledTimes(1);
    const patched = (deps.patchContracts as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ContractRow[];
    const byProject = new Map(patched.map((c) => [c.projectId, c]));
    expect(byProject.has(3)).toBe(false); // dropped member removed from cache
    expect(byProject.get(1)!.rateAmount).toBe(150);
    expect(byProject.get(2)!.rateAmount).toBe(150);
    expect(byProject.get(4)).toBeDefined();
    expect(byProject.get(4)!.contractGroupId).toBe(groupId);

    // Rebills the dropped member too (project 3), since it lost its contract.
    expect(deps.patchWorklogs).toHaveBeenCalledTimes(1);
    const nextW = (deps.patchWorklogs as ReturnType<typeof vi.fn>).mock.calls[0]![0] as WorklogRow[];
    expect(nextW.find((w) => w.syncId === 'w3')!.earnedAmount).toBeNull(); // no contract left for project 3

    // Supabase side-effects: one soft-delete (project 3), two term updates (1, 2), one insert (4).
    const softDelete = deps.calls.find((c) => c.op === 'update' && c.col === 'sync_id' && c.val === 'c3');
    expect(softDelete).toBeDefined();
    const insertCall = deps.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    // The update path writes each plan individually (heterogeneous mix of
    // update/insert/soft-delete), so a single new-member insert is a plain
    // row object, not an array — unlike the batched group-create insert.
    const insertedRow = insertCall!.rows as { project_id: number; contract_group_id: string | null };
    expect(insertedRow.project_id).toBe(4);
    expect(insertedRow.contract_group_id).toBe(groupId);
  });

  it('an overlap on a newly-added project aborts WITHOUT writing anything', async () => {
    const groupId = 'g-2';
    const m1 = contract({ projectId: 1, syncId: 'c1', contractGroupId: groupId });
    // effectiveFrom AFTER cInput's so this is a genuine overlap, not an
    // auto-closed prior (see the createContractCore group-create test above).
    const conflicting = contract({ projectId: 9, syncId: 'c9', effectiveFrom: '2026-03-01', endDate: null });
    const deps = makeDeps({ contracts: [m1, conflicting] });

    await updateContractCore(deps, 'c1', { ...cInput, projectId: 1 }, [1, 9]);

    expect(deps.supabase.from).not.toHaveBeenCalled();
    expect(deps.patchContracts).not.toHaveBeenCalled();
    const msg = (deps.setError as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(msg).toContain('9');
  });
});

describe('updateContractCore — solo row (no contractGroupId)', () => {
  it('ignores projectIds and behaves like a plain single-project update', async () => {
    const solo = contract({ projectId: 1, syncId: 'c1', contractGroupId: null });
    const deps = makeDeps({ contracts: [solo] });
    await updateContractCore(deps, 'c1', { ...cInput, projectId: 1, rateAmount: 300 }, [1, 2]);
    const patched = (deps.patchContracts as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ContractRow[];
    expect(patched).toHaveLength(1);
    expect(patched[0]!.rateAmount).toBe(300);
    expect(patched[0]!.contractGroupId).toBeNull();
  });
});

// --- deleteContractCore -----------------------------------------------------

describe('deleteContractCore', () => {
  it('grouped delete removes ALL members from the cache and soft-deletes them by group id', async () => {
    const groupId = 'g-3';
    const m1 = contract({ projectId: 1, syncId: 'c1', contractGroupId: groupId });
    const m2 = contract({ projectId: 2, syncId: 'c2', contractGroupId: groupId });
    const other = contract({ projectId: 9, syncId: 'c9', contractGroupId: null });
    const deps = makeDeps({ contracts: [m1, m2, other], worklogs: [wl('w1', 1), wl('w2', 2)] });

    await deleteContractCore(deps, 'c1');

    expect(deps.patchContracts).toHaveBeenCalledTimes(1);
    const patched = (deps.patchContracts as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ContractRow[];
    expect(patched.map((c) => c.syncId)).toEqual(['c9']);

    const groupDelete = deps.calls.find((c) => c.op === 'update' && c.col === 'contract_group_id' && c.val === groupId);
    expect(groupDelete).toBeDefined();
  });

  it('solo delete removes only the target row', async () => {
    const solo = contract({ projectId: 1, syncId: 'c1', contractGroupId: null });
    const other = contract({ projectId: 2, syncId: 'c2', contractGroupId: null });
    const deps = makeDeps({ contracts: [solo, other] });
    await deleteContractCore(deps, 'c1');
    const patched = (deps.patchContracts as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ContractRow[];
    expect(patched.map((c) => c.syncId)).toEqual(['c2']);
    const rowDelete = deps.calls.find((c) => c.op === 'update' && c.col === 'sync_id' && c.val === 'c1');
    expect(rowDelete).toBeDefined();
  });
});
