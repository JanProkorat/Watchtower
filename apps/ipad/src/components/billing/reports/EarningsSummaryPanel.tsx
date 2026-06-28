import { C } from './tokens.js';
import type { EarningsSummaryResult } from '@watchtower/shared/billing/reports/earnings-summary.js';
import { formatCzk, formatHours } from '../../../lib/czFormat.js';

interface EarningsSummaryPanelProps {
  summary: EarningsSummaryResult;
  onOpenProject(id: number): void;
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ? C.violet : C.text, lineHeight: 1.2 }}>
        {value}
      </div>
    </div>
  );
}

export function EarningsSummaryPanel({ summary, onOpenProject }: EarningsSummaryPanelProps): JSX.Element {
  const maxEarned = Math.max(...summary.perProject.map((p) => p.earnedCzk), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Tile label="Celkem vyděláno" value={formatCzk(summary.totalCzk)} accent />
        <Tile label="Účtovatelné" value={formatHours(summary.billableMinutes)} />
        <Tile label="Neúčtovatelné" value={formatHours(summary.unbillableMinutes)} />
        <Tile
          label="Prům. sazba"
          value={summary.avgEffectiveHourlyRateCzk != null ? `${formatCzk(summary.avgEffectiveHourlyRateCzk)}/h` : '–'}
        />
      </div>

      {summary.perProject.length > 0 && (
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
          {summary.perProject.map((p) => (
            <div
              key={p.projectId}
              onClick={() => onOpenProject(p.projectId)}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {p.color && (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, fontSize: 13, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name || '(bez názvu)'}
                </div>
                <div style={{ fontSize: 12, color: C.violet, flexShrink: 0 }}>{formatCzk(p.earnedCzk)}</div>
              </div>
              <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(p.earnedCzk / maxEarned) * 100}%`, height: '100%', background: p.color ?? C.violet, borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
