import { describe, it, expect } from 'vitest';
import {
  assignWorklogToContract,
  rateLabel,
  rollupEarningsByContract,
  activeContract,
} from '../../apps/ipad/src/lib/projectDetailHelpers.js';
import type { ContractRow, WorklogRow } from '@watchtower/shared/billing/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContract(overrides: Partial<ContractRow> & { effectiveFrom: string }): ContractRow {
  return {
    syncId: overrides.syncId ?? 'c-test',
    projectId: 1,
    effectiveFrom: overrides.effectiveFrom,
    endDate: overrides.endDate ?? null,
    rateType: overrides.rateType ?? 'hourly',
    rateAmount: overrides.rateAmount ?? 1500,
    hoursPerDay: overrides.hoursPerDay ?? 8,
    mdLimit: overrides.mdLimit ?? null,
  };
}

function makeWorklog(overrides: {
  workDate: string;
  earnedAmount?: number | null;
}): WorklogRow {
  // Preserve explicit null — only default to 1500 when key is absent.
  const earnedAmount = Object.prototype.hasOwnProperty.call(overrides, 'earnedAmount')
    ? (overrides.earnedAmount as number | null)
    : 1500;
  return {
    syncId: 'wl-' + overrides.workDate,
    workDate: overrides.workDate,
    minutes: 60,
    effectiveMinutes: 60,
    earnedAmount,
    projectId: 1,
    projectName: 'Test',
    projectColor: null,
    projectKind: 'work',
    isBillable: true,
    taskNumber: null,
    taskTitle: null,
  };
}

// ---------------------------------------------------------------------------
// assignWorklogToContract
// ---------------------------------------------------------------------------

describe('assignWorklogToContract', () => {
  const c1 = makeContract({ effectiveFrom: '2026-01-01', rateAmount: 1000 });
  const c2 = makeContract({ effectiveFrom: '2026-04-01', rateAmount: 1500 });
  const c3 = makeContract({ effectiveFrom: '2026-07-01', rateAmount: 2000 });

  it('returns null when no contracts qualify', () => {
    expect(assignWorklogToContract('2025-12-31', [c1, c2])).toBeNull();
  });

  it('picks the contract whose effectiveFrom equals the workDate', () => {
    expect(assignWorklogToContract('2026-01-01', [c1, c2])).toBe(c1);
    expect(assignWorklogToContract('2026-04-01', [c1, c2])).toBe(c2);
  });

  it('picks the latest effectiveFrom that is still <= workDate', () => {
    expect(assignWorklogToContract('2026-03-15', [c1, c2])).toBe(c1);
    expect(assignWorklogToContract('2026-06-30', [c1, c2])).toBe(c2);
    expect(assignWorklogToContract('2026-07-05', [c1, c2, c3])).toBe(c3);
  });

  it('handles a single contract', () => {
    expect(assignWorklogToContract('2026-05-01', [c2])).toBe(c2);
    expect(assignWorklogToContract('2026-03-31', [c2])).toBeNull();
  });

  it('does not use endDate for assignment (endDate is display-only)', () => {
    const cWithEnd = makeContract({ effectiveFrom: '2026-04-01', endDate: '2026-06-30', rateAmount: 1500 });
    // Even past endDate, the window assignment is purely by effectiveFrom ordering.
    expect(assignWorklogToContract('2026-08-01', [c1, cWithEnd])).toBe(cWithEnd);
  });
});

// ---------------------------------------------------------------------------
// rateLabel
// ---------------------------------------------------------------------------

describe('rateLabel', () => {
  it('formats hourly rate', () => {
    const c = makeContract({ effectiveFrom: '2026-01-01', rateType: 'hourly', rateAmount: 1500 });
    expect(rateLabel(c)).toContain('1');
    expect(rateLabel(c)).toContain('500');
    expect(rateLabel(c)).toContain('Kč');
    expect(rateLabel(c)).toContain('/h');
    expect(rateLabel(c)).not.toContain('/MD');
  });

  it('formats daily rate', () => {
    const c = makeContract({ effectiveFrom: '2026-01-01', rateType: 'daily', rateAmount: 8000 });
    expect(rateLabel(c)).toContain('8');
    expect(rateLabel(c)).toContain('000');
    expect(rateLabel(c)).toContain('Kč');
    expect(rateLabel(c)).toContain('/MD');
    expect(rateLabel(c)).not.toContain('/h');
  });
});

// ---------------------------------------------------------------------------
// rollupEarningsByContract
// ---------------------------------------------------------------------------

describe('rollupEarningsByContract', () => {
  const c1 = makeContract({ effectiveFrom: '2026-01-01', rateAmount: 1000 });
  const c2 = makeContract({ effectiveFrom: '2026-04-01', rateAmount: 1500 });

  it('returns empty array for no contracts', () => {
    expect(rollupEarningsByContract([], [])).toEqual([]);
  });

  it('sums CZK earnings into the correct contract window', () => {
    const worklogs: WorklogRow[] = [
      makeWorklog({ workDate: '2026-02-10', earnedAmount: 3000 }),
      makeWorklog({ workDate: '2026-03-15', earnedAmount: 2000 }),
      makeWorklog({ workDate: '2026-04-20', earnedAmount: 4500 }),
      makeWorklog({ workDate: '2026-06-01', earnedAmount: 1500 }),
    ];
    const result = rollupEarningsByContract(worklogs, [c1, c2]);
    // Sorted desc by effectiveFrom → c2 first, then c1.
    expect(result[0]?.contract).toBe(c2);
    expect(result[0]?.earnedCzk).toBe(6000); // 4500 + 1500
    expect(result[1]?.contract).toBe(c1);
    expect(result[1]?.earnedCzk).toBe(5000); // 3000 + 2000
  });

  it('sums all earnedAmount values (always CZK since #108)', () => {
    const worklogs: WorklogRow[] = [
      makeWorklog({ workDate: '2026-02-10', earnedAmount: 100 }),
      makeWorklog({ workDate: '2026-02-11', earnedAmount: 2000 }),
    ];
    const result = rollupEarningsByContract(worklogs, [c1]);
    expect(result[0]?.earnedCzk).toBe(2100);
  });

  it('ignores worklogs with null earnedAmount', () => {
    const worklogs: WorklogRow[] = [
      makeWorklog({ workDate: '2026-02-10', earnedAmount: null }),
      makeWorklog({ workDate: '2026-02-11', earnedAmount: 1500 }),
    ];
    const result = rollupEarningsByContract(worklogs, [c1]);
    expect(result[0]?.earnedCzk).toBe(1500);
  });

  it('returns zero earnedCzk when no worklogs fall in the window', () => {
    const result = rollupEarningsByContract([], [c1, c2]);
    expect(result.every((e) => e.earnedCzk === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// activeContract
// ---------------------------------------------------------------------------

describe('activeContract', () => {
  const c1 = makeContract({ effectiveFrom: '2026-01-01' });
  const c2 = makeContract({ effectiveFrom: '2026-06-01' });

  it('returns the contract active on a given date', () => {
    expect(activeContract([c1, c2], '2026-03-01')).toBe(c1);
    expect(activeContract([c1, c2], '2026-06-01')).toBe(c2);
    expect(activeContract([c1, c2], '2026-07-15')).toBe(c2);
  });

  it('returns null when no contract is active', () => {
    expect(activeContract([c2], '2026-05-31')).toBeNull();
  });
});
