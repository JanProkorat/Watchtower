import { describe, it, expect } from 'vitest';
import { activeMinutesByDate, localDateStr, IDLE_CAP_MS } from '../../orchestrator/services/autoTimeLogger.js';

const MIN = 60 * 1000;

describe('activeMinutesByDate', () => {
  it('returns empty for zero or one ping (no measurable duration)', () => {
    expect(activeMinutesByDate([], IDLE_CAP_MS).size).toBe(0);
    expect(activeMinutesByDate([Date.parse('2026-07-03T10:00:00')], IDLE_CAP_MS).size).toBe(0);
  });

  it('sums sub-cap gaps within a day', () => {
    const t = Date.parse('2026-07-03T10:00:00');
    const pings = [t, t + 3 * MIN, t + 8 * MIN]; // 3 + 5 = 8 min
    const m = activeMinutesByDate(pings, IDLE_CAP_MS);
    expect(m.get('2026-07-03')).toBe(8);
  });

  it('caps a long idle gap at the idle cap', () => {
    const t = Date.parse('2026-07-03T10:00:00');
    const pings = [t, t + 60 * MIN]; // 60-min gap → capped at 10
    expect(activeMinutesByDate(pings, IDLE_CAP_MS).get('2026-07-03')).toBe(10);
  });

  it('splits across midnight, crediting each gap to the earlier ping day', () => {
    const late = Date.parse('2026-07-03T23:58:00');
    const early = Date.parse('2026-07-04T00:03:00'); // 5-min gap, spans midnight
    const next = early + 4 * MIN; // +4 min on the 4th
    const m = activeMinutesByDate([late, early, next], IDLE_CAP_MS);
    expect(m.get('2026-07-03')).toBe(5); // credited to the 3rd (earlier ping)
    expect(m.get('2026-07-04')).toBe(4);
  });

  it('is order-independent', () => {
    const t = Date.parse('2026-07-03T10:00:00');
    const m = activeMinutesByDate([t + 8 * MIN, t, t + 3 * MIN], IDLE_CAP_MS);
    expect(m.get('2026-07-03')).toBe(8);
  });

  it('localDateStr formats local YYYY-MM-DD', () => {
    expect(localDateStr(Date.parse('2026-07-03T10:00:00'))).toBe('2026-07-03');
  });
});
