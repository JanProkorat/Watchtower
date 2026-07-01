import { C } from './tokens.js';
import { glassCard, text } from '../../../theme/glass.js';
import type { ProjectBreakdownSlice } from '@watchtower/shared/billing/reports/breakdown.js';
import { formatHours } from '../../../lib/czFormat.js';

interface ProjectDonutProps {
  slices: ProjectBreakdownSlice[];
  onOpenProject(id: number): void;
}

const FALLBACK = ['#A78BFA', '#22D3EE', '#fbbf24', '#f87171', '#34d399', '#f472b6', '#60a5fa', '#a3e635'];

export function ProjectDonut({ slices, onOpenProject }: ProjectDonutProps): JSX.Element {
  if (slices.length === 0) {
    return <div style={{ fontSize: 13, color: text.muted, padding: '8px 0' }}>žádná data</div>;
  }

  const totalMinutes = slices.reduce((acc, s) => acc + s.minutes, 0);
  const R = 60;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;

  const colored = slices.map((s, i) => ({ ...s, drawColor: s.color ?? FALLBACK[i % FALLBACK.length] }));

  return (
    <div
      style={{
        ...glassCard(12),
        padding: '16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div style={{ position: 'relative', width: 150, height: 150, flexShrink: 0 }}>
        <svg width={150} height={150} viewBox="0 0 150 150">
          <g transform="rotate(-90 75 75)">
            {colored.map((s) => {
              const len = s.share * CIRC;
              const dash = `${len} ${CIRC - len}`;
              const circle = (
                <circle
                  key={s.projectId}
                  cx={75}
                  cy={75}
                  r={R}
                  fill="none"
                  stroke={s.drawColor}
                  strokeWidth={22}
                  strokeDasharray={dash}
                  strokeDashoffset={CIRC - offset}
                />
              );
              offset += len;
              return circle;
            })}
          </g>
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: text.primary }}>{formatHours(totalMinutes)}</div>
          <div style={{ fontSize: 10, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>celkem</div>
        </div>
      </div>

      {/* Legend doubles as a horizontal breakdown — the proportional bar fills
          the otherwise-empty width so the wide card reads intentionally. */}
      <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {colored.map((s) => (
          <div
            key={s.projectId}
            onClick={() => onOpenProject(s.projectId)}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: s.drawColor, flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 13, color: text.primary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name || '(bez názvu)'}
              </div>
              <div style={{ fontSize: 12.5, color: text.secondary, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{formatHours(s.minutes)}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: text.primary, width: 46, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(s.share * 100)} %
              </div>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(2, s.share * 100)}%`, height: '100%', borderRadius: 999, background: s.drawColor }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
