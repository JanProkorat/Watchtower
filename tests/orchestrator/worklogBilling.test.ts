import { describe, it, expect } from 'vitest';
import { computeWorklogBilling, type ContractLite } from '../../orchestrator/db/worklogBilling.js';

const hourly = (effectiveFrom: string, rateAmount: number, currency = 'EUR'): ContractLite =>
  ({ effectiveFrom, rateType: 'hourly', rateAmount, currency, hoursPerDay: 8 });
const daily = (effectiveFrom: string, rateAmount: number, hoursPerDay = 8, currency = 'CZK'): ContractLite =>
  ({ effectiveFrom, rateType: 'daily', rateAmount, currency, hoursPerDay });

describe('computeWorklogBilling', () => {
  it('reported_minutes overrides minutes for effective_minutes', () => {
    const r = computeWorklogBilling({ minutes: 120, reportedMinutes: 90, workDate: '2026-06-01', contracts: [hourly('2026-01-01', 100)] });
    expect(r.effectiveMinutes).toBe(90);
  });

  it('hourly earned = effective/60 * rate', () => {
    const r = computeWorklogBilling({ minutes: 90, reportedMinutes: null, workDate: '2026-06-01', contracts: [hourly('2026-01-01', 100)] });
    expect(r.effectiveMinutes).toBe(90);
    expect(r.resolvedRate).toBe(100);
    expect(r.rateCurrency).toBe('EUR');
    expect(r.earnedAmount).toBeCloseTo(150); // 90/60 * 100
  });

  it('daily earned = effective/60/hoursPerDay * rate', () => {
    const r = computeWorklogBilling({ minutes: 240, reportedMinutes: null, workDate: '2026-06-01', contracts: [daily('2026-01-01', 4000, 8)] });
    expect(r.earnedAmount).toBeCloseTo(2000); // 240/60/8 * 4000 = 0.5 MD * 4000
    expect(r.rateCurrency).toBe('CZK');
  });

  it('picks the contract whose window contains work_date (LEAD upper bound)', () => {
    const contracts = [hourly('2026-01-01', 100), hourly('2026-06-01', 200)];
    expect(computeWorklogBilling({ minutes: 60, reportedMinutes: null, workDate: '2026-05-31', contracts }).resolvedRate).toBe(100);
    expect(computeWorklogBilling({ minutes: 60, reportedMinutes: null, workDate: '2026-06-01', contracts }).resolvedRate).toBe(200); // boundary = inclusive lower
  });

  it('returns null rate/earned when no contract covers the date', () => {
    const r = computeWorklogBilling({ minutes: 60, reportedMinutes: null, workDate: '2025-12-31', contracts: [hourly('2026-01-01', 100)] });
    expect(r.effectiveMinutes).toBe(60);
    expect(r.resolvedRate).toBeNull();
    expect(r.rateCurrency).toBeNull();
    expect(r.earnedAmount).toBeNull();
  });

  it('no contracts at all → null earned', () => {
    const r = computeWorklogBilling({ minutes: 60, reportedMinutes: null, workDate: '2026-06-01', contracts: [] });
    expect(r.earnedAmount).toBeNull();
  });
});
