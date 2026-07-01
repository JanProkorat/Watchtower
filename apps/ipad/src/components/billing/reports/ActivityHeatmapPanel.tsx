import { C } from './tokens.js';
import { glassCard, text } from '@watchtower/ui-core';
import type { HeatmapResult } from '@watchtower/shared/billing/heatmap.js';
import { formatHours, formatDateCz } from '@watchtower/ui-core';

interface ActivityHeatmapPanelProps {
  heatmap: HeatmapResult;
}

function cellColor(minutes: number, max: number): string {
  if (minutes === 0 || max === 0) return 'rgba(255,255,255,0.10)';
  const ratio = minutes / max;
  if (ratio < 0.25) return C.violetDim + '55';
  if (ratio < 0.5) return C.violetDim;
  if (ratio < 0.75) return C.violet + 'cc';
  return C.violet;
}

export function ActivityHeatmapPanel({ heatmap }: ActivityHeatmapPanelProps): JSX.Element {
  const { days, stats } = heatmap;
  const max = Math.max(...days.map((d) => d.minutes), 1);

  return (
    <div
      style={{
        ...glassCard(12),
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {days.map((d) => (
          <div
            key={d.date}
            title={`${formatDateCz(d.date)}: ${d.minutes > 0 ? formatHours(d.minutes) : '–'}`}
            style={{ width: 13, height: 13, borderRadius: 3, background: cellColor(d.minutes, max) }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: 12, color: text.muted }}>
        <span><strong style={{ color: C.violet }}>{stats.currentStreak}</strong> dní v řadě</span>
        <span>nejdelší série: <strong style={{ color: text.primary }}>{stats.longestStreak}</strong></span>
        <span>aktivní dny: <strong style={{ color: text.primary }}>{stats.activeDays}</strong></span>
        <span>průměr/týden: <strong style={{ color: text.primary }}>{formatHours(stats.weeklyAvgMinutes)}</strong></span>
      </div>
    </div>
  );
}
