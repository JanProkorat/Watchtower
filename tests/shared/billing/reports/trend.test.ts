import { describe, it, expect } from 'vitest';
import { trendSeries, rateChangeMarkers } from '../../../../packages/shared/src/billing/reports/trend.js';
import type { WorklogRow, ContractRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, projectId: 1, projectName: 'P1',
    projectColor: '#fff', projectKind: 'work', isBillable: true,
    taskNumber: null, taskTitle: null, ...over,
  };
}
function ct(over: Partial<ContractRow>): ContractRow {
  return {
    projectId: 1, effectiveFrom: '2026-01-01', endDate: null, rateType: 'hourly',
    rateAmount: 1000, hoursPerDay: 8, mdLimit: null, ...over,
  };
}

describe('trendSeries', () => {
  it('buckets by day, summing effective minutes and CZK earnings', () => {
    const rows = [
      wl({ workDate: '2026-06-01', effectiveMinutes: 60, earnedAmount: 1000 }),
      wl({ workDate: '2026-06-01', effectiveMinutes: 30, earnedAmount: 500 }),
      wl({ workDate: '2026-06-02', effectiveMinutes: 90, earnedAmount: 1500 }),
    ];
    expect(trendSeries(rows, { from: '2026-06-01', to: '2026-06-02', granularity: 'day' })).toEqual([
      { bucket: '2026-06-01', minutes: 90, earnedCzk: 1500 },
      { bucket: '2026-06-02', minutes: 90, earnedCzk: 1500 },
    ]);
  });

  it('excludes rows outside the range and non-matching projects', () => {
    const rows = [
      wl({ workDate: '2026-05-31', effectiveMinutes: 60 }),
      wl({ workDate: '2026-06-01', projectId: 2, effectiveMinutes: 60 }),
      wl({ workDate: '2026-06-01', projectId: 1, effectiveMinutes: 45 }),
    ];
    expect(trendSeries(rows, { from: '2026-06-01', to: '2026-06-30', granularity: 'month', projectId: 1 })).toEqual([
      { bucket: '2026-06', minutes: 45, earnedCzk: 1000 },
    ]);
  });

  it('counts minutes but not earnings for rows with no earned amount', () => {
    const rows = [wl({ earnedAmount: null, effectiveMinutes: 60 })];
    expect(trendSeries(rows, { from: '2026-06-01', to: '2026-06-30', granularity: 'month' })).toEqual([
      { bucket: '2026-06', minutes: 60, earnedCzk: 0 },
    ]);
  });
});

describe('rateChangeMarkers', () => {
  it('returns [] when no project is selected', () => {
    const contracts = [ct({ effectiveFrom: '2026-01-01' }), ct({ effectiveFrom: '2026-03-01' })];
    expect(rateChangeMarkers(contracts, { from: '2026-01-01', to: '2026-12-31' })).toEqual([]);
  });

  it('emits only changes (rank > 1) within range for the selected project', () => {
    const contracts = [
      ct({ projectId: 1, effectiveFrom: '2026-01-01', rateAmount: 1000 }),
      ct({ projectId: 1, effectiveFrom: '2026-03-01', rateAmount: 1200 }),
      ct({ projectId: 1, effectiveFrom: '2026-09-01', rateAmount: 1500 }),
      ct({ projectId: 2, effectiveFrom: '2026-02-01', rateAmount: 999 }),
    ];
    expect(rateChangeMarkers(contracts, { from: '2026-01-01', to: '2026-06-30', projectId: 1 })).toEqual([
      { effectiveFrom: '2026-03-01', rateType: 'hourly', rateAmount: 1200 },
    ]);
  });
});
