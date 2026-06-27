import { describe, it, expect } from 'vitest';
import { relativeTimeCz } from '../../apps/ipad/src/components/billing/DashboardView.js';

const NOW = new Date('2026-06-27T10:00:00Z').getTime();
const iso = (ms: number) => new Date(ms).toISOString();

describe('relativeTimeCz', () => {
  it('returns "právě teď" for < 60 s', () => {
    expect(relativeTimeCz(iso(NOW - 30_000), NOW)).toBe('právě teď');
    expect(relativeTimeCz(iso(NOW - 0), NOW)).toBe('právě teď');
  });

  it('returns "před X min" for 1–59 minutes', () => {
    expect(relativeTimeCz(iso(NOW - 60_000), NOW)).toBe('před 1 min');
    expect(relativeTimeCz(iso(NOW - 2 * 60_000), NOW)).toBe('před 2 min');
    expect(relativeTimeCz(iso(NOW - 59 * 60_000), NOW)).toBe('před 59 min');
  });

  it('returns "před hodinou" for exactly 1 hour', () => {
    expect(relativeTimeCz(iso(NOW - 60 * 60_000), NOW)).toBe('před hodinou');
  });

  it('returns "před X hodinami" for 2–23 hours', () => {
    expect(relativeTimeCz(iso(NOW - 2 * 60 * 60_000), NOW)).toBe('před 2 hodinami');
    expect(relativeTimeCz(iso(NOW - 5 * 60 * 60_000), NOW)).toBe('před 5 hodinami');
    expect(relativeTimeCz(iso(NOW - 23 * 60 * 60_000), NOW)).toBe('před 23 hodinami');
  });

  it('returns "před dnem" for exactly 1 day', () => {
    expect(relativeTimeCz(iso(NOW - 24 * 60 * 60_000), NOW)).toBe('před dnem');
  });

  it('returns "před X dny" for 2–4 days', () => {
    expect(relativeTimeCz(iso(NOW - 2 * 24 * 60 * 60_000), NOW)).toBe('před 2 dny');
    expect(relativeTimeCz(iso(NOW - 3 * 24 * 60 * 60_000), NOW)).toBe('před 3 dny');
    expect(relativeTimeCz(iso(NOW - 4 * 24 * 60 * 60_000), NOW)).toBe('před 4 dny');
  });

  it('returns "před X dní" for 5+ days', () => {
    expect(relativeTimeCz(iso(NOW - 5 * 24 * 60 * 60_000), NOW)).toBe('před 5 dní');
    expect(relativeTimeCz(iso(NOW - 7 * 24 * 60 * 60_000), NOW)).toBe('před 7 dní');
  });

  it('returns "právě teď" for future timestamps (negative diff)', () => {
    expect(relativeTimeCz(iso(NOW + 60_000), NOW)).toBe('právě teď');
    expect(relativeTimeCz(iso(NOW + 1), NOW)).toBe('právě teď');
  });
});
