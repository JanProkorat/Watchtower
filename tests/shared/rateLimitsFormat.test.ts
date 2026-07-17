import { describe, it, expect } from 'vitest';
import { extractRateLimits } from '../../packages/shared/src/rateLimitsFormat.js';

const AT = 1_700_000_000_000;

describe('extractRateLimits', () => {
  it('extracts both windows from a full statusline body', () => {
    const snap = extractRateLimits(
      { rate_limits: { five_hour: { used_percentage: 42, resets_at: 1700010000 }, seven_day: { used_percentage: 71, resets_at: 1700600000 } } },
      AT,
    );
    expect(snap).toEqual({
      session: { usedPercent: 42, resetsAt: 1700010000 },
      week: { usedPercent: 71, resetsAt: 1700600000 },
      capturedAt: AT,
    });
  });

  it('returns null when rate_limits is absent', () => {
    expect(extractRateLimits({ session_id: 'x' }, AT)).toBeNull();
    expect(extractRateLimits(null, AT)).toBeNull();
    expect(extractRateLimits('nonsense', AT)).toBeNull();
  });

  it('keeps one window when only that window is present', () => {
    const snap = extractRateLimits({ rate_limits: { five_hour: { used_percentage: 10, resets_at: 5 } } }, AT);
    expect(snap).toEqual({ session: { usedPercent: 10, resetsAt: 5 }, week: null, capturedAt: AT });
  });

  it('tolerates a missing resets_at (defaults to 0)', () => {
    const snap = extractRateLimits({ rate_limits: { five_hour: { used_percentage: 10 } } }, AT);
    expect(snap?.session).toEqual({ usedPercent: 10, resetsAt: 0 });
  });

  it('drops a window with a non-numeric used_percentage', () => {
    expect(extractRateLimits({ rate_limits: { five_hour: { used_percentage: 'x' } } }, AT)).toBeNull();
  });
});
