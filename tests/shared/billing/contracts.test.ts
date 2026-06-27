import { describe, it, expect } from 'vitest';
import { contractBurn } from '../../../packages/shared/src/billing/contracts.js';
import type { WorklogRow, ContractRow } from '../../../packages/shared/src/billing/types.js';

const contract = (o: Partial<ContractRow> = {}): ContractRow => ({
  projectId: 1, effectiveFrom: '2026-06-01', endDate: '2026-06-30', rateType: 'hourly',
  rateAmount: 1500, currency: 'CZK', hoursPerDay: 8, mdLimit: 20, ...o,
});
const wl = (workDate: string, effectiveMinutes: number): WorklogRow => ({
  syncId: workDate, workDate, minutes: effectiveMinutes, effectiveMinutes, earnedAmount: 0, rateCurrency: 'CZK',
  projectId: 1, projectName: 'A', projectColor: null, projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null,
});

describe('contractBurn', () => {
  it('computes mdsUsed and projection for an active fixed-window contract', () => {
    // June 2026: workdays Mon-Fri minus holidays. 8h/day.
    // Log 5 full days (480 min each) across the first week.
    const rows = [wl('2026-06-01', 480), wl('2026-06-02', 480), wl('2026-06-03', 480), wl('2026-06-04', 480), wl('2026-06-05', 480)];
    const [b] = contractBurn([contract()], rows, [], { today: '2026-06-05' });
    expect(b.mdsUsed).toBe(5);        // 5 * 480 / 60 / 8
    expect(b.mdLimit).toBe(20);
    expect(b.mdsRemaining).toBe(15);
    // elapsed workdays 06-01..06-05 = 5; projected = (5/5) * totalWorkdays
    expect(b.totalWorkdays).toBeGreaterThan(0);
    expect(b.projectedMds).toBe(b.totalWorkdays);
  });

  it('skips contracts whose window does not contain today', () => {
    expect(contractBurn([contract({ endDate: '2026-05-31' })], [], [], { today: '2026-06-15' })).toEqual([]);
  });
});
