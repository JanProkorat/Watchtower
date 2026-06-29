import { describe, it, expect } from 'vitest';
import { previousDay } from '@watchtower/shared/billing/date-helpers.js';

describe('previousDay', () => {
  it('subtracts one day', () => {
    expect(previousDay('2026-06-15')).toBe('2026-06-14');
  });
  it('crosses a month boundary', () => {
    expect(previousDay('2026-06-01')).toBe('2026-05-31');
  });
  it('crosses a year boundary', () => {
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});
