import { describe, it, expect } from 'vitest';
import {
  resolvePreset, defaultGranularity, clampGranularity,
} from '@watchtower/module-timetracker';

describe('resolvePreset', () => {
  const today = '2026-06-15';
  it('7d → last 7 days inclusive', () => {
    expect(resolvePreset('7d', today)).toEqual({ from: '2026-06-09', to: '2026-06-15' });
  });
  it('30d → last 30 days inclusive', () => {
    expect(resolvePreset('30d', today)).toEqual({ from: '2026-05-17', to: '2026-06-15' });
  });
  it('month → first of month to today', () => {
    expect(resolvePreset('month', today)).toEqual({ from: '2026-06-01', to: '2026-06-15' });
  });
  it('year → Jan 1 to today', () => {
    expect(resolvePreset('year', today)).toEqual({ from: '2026-01-01', to: '2026-06-15' });
  });
  it('all → earliest (or today) to today', () => {
    expect(resolvePreset('all', today, '2023-09-01')).toEqual({ from: '2023-09-01', to: '2026-06-15' });
    expect(resolvePreset('all', today)).toEqual({ from: '2026-06-15', to: '2026-06-15' });
  });
});

describe('defaultGranularity', () => {
  it('maps presets to a sensible default', () => {
    expect(defaultGranularity('7d')).toBe('day');
    expect(defaultGranularity('30d')).toBe('day');
    expect(defaultGranularity('month')).toBe('day');
    expect(defaultGranularity('year')).toBe('month');
    expect(defaultGranularity('all')).toBe('month');
  });
});

describe('clampGranularity', () => {
  it('bumps day→week beyond 92 days', () => {
    expect(clampGranularity('day', '2026-01-01', '2026-03-01')).toBe('day');   // 59 days
    expect(clampGranularity('day', '2026-01-01', '2026-06-01')).toBe('week');  // 151 days
  });
  it('bumps week→month beyond 1100 days', () => {
    expect(clampGranularity('week', '2023-01-01', '2026-06-01')).toBe('month'); // >1100 days
  });
  it('never downgrades an explicit month choice', () => {
    expect(clampGranularity('month', '2026-06-01', '2026-06-07')).toBe('month');
  });
});
