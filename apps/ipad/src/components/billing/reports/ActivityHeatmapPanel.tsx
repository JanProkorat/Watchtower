import { C } from './tokens.js';
import type { HeatmapResult } from '@watchtower/shared/billing/heatmap.js';
import { formatHours, formatDateCz } from '../../../lib/czFormat.js';

interface ActivityHeatmapPanelProps {
  heatmap: HeatmapResult;
}

function cellColor(minutes: number, max: number): string {
  if (minutes === 0 || max === 0) return C.border;
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
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: 12, color: C.muted }}>
        <span><strong style={{ color: C.violet }}>{stats.currentStreak}</strong> dní v řadě</span>
        <span>nejdelší série: <strong style={{ color: C.text }}>{stats.longestStreak}</strong></span>
        <span>aktivní dny: <strong style={{ color: C.text }}>{stats.activeDays}</strong></span>
        <span>průměr/týden: <strong style={{ color: C.text }}>{formatHours(stats.weeklyAvgMinutes)}</strong></span>
      </div>
    </div>
  );
}
