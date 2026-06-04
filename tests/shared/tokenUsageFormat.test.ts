import { describe, it, expect } from 'vitest';
import {
  formatTokenCount,
  formatRemaining,
  minutesRemaining,
  formatPercent,
  usageSeverity,
  usageBar,
} from '../../shared/tokenUsageFormat.js';

describe('formatTokenCount', () => {
  it('prints small values verbatim', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(42)).toBe('42');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('compacts thousands / millions / billions with a Czech comma', () => {
    expect(formatTokenCount(1234)).toBe('1,2k');
    expect(formatTokenCount(144_702_107)).toBe('144,7M');
    expect(formatTokenCount(3854)).toBe('3,9k');
    expect(formatTokenCount(2_500_000_000)).toBe('2,5mld');
  });

  it('keeps one decimal for large values and strips a trailing ,0', () => {
    expect(formatTokenCount(369_186_587)).toBe('369,2M');
    expect(formatTokenCount(1000)).toBe('1k');
    expect(formatTokenCount(1_000_000_000)).toBe('1mld');
  });

  it('guards against bad input', () => {
    expect(formatTokenCount(Number.NaN)).toBe('—');
    expect(formatTokenCount(-5)).toBe('—');
  });
});

describe('formatRemaining / minutesRemaining', () => {
  const now = Date.parse('2026-05-29T12:06:00.000Z');

  it('formats hours and minutes', () => {
    expect(formatRemaining('2026-05-29T15:00:00.000Z', now)).toBe('2 h 54 min');
  });

  it('drops the hours component under an hour', () => {
    expect(formatRemaining('2026-05-29T12:53:00.000Z', now)).toBe('47 min');
  });

  it('clamps elapsed blocks to zero', () => {
    expect(formatRemaining('2026-05-29T11:00:00.000Z', now)).toBe('0 min');
    expect(minutesRemaining('2026-05-29T11:00:00.000Z', now)).toBe(0);
  });

  it('returns null on an unparseable date', () => {
    expect(formatRemaining('not-a-date', now)).toBeNull();
    expect(minutesRemaining('not-a-date', now)).toBeNull();
  });
});

describe('formatPercent', () => {
  it('formats with one decimal and a Czech comma', () => {
    expect(formatPercent(38.234)).toBe('38,2 %');
    expect(formatPercent(0)).toBe('0,0 %');
  });

  it('returns an em dash for null / non-finite', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('usageSeverity', () => {
  it('is ok below 70%, warn from 70–90%, crit at/above 90%', () => {
    expect(usageSeverity(0)).toBe('ok');
    expect(usageSeverity(69.9)).toBe('ok');
    expect(usageSeverity(70)).toBe('warn');
    expect(usageSeverity(89.9)).toBe('warn');
    expect(usageSeverity(90)).toBe('crit');
    expect(usageSeverity(150)).toBe('crit');
  });

  it('treats null / non-finite as ok (nothing to warn about)', () => {
    expect(usageSeverity(null)).toBe('ok');
    expect(usageSeverity(Number.NaN)).toBe('ok');
  });
});

describe('usageBar', () => {
  it('renders an empty string when there is no percentage', () => {
    expect(usageBar(null)).toBe('');
    expect(usageBar(Number.NaN)).toBe('');
  });

  it('fills green segments proportionally below the warn threshold', () => {
    expect(usageBar(56.4)).toBe('🟩🟩🟩🟩🟩🟩⬜⬜⬜⬜');
    expect(usageBar(0)).toBe('⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜');
  });

  it('uses amber fill in the warn band and red in the crit band', () => {
    expect(usageBar(75)).toBe('🟨🟨🟨🟨🟨🟨🟨🟨⬜⬜');
    expect(usageBar(95)).toBe('🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥');
  });

  it('clamps over-100% usage to a full bar', () => {
    expect(usageBar(150)).toBe('🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥');
  });

  it('honors a custom segment count', () => {
    expect(usageBar(50, 4)).toBe('🟩🟩⬜⬜');
  });
});
