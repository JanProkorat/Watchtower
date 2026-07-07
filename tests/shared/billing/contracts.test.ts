import { describe, it, expect } from 'vitest';
import { contractBurn } from '../../../packages/shared/src/billing/contracts.js';
import type { WorklogRow, ContractRow, ProjectRow } from '../../../packages/shared/src/billing/types.js';

const contract = (o: Partial<ContractRow> = {}): ContractRow => ({
  syncId: 'c-test', projectId: 1, effectiveFrom: '2026-06-01', endDate: '2026-06-30', rateType: 'hourly',
  rateAmount: 1500, hoursPerDay: 8, mdLimit: 20, contractGroupId: null, ...o,
});
const wl = (workDate: string, effectiveMinutes: number, projectId = 1): WorklogRow => ({
  syncId: workDate, workDate, minutes: effectiveMinutes, effectiveMinutes, earnedAmount: 0,
  projectId, projectName: 'A', projectColor: null, projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null,
});
const proj = (o: Partial<ProjectRow> = {}): ProjectRow => ({
  id: 1, name: 'PPS Technology', color: null, ...o,
});

describe('contractBurn', () => {
  it('computes mdsUsed and projection for an active fixed-window contract', () => {
    // June 2026: workdays Mon-Fri minus holidays. 8h/day.
    // Log 5 full days (480 min each) across the first week.
    const rows = [wl('2026-06-01', 480), wl('2026-06-02', 480), wl('2026-06-03', 480), wl('2026-06-04', 480), wl('2026-06-05', 480)];
    const [b] = contractBurn([contract()], rows, [], [proj()], { today: '2026-06-05' });
    expect(b.mdsUsed).toBe(5);        // 5 * 480 / 60 / 8
    expect(b.mdLimit).toBe(20);
    expect(b.mdsRemaining).toBe(15);
    // elapsed workdays 06-01..06-05 = 5; projected = (5/5) * totalWorkdays
    expect(b.totalWorkdays).toBeGreaterThan(0);
    expect(b.projectedMds).toBe(b.totalWorkdays);
    // name/color come from projects list
    expect(b.projectName).toBe('PPS Technology');
    expect(b.projectColor).toBeNull();
  });

  it('skips contracts whose window does not contain today', () => {
    expect(contractBurn([contract({ endDate: '2026-05-31' })], [], [], [proj()], { today: '2026-06-15' })).toEqual([]);
  });

  it('resolves projectName from projects list even when there are zero in-window worklogs', () => {
    // Contract is active but no worklogs logged — name must still come from projects, not worklog rows.
    const [b] = contractBurn(
      [contract()],
      [], // no worklogs at all
      [],
      [proj({ id: 1, name: 'PPS Technology', color: '#7c3aed' })],
      { today: '2026-06-15' },
    );
    expect(b.projectName).toBe('PPS Technology');
    expect(b.projectColor).toBe('#7c3aed');
    expect(b.mdsUsed).toBe(0);
    expect(b.mdsRemaining).toBe(20);
  });

  it('open-ended contract: totalWorkdays/workdaysRemaining/projectedMds are null, burn still computes', () => {
    const rows = [wl('2026-06-01', 480), wl('2026-06-02', 480)];
    const [b] = contractBurn(
      [contract({ endDate: null, mdLimit: 20 })],
      rows,
      [],
      [proj()],
      { today: '2026-06-05' },
    );
    expect(b.totalWorkdays).toBeNull();
    expect(b.workdaysRemaining).toBeNull();
    expect(b.projectedMds).toBeNull();
    expect(b.mdsUsed).toBe(2);        // 2 * 480 / 60 / 8
    expect(b.mdsRemaining).toBe(18);
  });

  it('excludes non-work project worklogs from mdsUsed', () => {
    // A personal-kind worklog in the same window must NOT count toward mdsUsed.
    const workRow = wl('2026-06-02', 480);                                        // kind='work'
    const personalRow: WorklogRow = { ...wl('2026-06-03', 480), projectKind: 'personal' };
    const [b] = contractBurn([contract()], [workRow, personalRow], [], [proj()], { today: '2026-06-05' });
    expect(b.mdsUsed).toBe(1);    // only the work row: 480 / 60 / 8 = 1
    expect(b.mdsRemaining).toBe(19);
  });

  it('today == endDate (last day): workdaysRemaining is 0', () => {
    const rows = [wl('2026-06-30', 480)];
    const [b] = contractBurn(
      [contract({ endDate: '2026-06-30' })],
      rows,
      [],
      [proj()],
      { today: '2026-06-30' },
    );
    expect(b.workdaysRemaining).toBe(0);
    expect(b.mdsUsed).toBe(1);
  });

  it('shared-contract group: mdsUsed pools worklogs across every member project', () => {
    // Two contracts share group 'grp-1' — one on project 1, one on project 2.
    // Each project logs 480 min on a separate day; mdsUsed on BOTH rows must
    // reflect the pooled total (2 MDs), not just its own project's minutes.
    const groupContracts = [
      contract({ projectId: 1, contractGroupId: 'grp-1' }),
      contract({ syncId: 'c-test-2', projectId: 2, contractGroupId: 'grp-1' }),
    ];
    const rows = [wl('2026-06-01', 480, 1), wl('2026-06-02', 480, 2)];
    const projects = [proj({ id: 1 }), proj({ id: 2, name: 'Project 2' })];
    const result = contractBurn(groupContracts, rows, [], projects, { today: '2026-06-05' });
    expect(result).toHaveLength(2);
    for (const b of result) {
      expect(b.mdsUsed).toBe(2); // pooled: 480 + 480 = 960 min / 60 / 8 = 2
      // Consumers (e.g. the iPad dashboard) need the group id to dedupe
      // these pooled entries down to a single card.
      expect(b.contractGroupId).toBe('grp-1');
    }
  });

  it('solo contract (no contractGroupId): still counts only its own project', () => {
    // A worklog on a different project must NOT bleed into a solo contract's burn.
    const rows = [wl('2026-06-01', 480, 1), wl('2026-06-02', 480, 2)];
    const [b] = contractBurn([contract({ projectId: 1, contractGroupId: null })], rows, [], [proj()], {
      today: '2026-06-05',
    });
    expect(b.mdsUsed).toBe(1); // only project 1's 480 min counts
    expect(b.contractGroupId).toBeNull();
  });
});
