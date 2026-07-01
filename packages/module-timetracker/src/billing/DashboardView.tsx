import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBilling } from '@watchtower/data-supabase';
import { dashboardKpis } from '@watchtower/shared/billing/dashboard.js';
import { contractBurn } from '@watchtower/shared/billing/contracts.js';
import { activityHeatmap } from '@watchtower/shared/billing/heatmap.js';
import { topProjects } from '@watchtower/shared/billing/earnings.js';
import { formatCzk, formatHours, formatDateCz } from '@watchtower/ui-core';
import { glassCard, glassPanel, text as glassText, accent as glassAccent } from '@watchtower/ui-core';
import { PullToRefresh, useIsNarrow } from '@watchtower/ui-core';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const C = {
  ground: '#0F0F17',
  surface: '#16161F',
  surfaceHover: '#1c1c28',
  border: '#2a2a3c',
  muted: '#8B88A6',
  text: '#e2e1f0',
  violet: '#A78BFA',
  violetDim: '#6d5fbb',
  violetBg: '#2d2857',
  cyan: '#22D3EE',
  cyanBg: '#0b3540',
  amber: '#fbbf24',
  amberBg: '#3b2b07',
  red: '#f87171',
} as const;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiTile({
  label,
  minutes,
  earnedCzk,
  narrow = false,
}: {
  label: string;
  minutes: number;
  earnedCzk: number;
  narrow?: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        // On phone width the parent row wraps; a ~40% floor forces a 2-per-row
        // grid (third tile drops to its own row) instead of three 112px slivers.
        flex: narrow ? '1 1 40%' : 1,
        minWidth: narrow ? 130 : 0,
        ...glassCard(12),
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: glassText.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: glassText.primary, lineHeight: 1.2 }}>
        {formatHours(minutes)}
      </div>
      <div style={{ fontSize: 13, color: glassAccent, fontWeight: 500 }}>
        {formatCzk(earnedCzk)}
      </div>
    </div>
  );
}

function BurnBar({
  used,
  limit,
  projected,
}: {
  used: number;
  limit: number | null;
  projected: number | null;
}): JSX.Element {
  if (limit == null) {
    return (
      <div style={{ fontSize: 12, color: glassText.muted }}>
        {used.toFixed(2)} MD (bez limitu)
      </div>
    );
  }
  const usedPct = Math.min(1, used / limit) * 100;
  const projPct = projected != null ? Math.min(1, projected / limit) * 100 : null;
  const isOverrun = projected != null && projected > limit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: glassText.muted }}>
        <span>{used.toFixed(2)} / {limit} MD</span>
        {projected != null && (
          <span style={{ color: isOverrun ? C.amber : glassText.muted }}>
            odhad: {projected.toFixed(2)} MD
          </span>
        )}
      </div>
      <div
        style={{
          position: 'relative',
          height: 8,
          background: 'rgba(255,255,255,0.08)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        {/* Used fill */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${usedPct}%`,
            height: '100%',
            background: C.violet,
            borderRadius: 4,
            transition: 'width 0.3s',
          }}
        />
        {/* Projected overrun indicator — amber bar overlay */}
        {isOverrun && projPct != null && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${usedPct}%`,
              width: `${projPct - usedPct}%`,
              height: '100%',
              background: C.amber,
              opacity: 0.7,
              borderRadius: 4,
            }}
          />
        )}
        {/* Projected marker tick when within limit */}
        {!isOverrun && projPct != null && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${projPct}%`,
              width: 2,
              height: '100%',
              background: C.cyan,
              transform: 'translateX(-50%)',
            }}
          />
        )}
      </div>
    </div>
  );
}

function ContractCard({
  name,
  mdsUsed,
  mdLimit,
  projectedMds,
  workdaysRemaining,
  projectColor,
}: {
  name: string;
  mdsUsed: number;
  mdLimit: number | null;
  projectedMds: number | null;
  workdaysRemaining: number | null;
  projectColor: string | null;
}): JSX.Element {
  return (
    <div
      style={{
        ...glassCard(12),
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {projectColor && (
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: projectColor,
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ fontSize: 14, fontWeight: 600, color: glassText.primary, flex: 1, minWidth: 0 }}>
          {name || '(bez názvu)'}
        </div>
        {workdaysRemaining != null && (
          <div style={{ fontSize: 12, color: glassText.muted, flexShrink: 0 }}>
            {workdaysRemaining} pd zbývá
          </div>
        )}
      </div>
      <BurnBar used={mdsUsed} limit={mdLimit} projected={projectedMds} />
    </div>
  );
}

function heatmapColor(minutes: number, maxMinutes: number): string {
  if (minutes === 0 || maxMinutes === 0) return 'rgba(255,255,255,0.08)';
  const ratio = minutes / maxMinutes;
  if (ratio < 0.25) return C.violetDim + '55'; // ~level 1
  if (ratio < 0.5) return C.violetDim;          // level 2
  if (ratio < 0.75) return C.violet + 'cc';     // level 3
  return C.violet;                               // level 4
}

function HeatmapGrid({
  days,
}: {
  days: { date: string; minutes: number }[];
}): JSX.Element {
  const maxMinutes = Math.max(...days.map((d) => d.minutes), 1);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 3,
        // Cap the width so the aspect-ratio cells stay small squares on a wide
        // iPad instead of stretching to ~width/7 and dominating the card.
        maxWidth: 280,
      }}
    >
      {days.map((d) => (
        <div
          key={d.date}
          title={`${formatDateCz(d.date)}: ${d.minutes > 0 ? formatHours(d.minutes) : '–'}`}
          style={{
            aspectRatio: '1',
            borderRadius: 3,
            background: heatmapColor(d.minutes, maxMinutes),
          }}
        />
      ))}
    </div>
  );
}

function StatStrip({
  currentStreak,
  longestStreak,
  activeDays,
  weeklyAvgMinutes,
  busiestDay,
}: {
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  weeklyAvgMinutes: number;
  busiestDay: string | null;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 16px',
        fontSize: 12,
        color: glassText.muted,
      }}
    >
      <span>
        <strong style={{ color: glassAccent }}>{currentStreak}</strong> dní v řadě
      </span>
      <span>
        nejdelší série: <strong style={{ color: glassText.primary }}>{longestStreak}</strong>
      </span>
      <span>
        aktivní dny: <strong style={{ color: glassText.primary }}>{activeDays}</strong>
      </span>
      <span>
        průměr/týden: <strong style={{ color: glassText.primary }}>{formatHours(weeklyAvgMinutes)}</strong>
      </span>
      {busiestDay && (
        <span>
          nejrušnější: <strong style={{ color: glassText.primary }}>{formatDateCz(busiestDay)}</strong>
        </span>
      )}
    </div>
  );
}

function TopProjectRow({
  name,
  minutes,
  earnedCzk,
  barPct,
  color,
  rank,
}: {
  name: string;
  minutes: number;
  earnedCzk: number;
  barPct: number;
  color: string | null;
  rank: number;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 18, fontSize: 11, color: glassText.muted, textAlign: 'right', flexShrink: 0 }}>
          {rank}.
        </div>
        {color && (
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: color,
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1, fontSize: 13, color: glassText.primary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name || '(bez názvu)'}
        </div>
        <div style={{ fontSize: 12, color: glassText.muted, flexShrink: 0 }}>{formatHours(minutes)}</div>
        {earnedCzk > 0 && (
          <div style={{ fontSize: 12, color: glassAccent, flexShrink: 0 }}>{formatCzk(earnedCzk)}</div>
        )}
      </div>
      <div
        style={{
          marginLeft: 26,
          height: 4,
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
// Main DashboardView
// ---------------------------------------------------------------------------

export function DashboardView(): JSX.Element {
  const { data, state, refresh } = useBilling();
  // Phone width: let the three KPI tiles wrap (2 + 1) instead of squeezing into
  // one 112px-per-tile row. iPad (above the breakpoint) keeps the single row.
  const isNarrow = useIsNarrow();

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  // Transient "Přehled aktualizováno" toast, fired after a pull-to-refresh settles.
  const [toastN, setToastN] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);
  const handleRefresh = useCallback(async () => {
    await refresh();
    setToastN((n) => n + 1);
  }, [refresh]);
  useEffect(() => {
    if (toastN === 0) return;
    setToastVisible(true);
    const t = setTimeout(() => setToastVisible(false), 2200);
    return () => clearTimeout(t);
  }, [toastN]);

  // Derived data — memoized so unrelated re-renders (toast, pull gesture) don't
  // re-crunch the full worklog set on the main thread and jank scrolling.
  const { kpis, burns, heatmap, top, monthHasData, topMaxMinutes } = useMemo(() => {
    const worklogs = data?.worklogs ?? [];
    const contracts = data?.contracts ?? [];
    const daysOff = data?.daysOff ?? [];
    const projects = data?.projects ?? [];
    const topList = topProjects(worklogs, month, 8);
    return {
      kpis: dashboardKpis(worklogs, { today }),
      burns: contractBurn(contracts, worklogs, daysOff, projects, { today }),
      heatmap: activityHeatmap(worklogs, { today, windowDays: 30 }),
      top: topList,
      monthHasData: worklogs.some((r) => r.workDate.slice(0, 7) === month),
      topMaxMinutes: Math.max(...topList.map((p) => p.minutes), 1),
    };
  }, [data, today, month]);

  // Loading with no data yet
  if (state === 'loading' && data == null) {
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
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid rgba(255,255,255,0.12)',
            borderTop: `3px solid ${C.violet}`,
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        Načítání…
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: glassText.primary,
          minHeight: '100%',
          padding: '16px 16px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >

        {/* ---- KPI tiles ---- */}
        <div>
          <SectionHeader title="Odpracováno" />
          <div style={{ display: 'flex', gap: 10, flexWrap: isNarrow ? 'wrap' : 'nowrap' }}>
            <KpiTile label="Dnes" minutes={kpis.today.minutes} earnedCzk={kpis.today.earnedCzk} narrow={isNarrow} />
            <KpiTile label="Sprint" minutes={kpis.sprint.minutes} earnedCzk={kpis.sprint.earnedCzk} narrow={isNarrow} />
            <KpiTile label="Tento měsíc" minutes={kpis.month.minutes} earnedCzk={kpis.month.earnedCzk} narrow={isNarrow} />
          </div>
        </div>

        {/* ---- Active contracts ---- */}
        {burns.length > 0 && (
          <div>
            <SectionHeader title="Aktivní kontrakty" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {burns.map((b) => (
                <ContractCard
                  key={`${b.projectId}`}
                  name={b.projectName}
                  mdsUsed={b.mdsUsed}
                  mdLimit={b.mdLimit}
                  projectedMds={b.projectedMds}
                  workdaysRemaining={b.workdaysRemaining}
                  projectColor={b.projectColor}
                />
              ))}
            </div>
          </div>
        )}

        {/* ---- Top projects ---- */}
        {monthHasData ? (
          <div>
            <SectionHeader title={`Top projekty — ${month.replace('-', '/')}`} />
            {top.length === 0 ? (
              <div style={{ fontSize: 13, color: glassText.muted, padding: '8px 0' }}>žádná data</div>
            ) : (
              <div
                style={{
                  ...glassCard(12),
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                {top.map((p, i) => (
                  <TopProjectRow
                    key={p.projectId}
                    rank={i + 1}
                    name={p.name}
                    minutes={p.minutes}
                    earnedCzk={p.earnedCzk}
                    barPct={(p.minutes / topMaxMinutes) * 100}
                    color={p.color}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              ...glassCard(12),
              padding: '28px 16px',
              textAlign: 'center',
              color: glassText.muted,
              fontSize: 14,
            }}
          >
            žádná data pro tento měsíc
          </div>
        )}

        {/* ---- Activity heatmap ---- */}
        <div>
          <SectionHeader title="Aktivita (30 dní)" />
          <div
            style={{
              ...glassCard(12),
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <HeatmapGrid days={heatmap.days} />
            <StatStrip
              currentStreak={heatmap.stats.currentStreak}
              longestStreak={heatmap.stats.longestStreak}
              activeDays={heatmap.stats.activeDays}
              weeklyAvgMinutes={heatmap.stats.weeklyAvgMinutes}
              busiestDay={heatmap.stats.busiestDay}
            />
          </div>
        </div>
      </div>
      {toastVisible && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            ...glassPanel({ radius: 999 }),
            padding: '9px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            fontWeight: 500,
            color: glassText.primary,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 8px #34d399' }} />
          Přehled aktualizováno
        </div>
      )}
    </PullToRefresh>
  );
}
