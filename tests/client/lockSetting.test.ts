import { describe, it, expect } from 'vitest';
import { isLocked } from '../../apps/desktop/src/util/lockSetting.js';

describe('isLocked', () => {
  it('returns false when no lock is set', () => {
    expect(isLocked('2026-04-15', null)).toBe(false);
    expect(isLocked('2099-12-31', null)).toBe(false);
  });

  it('returns false when workDate is missing', () => {
    expect(isLocked(null, '2026-04-30')).toBe(false);
    expect(isLocked(undefined, '2026-04-30')).toBe(false);
    expect(isLocked('', '2026-04-30')).toBe(false);
  });

  it('returns true for dates on or before the lock (inclusive)', () => {
    expect(isLocked('2026-04-30', '2026-04-30')).toBe(true);
    expect(isLocked('2026-04-29', '2026-04-30')).toBe(true);
    expect(isLocked('2024-01-01', '2026-04-30')).toBe(true);
  });

  it('returns false for dates after the lock', () => {
    expect(isLocked('2026-05-01', '2026-04-30')).toBe(false);
    expect(isLocked('2099-12-31', '2026-04-30')).toBe(false);
  });
});
