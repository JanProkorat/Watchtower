import { describe, it, expect } from 'vitest';
import { bucketKey, enumerateBuckets } from '../../../../packages/shared/src/billing/reports/buckets.js';

describe('bucketKey', () => {
  it('day granularity returns the date unchanged', () => {
    expect(bucketKey('2026-06-07', 'day')).toBe('2026-06-07');
  });

  it('month granularity returns YYYY-MM', () => {
    expect(bucketKey('2026-06-07', 'month')).toBe('2026-06');
  });

  it('week: days before the first Monday are week 00 (mirrors strftime %W)', () => {
    // 2026-01-01 is a Thursday -> before the first Monday (2026-01-05).
    expect(bucketKey('2026-01-01', 'week')).toBe('2026-W00');
    expect(bucketKey('2026-01-04', 'week')).toBe('2026-W00'); // Sunday, still week 00
  });

  it('week: the first Monday starts week 01', () => {
    expect(bucketKey('2026-01-05', 'week')).toBe('2026-W01'); // Monday
    expect(bucketKey('2026-01-11', 'week')).toBe('2026-W01'); // following Sunday
    expect(bucketKey('2026-01-12', 'week')).toBe('2026-W02');
  });

  it('week: uses the date own calendar year at a year boundary', () => {
    // 2025-12-31 is a Wednesday; 2026-01-01 is a Thursday -> different keys/years.
    expect(bucketKey('2025-12-31', 'week')).toBe('2025-W52');
    expect(bucketKey('2026-01-01', 'week')).toBe('2026-W00');
  });
});

describe('enumerateBuckets', () => {
  it('lists distinct day buckets in order, inclusive', () => {
    expect(enumerateBuckets('2026-06-06', '2026-06-08', 'day')).toEqual([
      '2026-06-06', '2026-06-07', '2026-06-08',
    ]);
  });

  it('collapses a range into its week buckets in order', () => {
    expect(enumerateBuckets('2026-01-04', '2026-01-12', 'week')).toEqual([
      '2026-W00', '2026-W01', '2026-W02',
    ]);
  });

  it('collapses a range into month buckets in order', () => {
    expect(enumerateBuckets('2026-05-20', '2026-07-02', 'month')).toEqual([
      '2026-05', '2026-06', '2026-07',
    ]);
  });
});
