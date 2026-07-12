import { useState } from 'react';
import { useBilling } from '@watchtower/data-supabase';
import { aggregateMonthEarnings, trailingMonths } from '@watchtower/shared/billing/earnings.js';
import { formatCzk, formatHours } from '@watchtower/ui-core';
import { czechMonthLabel, addMonths } from '@watchtower/ui-core';
import {
  glassCard,
  text as glassText,
  accent,
} from '@watchtower/ui-core';

// ---------------------------------------------------------------------------
// Design tokens (same palette as DashboardView)
// ---------------------------------------------------------------------------
const C = {
  ground: '#0F0F17',
  surface: '#16161F',
  border: '#2a2a3c',
  muted: '#8B88A6',
  text: '#e2e1f0',
  violet: '#38bdf8',
  violetDim: '#3d7fb0',
  violetBg: '#12314a',
  cyan: '#22D3EE',
} as const;

// ---------------------------------------------------------------------------
// Month picker
// ---------------------------------------------------------------------------

function MonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (m: string) => void;
}): JSX.Element {
  const btnStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 8,
    color: glassText.secondary,
    fontSize: 20,
    lineHeight: 1,
    width: 36,
    height: 36,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
    flexShrink: 0,
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        margin: '12px 16px',
        padding: '12px 16px',
        ...glassCard(16),
      }}
    >
      <button style={btnStyle} onClick={() => onChange(addMonths(month, -1))}>
        ‹
      </button>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: glassText.primary,
          minWidth: 160,
          textAlign: 'center',
          letterSpacing: 0.2,
        }}
      >
        {czechMonthLabel(month)}
      </div>
      <button style={btnStyle} onClick={() => onChange(addMonths(month, 1))}>
        ›
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trailing months bar chart
// ---------------------------------------------------------------------------

function TrailingBars({
  months,
  selectedMonth,
}: {
  months: { month: string; earnedCzk: number }[];
  selectedMonth: string;
}): JSX.Element {
  const maxCzk = Math.max(...months.map((m) => m.earnedCzk), 1);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 6,
        height: 80,
        paddingBottom: 20, // leave room for captions
        position: 'relative',
      }}
    >
      {months.map(({ month, earnedCzk }) => {
        const isSelected = month === selectedMonth;
        const pct = (earnedCzk / maxCzk) * 100;
        // Label: abbreviated month (first 3 chars of Czech name)
        const parts = month.split('-');
        const mNum = parseInt(parts[1] ?? '1', 10);
        const shortNames = ['led', 'úno', 'bře', 'dub', 'kvě', 'čer', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
        const caption = shortNames[mNum - 1] ?? '';

        return (
          <div
            key={month}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-end',
              height: '100%',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: '100%',
                height: `${Math.max(pct, 3)}%`,
                background: isSelected ? C.violet : C.violetDim + '88',
                borderRadius: '3px 3px 0 0',
                transition: 'height 0.2s',
              }}
              title={`${czechMonthLabel(month)}: ${formatCzk(earnedCzk)}`}
            />
            <div
              style={{
                position: 'absolute',
                bottom: -18,
                fontSize: 9,
                color: isSelected ? C.violet : glassText.muted,
                fontWeight: isSelected ? 700 : 400,
                letterSpacing: 0.2,
                textAlign: 'center',
                width: '100%',
              }}
            >
              {caption}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-project row
// ---------------------------------------------------------------------------

function ProjectRow({
  name,
  color,
  minutes,
  earnedCzk,
  barPct,
  onTap,
}: {
  name: string;
  color: string | null;
  minutes: number;
  earnedCzk: number;
  barPct: number;
  onTap: () => void;
}): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onTap}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onTap(); }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '12px 0',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Color dot */}
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: color ?? C.violetDim,
            flexShrink: 0,
          }}
        />
        {/* Name */}
        <div
          style={{
            flex: 1,
            fontSize: 14,
            fontWeight: 500,
            color: glassText.primary,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name || '(bez názvu)'}
        </div>
        {/* Hours */}
        <div style={{ fontSize: 12, color: glassText.muted, flexShrink: 0 }}>
          {formatHours(minutes)}
        </div>
        {/* Earnings */}
        <div style={{ fontSize: 13, fontWeight: 600, color: C.violet, flexShrink: 0, minWidth: 80, textAlign: 'right' }}>
          {formatCzk(earnedCzk)}
        </div>
        {/* Chevron */}
        <div style={{ fontSize: 16, color: glassText.muted, flexShrink: 0 }}>›</div>
      </div>
      {/* Proportional bar */}
      <div
        style={{
          marginLeft: 18,
          height: 3,
          background: 'rgba(255,255,255,0.10)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${barPct}%`,
            height: '100%',
            background: color ?? C.violet,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }): JSX.Element {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.8,
        color: glassText.muted,
        textTransform: 'uppercase',
        marginBottom: 8,
      }}
    >
      {title}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading spinner (matches DashboardView pattern)
// ---------------------------------------------------------------------------

function Spinner(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: glassText.muted,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 15,
        padding: 32,
        minHeight: 200,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: '3px solid rgba(255,255,255,0.10)',
          borderTop: `3px solid ${accent}`,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      Načítání…
    </div>
  );
}

// ---------------------------------------------------------------------------
// EarningsMonthView — main export
// ---------------------------------------------------------------------------

export function EarningsMonthView({ onOpenProject }: { onOpenProject: (projectId: number, month: string) => void }): JSX.Element {
  const { data, state } = useBilling();

  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    new Date().toISOString().slice(0, 7),
  );

  // Loading state with no data
  if (state === 'loading' && data == null) {
    return (
      <div
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: 'transparent',
          minHeight: '100%',
          color: glassText.primary,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <MonthPicker month={selectedMonth} onChange={setSelectedMonth} />
        <Spinner />
      </div>
    );
  }

  const worklogs = data?.worklogs ?? [];

  const { totalCzk, perProject } = aggregateMonthEarnings(worklogs, selectedMonth);
  const trailing = trailingMonths(worklogs, selectedMonth, 8);

  const maxEarned = Math.max(...perProject.map((p) => p.earnedCzk), 1);

  return (
    <div
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: 'transparent',
        minHeight: '100%',
        color: glassText.primary,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {/* ---- Month picker ---- */}
      <MonthPicker month={selectedMonth} onChange={setSelectedMonth} />

      <div style={{ padding: '0 16px 32px', display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 16 }}>

        {/* ---- Hero total ---- */}
        <div
          style={{
            ...glassCard(),
            padding: '20px 20px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: glassText.muted, textTransform: 'uppercase' }}>
            Celkem výdělky
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              color: C.violet,
              fontFamily: "'SF Mono', 'Fira Mono', 'Menlo', monospace",
              letterSpacing: -1,
              lineHeight: 1.1,
            }}
          >
            {formatCzk(totalCzk)}
          </div>
        </div>

        {/* ---- Trailing-months bar chart ---- */}
        <div>
          <SectionHeader title="Vývoj (8 měsíců)" />
          <div
            style={{
              ...glassCard(12),
              padding: '16px 12px 28px',
            }}
          >
            <TrailingBars months={trailing} selectedMonth={selectedMonth} />
          </div>
        </div>

        {/* ---- Per-project list ---- */}
        <div>
          <SectionHeader title="Projekty" />
          {perProject.length === 0 ? (
            <div
              style={{
                ...glassCard(12),
                padding: '28px 16px',
                textAlign: 'center',
                color: glassText.muted,
                fontSize: 14,
              }}
            >
              žádný výdělek v tomto měsíci
            </div>
          ) : (
            <div
              style={{
                ...glassCard(12),
                padding: '0 16px',
              }}
            >
              {perProject.map((p) => (
                <ProjectRow
                  key={p.projectId}
                  name={p.name}
                  color={p.color}
                  minutes={p.minutes}
                  earnedCzk={p.earnedCzk}
                  barPct={(p.earnedCzk / maxEarned) * 100}
                  onTap={() => onOpenProject(p.projectId, selectedMonth)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
