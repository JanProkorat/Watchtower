import { useState, useCallback } from 'react';
import type { Granularity } from '@watchtower/shared/billing/reports/buckets.js';

export type Preset = '7d' | '30d' | 'month' | 'year' | 'all';

function addDays(date: string, n: number): string {
  const parts = date.split('-').map(Number);
  const [y, m, d] = [parts[0]!, parts[1]! - 1, parts[2]! + n];
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

function spanDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000) + 1; // inclusive
}

export function resolvePreset(preset: Preset, today: string, earliest?: string): { from: string; to: string } {
  switch (preset) {
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'month': return { from: today.slice(0, 7) + '-01', to: today };
    case 'year': return { from: today.slice(0, 4) + '-01-01', to: today };
    case 'all': return { from: earliest ?? today, to: today };
  }
}

export function defaultGranularity(preset: Preset): Granularity {
  if (preset === 'year' || preset === 'all') return 'month';
  return 'day';
}

export function clampGranularity(g: Granularity, from: string, to: string): Granularity {
  const span = spanDays(from, to);
  if (g === 'day' && span > 92) return 'week';
  if (g === 'week' && span > 1100) return 'month';
  return g;
}

export interface ReportsFilters {
  preset: Preset;
  granularity: Granularity;
  projectId: number | undefined;
  from: string;
  to: string;
  setPreset(p: Preset): void;
  setGranularity(g: Granularity): void;
  setProjectId(id: number | undefined): void;
}

export function useReportsFilters(today: string, earliest?: string): ReportsFilters {
  const [preset, setPresetState] = useState<Preset>('30d');
  const [granularityChoice, setGranularityChoice] = useState<Granularity | null>(null);
  const [projectId, setProjectId] = useState<number | undefined>(undefined);

  const { from, to } = resolvePreset(preset, today, earliest);
  const base = granularityChoice ?? defaultGranularity(preset);
  const granularity = clampGranularity(base, from, to);

  const setPreset = useCallback((p: Preset) => {
    setPresetState(p);
    setGranularityChoice(null); // revert to auto-default for the new preset
  }, []);

  const setGranularity = useCallback((g: Granularity) => setGranularityChoice(g), []);

  return { preset, granularity, projectId, from, to, setPreset, setGranularity, setProjectId };
}
