import { useState } from 'react';
import { C } from './tokens.js';
import { glassCard, text } from '@watchtower/ui-core';
import type { TrendBucket, RateMarker } from '@watchtower/shared/billing/reports/trend.js';
import { bucketKey, enumerateBuckets, type Granularity } from '@watchtower/shared/billing/reports/buckets.js';
import { formatCzk, formatHours } from '@watchtower/ui-core';

interface TrendChartProps {
  series: TrendBucket[];
  markers: RateMarker[];
  from: string;
  to: string;
  granularity: Granularity;
}

function bucketLabel(bucket: string, g: Granularity): string {
  if (g === 'month') return bucket.replace('-', '/');      // 2026-06 → 2026/06
  if (g === 'week') return bucket.split('-W')[1] ?? bucket; // 2026-W23 → 23
  return bucket.slice(8);                                   // 2026-06-07 → 07
}

export function TrendChart({ series, markers, from, to, granularity }: TrendChartProps): JSX.Element {
  const [active, setActive] = useState<string | null>(null);

  const order = enumerateBuckets(from, to, granularity);
  const byBucket = new Map(series.map((s) => [s.bucket, s]));
  const filled = order.map((b) => byBucket.get(b) ?? { bucket: b, minutes: 0, earnedCzk: 0 });
  const maxMinutes = Math.max(...filled.map((b) => b.minutes), 1);
  const markerBuckets = new Set(markers.map((m) => bucketKey(m.effectiveFrom, granularity)));

  if (filled.length === 0) {
    return <div style={{ fontSize: 13, color: text.muted, padding: '8px 0' }}>žádná data</div>;
  }

  const shown = active != null ? byBucket.get(active) ?? { bucket: active, minutes: 0, earnedCzk: 0 } : null;

  return (
    <div style={{ ...glassCard(16), padding: '16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ height: 18, fontSize: 12, color: text.muted }}>
        {shown
          ? `${bucketLabel(shown.bucket, granularity)}: ${formatHours(shown.minutes)} · ${formatCzk(shown.earnedCzk)}`
          : 'klepnutím zobrazíte detail'}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 2,
          height: 140,
          overflowX: 'auto',
          paddingBottom: 2,
        }}
      >
        {filled.map((b) => {
          const isMarker = markerBuckets.has(b.bucket);
          return (
            <div
              key={b.bucket}
              onClick={() => setActive(b.bucket)}
              style={{
                flex: '1 0 10px',
                minWidth: 6,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                height: '100%',
                position: 'relative',
                cursor: 'pointer',
                // dashed rate-change marker overlay
                borderLeft: isMarker ? `1px dashed ${C.cyan}` : 'none',
              }}
            >
              <div
                style={{
                  height: `${(b.minutes / maxMinutes) * 100}%`,
                  background: active === b.bucket ? C.violet : C.violetDim,
                  borderRadius: '3px 3px 0 0',
                  minHeight: b.minutes > 0 ? 2 : 0,
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: text.muted }}>
        <span>{bucketLabel(filled[0]?.bucket ?? '', granularity)}</span>
        <span>{bucketLabel(filled[filled.length - 1]?.bucket ?? '', granularity)}</span>
      </div>
    </div>
  );
}
