import type { WorklogRow, ContractRow } from '../types.js';
import { bucketKey, type Granularity } from './buckets.js';

// Post-#108 the app is CZK-only (rate_currency dropped); every earned amount is CZK.
const isCzkEarned = (r: WorklogRow) => r.earnedAmount != null;
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface TrendBucket {
  bucket: string;
  minutes: number;
  earnedCzk: number;
}

export function trendSeries(
  rows: WorklogRow[],
  opts: { from: string; to: string; granularity: Granularity; projectId?: number },
): TrendBucket[] {
  const { from, to, granularity, projectId } = opts;
  const map = new Map<string, TrendBucket>();
  for (const r of rows) {
    if (r.workDate < from || r.workDate > to) continue;
    if (projectId !== undefined && r.projectId !== projectId) continue;
    const key = bucketKey(r.workDate, granularity);
    const cur = map.get(key) ?? { bucket: key, minutes: 0, earnedCzk: 0 };
    cur.minutes += r.effectiveMinutes;
    if (isCzkEarned(r)) cur.earnedCzk += r.earnedAmount!;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => cmpStr(a.bucket, b.bucket));
}

export interface RateMarker {
  effectiveFrom: string;
  rateType: 'hourly' | 'daily';
  rateAmount: number;
}

export function rateChangeMarkers(
  contracts: ContractRow[],
  opts: { from: string; to: string; projectId?: number },
): RateMarker[] {
  const { from, to, projectId } = opts;
  if (projectId === undefined) return [];
  const ordered = contracts
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => cmpStr(a.effectiveFrom, b.effectiveFrom));
  return ordered
    .slice(1) // rank > 1 — skip the earliest contract (not a "change")
    .filter((c) => c.effectiveFrom >= from && c.effectiveFrom <= to)
    .map((c) => ({
      effectiveFrom: c.effectiveFrom,
      rateType: c.rateType,
      rateAmount: c.rateAmount,
    }));
}
