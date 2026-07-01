// apps/ipad/src/components/billing/reports/ReportsFilterBar.tsx
import { C } from './tokens.js';
import { glassCard, accentWash, accent, text } from '@watchtower/ui-core';
import type { Preset } from '../../useReportsFilters.js';
import { clampGranularity } from '../../useReportsFilters.js';
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

// A labeled filter field — small uppercase caption above its control group.
// Stacking the groups into captioned rows reads as an intentional filter card
// at any width (no floating divider / meaningless spacer as before).
function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: text.muted }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function ReportsFilterBar(props: ReportsFilterBarProps): JSX.Element {
  const { preset, granularity, projectId, projects, from, to } = props;
  // A granularity option is unavailable if the clamp would bump it for this range.
  const granDisabled = (g: Granularity) => clampGranularity(g, from, to) !== g;

  return (
    <div
      style={{
        ...glassCard(14),
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <Field label="Období">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button key={p.key} style={pill(preset === p.key)} onClick={() => props.onPreset(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Rozlišení">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
      </Field>

      <Field label="Projekt">
        <select
          value={projectId ?? ''}
          onChange={(e) => props.onProject(e.target.value === '' ? undefined : Number(e.target.value))}
          style={{
            width: '100%',
            background: 'rgba(48,52,76,0.40)',
            color: C.text,
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 9,
            padding: '9px 12px',
            fontSize: 14,
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
      </Field>
    </div>
  );
}
