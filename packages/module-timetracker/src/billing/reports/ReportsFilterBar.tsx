// apps/ipad/src/components/billing/reports/ReportsFilterBar.tsx
import { C } from './tokens.js';
import { glassCard, accentWash, accent, text } from '@watchtower/ui-core';
import type { Preset } from '../../useReportsFilters.js';
import { clampGranularity } from '../../useReportsFilters.js';
import type { Granularity } from '@watchtower/shared/billing/reports/buckets.js';
import type { ProjectRow } from '@watchtower/shared/billing/types.js';

// Short labels so all five presets fit one row of the segmented control (the
// OBDOBÍ caption already conveys these are time periods).
const PRESETS: { key: Preset; label: string }[] = [
  { key: '7d', label: '7 dní' },
  { key: '30d', label: '30 dní' },
  { key: 'month', label: 'Měsíc' },
  { key: 'year', label: 'Rok' },
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

// Glass segmented-control track — one per field (Období, Rozlišení).
const segTrack: React.CSSProperties = {
  display: 'flex',
  gap: 3,
  padding: 3,
  borderRadius: 11,
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
};

// Equal-width segment; the active one fills as a lit glass cell.
function segCell(active: boolean, disabled = false): React.CSSProperties {
  return {
    flex: 1,
    padding: '7px 4px',
    borderRadius: 8,
    border: 'none',
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    textAlign: 'center',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.32 : 1,
    background: active ? accentWash : 'transparent',
    color: active ? accent : text.muted,
    boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 3px rgba(0,0,0,0.25)' : 'none',
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
        <div style={segTrack}>
          {PRESETS.map((p) => (
            <button key={p.key} style={segCell(preset === p.key)} onClick={() => props.onPreset(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Rozlišení">
        <div style={segTrack}>
          {GRANS.map((g) => {
            const disabled = granDisabled(g.key);
            return (
              <button
                key={g.key}
                disabled={disabled}
                style={segCell(granularity === g.key, disabled)}
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
