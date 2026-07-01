// apps/ipad/src/components/billing/reports/ReportsFilterBar.tsx
import { C } from './tokens.js';
import { glassCard, accentWash, accent, text } from '@watchtower/ui-core';
import type { Preset } from '../../../state/useReportsFilters.js';
import { clampGranularity } from '../../../state/useReportsFilters.js';
import type { Granularity } from '@watchtower/shared/billing/reports/buckets.js';
import type { ProjectRow } from '@watchtower/shared/billing/types.js';

const PRESETS: { key: Preset; label: string }[] = [
  { key: '7d', label: '7 dní' },
  { key: '30d', label: '30 dní' },
  { key: 'month', label: 'Tento měsíc' },
  { key: 'year', label: 'Tento rok' },
  { key: 'all', label: 'Vše' },
];

const GRANS: { key: Granularity; label: string }[] = [
  { key: 'day', label: 'Den' },
  { key: 'week', label: 'Týden' },
  { key: 'month', label: 'Měsíc' },
];

interface ReportsFilterBarProps {
  preset: Preset;
  granularity: Granularity;
  projectId: number | undefined;
  projects: ProjectRow[];
  from: string;
  to: string;
  onPreset(p: Preset): void;
  onGranularity(g: Granularity): void;
  onProject(id: number | undefined): void;
}

function pill(active: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '5px 12px',
    borderRadius: 7,
    border: active ? '1px solid rgba(168,156,240,0.30)' : '1px solid transparent',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    background: active ? accentWash : 'transparent',
    color: active ? accent : text.muted,
    transition: 'background 0.15s, color 0.15s',
  };
}

export function ReportsFilterBar(props: ReportsFilterBarProps): JSX.Element {
  const { preset, granularity, projectId, projects, from, to } = props;
  // A granularity option is unavailable if the clamp would bump it for this range.
  const granDisabled = (g: Granularity) => clampGranularity(g, from, to) !== g;

  return (
    <div
      style={{
        ...glassCard(12),
        padding: '10px 14px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 12px',
      }}
    >
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <button key={p.key} style={pill(preset === p.key)} onClick={() => props.onPreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)' }} />

      <div style={{ display: 'flex', gap: 4 }}>
        {GRANS.map((g) => {
          const disabled = granDisabled(g.key);
          return (
            <button
              key={g.key}
              disabled={disabled}
              style={pill(granularity === g.key, disabled)}
              onClick={() => !disabled && props.onGranularity(g.key)}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <select
        value={projectId ?? ''}
        onChange={(e) => props.onProject(e.target.value === '' ? undefined : Number(e.target.value))}
        style={{
          background: 'rgba(48,52,76,0.40)',
          color: C.text,
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 7,
          padding: '5px 10px',
          fontSize: 13,
          fontFamily: 'inherit',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <option value="">Všechny projekty</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name || '(bez názvu)'}</option>
        ))}
      </select>
    </div>
  );
}
