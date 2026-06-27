import { describe, it, expect } from 'vitest';
import { czechMonthLabel, addMonths } from '../../apps/ipad/src/lib/monthHelpers.js';

describe('czechMonthLabel', () => {
  it('returns Czech month name + year', () => {
    expect(czechMonthLabel('2026-06')).toBe('Červen 2026');
    expect(czechMonthLabel('2026-01')).toBe('Leden 2026');
    expect(czechMonthLabel('2025-12')).toBe('Prosinec 2025');
    expect(czechMonthLabel('2026-07')).toBe('Červenec 2026');
  });
});

describe('addMonths', () => {
  it('advances to next month', () => {
    expect(addMonths('2026-06', 1)).toBe('2026-07');
  });

  it('goes back to previous month', () => {
    expect(addMonths('2026-06', -1)).toBe('2026-05');
  });

  it('wraps across year boundaries correctly', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
  });

  it('handles multi-month jumps', () => {
    expect(addMonths('2026-06', -5)).toBe('2026-01');
    expect(addMonths('2026-06', 6)).toBe('2026-12');
    expect(addMonths('2026-06', 7)).toBe('2027-01');
  });

  it('zero delta returns same month', () => {
    expect(addMonths('2026-06', 0)).toBe('2026-06');
  });
});
