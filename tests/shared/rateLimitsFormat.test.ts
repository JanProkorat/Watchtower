import { describe, it, expect } from 'vitest';
import {
  extractRateLimits,
  nextRateLimitResetMs,
  rollForwardRateLimits,
} from '../../packages/shared/src/rateLimitsFormat.js';

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

// A snapshot is only refreshed when some Claude session renders a statusline.
// Nothing renders while the user is idle, so a snapshot taken just before a
// window rolls over would otherwise keep reporting the pre-reset percentage
// forever (it is also persisted across app restarts).
describe('rollForwardRateLimits', () => {
  const snap = (sessionResetsAt: number, weekResetsAt: number) => ({
    session: { usedPercent: 89, resetsAt: sessionResetsAt },
    week: { usedPercent: 71, resetsAt: weekResetsAt },
    capturedAt: AT,
  });

  it('passes null through', () => {
    expect(rollForwardRateLimits(null, AT)).toBeNull();
  });

  it('returns the same object when no window has reset yet', () => {
    const s = snap(1_700_010_000, 1_700_600_000);
    expect(rollForwardRateLimits(s, AT)).toBe(s);
  });

  it('zeroes a window whose resetsAt has passed', () => {
    // resets_at is epoch SECONDS; AT is epoch ms.
    const s = snap(AT / 1000 - 60, 1_700_600_000);
    expect(rollForwardRateLimits(s, AT)).toEqual({
      session: { usedPercent: 0, resetsAt: 0 },
      week: { usedPercent: 71, resetsAt: 1_700_600_000 },
      capturedAt: AT,
    });
  });

  it('zeroes exactly at the reset instant', () => {
    const s = snap(AT / 1000, 1_700_600_000);
    expect(rollForwardRateLimits(s, AT)?.session).toEqual({ usedPercent: 0, resetsAt: 0 });
  });

  it('zeroes both windows independently', () => {
    const s = snap(AT / 1000 - 1, AT / 1000 - 1);
    expect(rollForwardRateLimits(s, AT)).toEqual({
      session: { usedPercent: 0, resetsAt: 0 },
      week: { usedPercent: 0, resetsAt: 0 },
      capturedAt: AT,
    });
  });

  it('leaves an unknown resetsAt (0) alone — it carries no rollover instant', () => {
    const s = { session: { usedPercent: 89, resetsAt: 0 }, week: null, capturedAt: AT };
    expect(rollForwardRateLimits(s, AT)).toBe(s);
  });

  it('is idempotent — a rolled-forward snapshot rolls forward to itself', () => {
    const once = rollForwardRateLimits(snap(AT / 1000 - 60, AT / 1000 - 60), AT);
    expect(rollForwardRateLimits(once, AT)).toBe(once);
  });
});

describe('nextRateLimitResetMs', () => {
  it('returns null when there is nothing pending', () => {
    expect(nextRateLimitResetMs(null, AT)).toBeNull();
    expect(nextRateLimitResetMs({ session: { usedPercent: 1, resetsAt: 0 }, week: null, capturedAt: AT }, AT)).toBeNull();
  });

  it('returns the earliest future reset, in ms', () => {
    const s = {
      session: { usedPercent: 89, resetsAt: 1_700_010_000 },
      week: { usedPercent: 71, resetsAt: 1_700_600_000 },
      capturedAt: AT,
    };
    expect(nextRateLimitResetMs(s, AT)).toBe(1_700_010_000_000);
  });

  it('ignores resets already in the past', () => {
    const s = {
      session: { usedPercent: 89, resetsAt: AT / 1000 - 60 },
      week: { usedPercent: 71, resetsAt: 1_700_600_000 },
      capturedAt: AT,
    };
    expect(nextRateLimitResetMs(s, AT)).toBe(1_700_600_000_000);
  });
});
