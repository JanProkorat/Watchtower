import { useState } from 'react';
import { useBilling, useWorklogMutations, canEdit } from '@watchtower/data-supabase';
import { buildTaskGrid } from '@watchtower/shared/billing/records/task-grid.js';
import { worklogsForCell } from '@watchtower/shared/billing/records/worklog-cell.js';
import { addMonths, czechMonthLabel, useIsNarrow } from '@watchtower/ui-core';
import { formatCzk, formatHours } from '@watchtower/ui-core';
import { czechHolidays, workdayDates } from '@watchtower/shared/billing/workdays.js';
import { C } from '../reports/tokens.js';
import { BottomSheet, dataPanelFill, glassCard, ctaGradient, ctaGlow } from '@watchtower/ui-core';
import { WorklogDrawer } from './WorklogDrawer.js';
import type { WorklogRow, TaskRow } from '@watchtower/shared/billing/types.js';

const CELL = 34; // px per day column
const DOW_ABBR = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

interface DayMeta { isWeekend: boolean; isToday: boolean; kind: 'holiday' | 'vacation' | 'sick' | 'other' | null }

type Sheet =
  | { mode: 'closed' }
  | { mode: 'list'; entries: WorklogRow[]; task: TaskRow | null; date: string }
  | { mode: 'create'; task: TaskRow; date: string }
  | { mode: 'edit'; worklog: WorklogRow };

// Per-cell tint for non-working / status days. Presentation only — does not affect totals.
function dayTint(meta: DayMeta): string | undefined {
  if (meta.kind === 'vacation') return 'rgba(34,211,238,0.16)';
  if (meta.kind === 'sick') return 'rgba(248,113,113,0.16)';
  if (meta.kind === 'holiday') return 'rgba(168,156,240,0.20)';
  if (meta.isWeekend) return 'rgba(150,160,190,0.13)';
  return undefined;
}

export function TaskGridView(): JSX.Element {
  const { data, state, patchWorklogs } = useBilling();
  // Phone width: slim the two frozen columns and day cells so more of the month
  // is visible before horizontal scroll (iPad keeps the roomier layout).
  const isNarrow = useIsNarrow();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const [sheet, setSheet] = useState<Sheet>({ mode: 'closed' });
  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];
  const tasks = data?.tasks ?? [];
  const editable = canEdit(state);

  // Tapping a day cell opens the right surface for how many worklogs it holds:
  // none → create (task+date locked); one → edit that entry; many → list sheet.
  function openCell(row: { projectId: number; taskNumber: string | null }, dayIdx: number): void {
    if (!editable) return;
    const workDate = `${month}-${String(dayIdx + 1).padStart(2, '0')}`;
    const entries = worklogsForCell(worklogs, { projectId: row.projectId, taskNumber: row.taskNumber, workDate });
    const task = tasks.find((t) => t.projectId === row.projectId && (t.taskNumber ?? '') === (row.taskNumber ?? '')) ?? null;
    if (entries.length === 0) {
      if (task) setSheet({ mode: 'create', task, date: workDate });
    } else if (entries.length === 1) {
      setSheet({ mode: 'edit', worklog: entries[0]! });
    } else {
      setSheet({ mode: 'list', entries, task, date: workDate });
    }
  }

  const g = buildTaskGrid(worklogs, { month, projectId });
  const dayHeaders = Array.from({ length: g.daysInMonth }, (_, i) => i + 1);
  const hrs = (min: number) => (min === 0 ? '' : (min / 60).toFixed(1).replace('.', ','));

  // Per-day tint metadata: weekend / holiday / vacation / sick / today. Computed from the
  // month string + days-off data already in the billing payload — no new fetch, no mutation.
  const daysOff = data?.daysOff ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const [yr, mo] = month.split('-').map(Number) as [number, number];
  const holidayDates = new Set<string>();
  for (const [date] of czechHolidays(yr)) holidayDates.add(date);
  const dayMeta: DayMeta[] = Array.from({ length: g.daysInMonth }, (_, i) => {
    const d = i + 1;
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const dow = new Date(Date.UTC(yr, mo - 1, d)).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const isToday = date === today;
    const doff = daysOff.find((x) => x.date === date);
    const kind: DayMeta['kind'] = holidayDates.has(date) ? 'holiday' : doff ? (doff.kind as 'vacation' | 'sick' | 'other') : null;
    return { isWeekend, isToday, kind };
  });

  // Capacity + expected targets for the footer "total / target" (matches the
  // desktop grid): workdays = Mon-Fri minus Czech holidays minus user days off;
  // capacity = workdays × 8h; expected = Σ over workdays × each billable project
  // that contributed worklogs, of the MD rate active that day (daily →
  // rateAmount, hourly → rateAmount × hoursPerDay).
  const contracts = data?.contracts ?? [];
  const { createWorklog, updateWorklog, deleteWorklog, error } = useWorklogMutations({ worklogs, contracts, patchWorklogs });
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(g.daysInMonth).padStart(2, '0')}`;
  const daysOffSet = new Set(daysOff.filter((d) => d.date >= monthStart && d.date <= monthEnd).map((d) => d.date));
  const workdays = workdayDates(monthStart, monthEnd, daysOffSet);
  const capacityMinutes = workdays.length * 8 * 60;
  const filteredWl = projectId === undefined ? worklogs : worklogs.filter((w) => w.projectId === projectId);
  const billableProjectIds = [...new Set(filteredWl.filter((w) => w.isBillable && w.projectId).map((w) => w.projectId))];
  let expectedCzk = 0;
  for (const date of workdays) {
    for (const pid of billableProjectIds) {
      const c = contracts.find((k) => k.projectId === pid && k.effectiveFrom <= date && (k.endDate == null || date <= k.endDate));
      if (c) expectedCzk += c.rateType === 'daily' ? c.rateAmount : c.rateAmount * c.hoursPerDay;
    }
  }
  expectedCzk = Math.round(expectedCzk);
  const hrsVal = (min: number): string => new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(min / 60);
  const czkVal = (czk: number): string => new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(czk);

  const stepBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#c9bdff', fontSize: 18, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
  const flatBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#c2c9d8', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  // Column widths — slimmer on phone width so the two frozen columns don't eat
  // the whole viewport. Σ sits right after the task name, frozen left alongside it.
  const cell = isNarrow ? 30 : CELL;
  const NAME_W = isNarrow ? 116 : 180;
  const SIG_W = isNarrow ? 64 : 120;
  const cellBase: React.CSSProperties = { width: cell, minWidth: cell, textAlign: 'center', fontSize: 11, borderLeft: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' };
  const nameCol: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: '#101019', minWidth: NAME_W, maxWidth: NAME_W, paddingRight: 8 };
  // Sticky header/footer cells must be opaque so scrolling rows don't bleed
  // through — layer any day tint over the solid header/footer fill.
  const HEAD_BG = '#14151d';
  const FOOT_BG = '#161620';
  const FOOT_H = 28; // footer row height (drives the stacked bottom offsets)
  const overTint = (bg: string | undefined, base: string): string =>
    bg ? `linear-gradient(${bg}, ${bg}), ${base}` : base;
  const sigCol: React.CSSProperties = { position: 'sticky', left: NAME_W, minWidth: SIG_W, width: SIG_W, textAlign: 'right', paddingRight: 10, whiteSpace: 'nowrap', borderRight: '1px solid rgba(255,255,255,0.10)', borderBottom: '1px solid rgba(255,255,255,0.05)' };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: 'transparent', height: '100%', minHeight: 0, color: C.text, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, zIndex: 11, margin: '12px 16px', padding: '10px 16px 12px', display: 'flex', flexDirection: 'column', gap: 10, ...glassCard(16) }}>
        {/* Row 1: month stepper (‹ label ›) + Dnes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={stepBtn} onClick={() => setMonth(addMonths(month, -1))} aria-label="Předchozí měsíc">‹</button>
          <div style={{ minWidth: 128, textAlign: 'center', fontSize: 15, fontWeight: 700, color: '#f4f4f8' }}>{czechMonthLabel(month)}</div>
          <button style={stepBtn} onClick={() => setMonth(addMonths(month, 1))} aria-label="Další měsíc">›</button>
          <div style={{ flex: 1 }} />
          <button style={flatBtn} onClick={() => setMonth(new Date().toISOString().slice(0, 7))}>Dnes</button>
        </div>
        {/* Row 2: full-width project filter */}
        <select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value === '' ? undefined : Number(e.target.value))}
          style={{ width: '100%', height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#c2c9d8', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
        >
          <option value="">Všechny projekty</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name || '(bez názvu)'}</option>)}
        </select>
      </div>

      {/* legend — matches the prototype's non-working-day key */}
      <div style={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11, color: C.muted, padding: '10px 16px 0' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(150,160,190,0.45)', display: 'inline-block' }} />víkend</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#a89cf0', display: 'inline-block' }} />svátek</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#22D3EE', display: 'inline-block' }} />dovolená</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#f87171', display: 'inline-block' }} />nemoc</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, boxShadow: 'inset 0 0 0 1.5px #a89cf0', display: 'inline-block' }} />dnes</span>
      </div>

      {!editable && (
        <div style={{ flexShrink: 0, padding: '6px 16px 0', fontSize: 12, color: C.muted }}>jen pro čtení offline</div>
      )}
      {error && (
        <div style={{ flexShrink: 0, padding: '6px 16px 0', fontSize: 12, color: C.red }}>{error}</div>
      )}

      {g.tasks.length === 0 ? (
        <div style={{ padding: 24, color: C.muted, fontSize: 14 }}>žádné záznamy pro tento měsíc</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, margin: '12px 16px', borderRadius: 12, overflow: 'hidden', background: dataPanelFill, border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', height: '100%' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, color: C.text, height: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...nameCol, top: 0, textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, background: HEAD_BG, padding: '6px 8px 6px 0', zIndex: 4 }}>Úkol</th>
                  <th style={{ ...sigCol, top: 0, zIndex: 4, color: C.muted, fontWeight: 600, background: HEAD_BG }}>Σ</th>
                  {dayHeaders.map((d, i) => {
                    const meta = dayMeta[i]!;
                    const bg = dayTint(meta);
                    const todayStyle: React.CSSProperties = meta.isToday ? { boxShadow: 'inset 0 0 0 1.5px rgba(168,156,240,0.7)' } : {};
                    const weColor = meta.isWeekend ? '#c9bdff' : undefined;
                    return (
                      <th key={d} style={{ ...cellBase, position: 'sticky', top: 0, zIndex: 3, background: overTint(bg, HEAD_BG), ...todayStyle, color: C.muted, fontWeight: 600, padding: '4px 0' }}>
                        <div style={{ fontSize: 10, color: weColor ?? '#c2c9d8', lineHeight: 1.15 }}>{d}</div>
                        <div style={{ fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.2px', color: weColor ?? C.muted }}>{DOW_ABBR[(new Date(Date.UTC(yr, mo - 1, d)).getUTCDay() + 6) % 7]!}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {g.tasks.map((t) => {
                  const rowTotal = t.perDay.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={t.key}>
                      <td style={{ ...nameCol, padding: '6px 8px 6px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {t.projectColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.projectColor, flexShrink: 0 }} />}
                          <span style={{ fontFamily: 'monospace', color: C.muted, flexShrink: 0, fontSize: 11 }}>{t.taskNumber ?? '(bez úkolu)'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#c2c9d8' }}>{t.taskTitle ?? ''}</span>
                        </div>
                      </td>
                      <td style={{ ...sigCol, background: '#101019', zIndex: 1, fontWeight: 700, color: C.violet, fontSize: 12 }}>{hrs(rowTotal)}</td>
                      {t.perDay.map((min, i) => {
                        const meta = dayMeta[i]!;
                        const bg = dayTint(meta);
                        const todayStyle: React.CSSProperties = meta.isToday ? { boxShadow: 'inset 0 0 0 1.5px rgba(168,156,240,0.7)' } : {};
                        return (
                          <td key={i} style={{ ...cellBase, padding: 0, background: bg, color: min ? '#c2c9d8' : '#5a6072', ...todayStyle }}>
                            <button
                              onClick={() => openCell(t, i)}
                              disabled={!editable}
                              // Narrow (iPhone): taller tap target — day columns can't widen past
                              // ~30px without losing the month, so we buy touch comfort vertically.
                              // The tap highlight flags which cell was hit on a dense grid.
                              style={{ width: '100%', minHeight: isNarrow ? 40 : 26, background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: editable ? 'pointer' : 'default', padding: '5px 0', WebkitTapHighlightColor: 'rgba(168,156,240,0.35)' }}
                            >
                              {hrs(min)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {/* Filler — absorbs leftover height so the pinned footer sits at
                    the very bottom even when there are only a few task rows. */}
                <tr aria-hidden>
                  <td colSpan={g.daysInMonth + 2} style={{ height: '100%', padding: 0, border: 'none', background: 'transparent' }} />
                </tr>
              </tbody>
              <tfoot>
                {/* Pinned to the bottom; only the tbody scrolls. Celkem sits one
                    footer-row above Výdělek (bottom: FOOT_H vs 0). */}
                <tr>
                  <td style={{ ...nameCol, position: 'sticky', left: 0, bottom: FOOT_H, zIndex: 3, height: FOOT_H, fontSize: 11, color: C.muted, fontWeight: 700, background: FOOT_BG, borderTop: '1px solid rgba(255,255,255,0.12)' }}>Celkem (h)</td>
                  <td style={{ ...sigCol, bottom: FOOT_H, zIndex: 3, height: FOOT_H, background: FOOT_BG, borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: 11 }}>
                    <b style={{ color: C.violet }}>{hrsVal(g.monthTotalMinutes)}</b>
                    <span style={{ color: C.muted, fontWeight: 400 }}> / {hrsVal(capacityMinutes)}</span>
                  </td>
                  {g.dailyTotals.map((min, i) => {
                    const bg = dayTint(dayMeta[i]!);
                    return <td key={i} style={{ ...cellBase, position: 'sticky', bottom: FOOT_H, zIndex: 2, height: FOOT_H, background: overTint(bg, FOOT_BG), color: C.violet, fontWeight: 600, borderTop: '1px solid rgba(255,255,255,0.12)' }}>{hrs(min)}</td>;
                  })}
                </tr>
                <tr>
                  <td style={{ ...nameCol, position: 'sticky', left: 0, bottom: 0, zIndex: 3, height: FOOT_H, fontSize: 11, color: C.muted, fontWeight: 700, background: FOOT_BG }}>Výdělek</td>
                  <td style={{ ...sigCol, bottom: 0, zIndex: 3, height: FOOT_H, background: FOOT_BG, fontSize: 11 }}>
                    <b style={{ color: C.violet }}>{formatCzk(g.monthTotalCzk)}</b>
                    <span style={{ color: C.muted, fontWeight: 400 }}> / {czkVal(expectedCzk)}</span>
                  </td>
                  {g.dailyEarnings.map((czk, i) => {
                    const bg = dayTint(dayMeta[i]!);
                    return <td key={i} style={{ ...cellBase, position: 'sticky', bottom: 0, zIndex: 2, height: FOOT_H, background: overTint(bg, FOOT_BG), color: czk ? '#c2c9d8' : '#5a6072', fontSize: 10 }}>{czk ? Math.round(czk) : ''}</td>;
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {sheet.mode === 'list' && (
        <BottomSheet onClose={() => setSheet({ mode: 'closed' })} style={{ gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#f4f4f8' }}>Záznamy</div>
              <button onClick={() => setSheet({ mode: 'closed' })} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            {sheet.entries.map((w) => (
              <button
                key={w.syncId}
                onClick={() => setSheet({ mode: 'edit', worklog: w })}
                style={{ ...glassCard(10), display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '8px 12px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: C.text, width: '100%', border: '1px solid rgba(255,255,255,0.10)' }}
              >
                <div style={{ flex: 1, fontSize: 13, color: '#d7dbe6', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.description || w.taskTitle || w.projectName}</div>
                <div style={{ fontSize: 12, color: '#c2c9d8', flexShrink: 0 }}>
                  {formatHours(w.minutes)}
                  {w.effectiveMinutes !== w.minutes && <span style={{ color: C.muted }}> → {formatHours(w.effectiveMinutes)}</span>}
                </div>
              </button>
            ))}
            {sheet.task && (
              <button
                onClick={() => setSheet(sheet.task ? { mode: 'create', task: sheet.task, date: sheet.date } : { mode: 'closed' })}
                style={{ marginTop: 4, height: 38, borderRadius: 11, border: 'none', background: ctaGradient, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: ctaGlow }}
              >
                + Přidat
              </button>
            )}
        </BottomSheet>
      )}

      {sheet.mode === 'create' && (
        <WorklogDrawer
          title="Nový záznam"
          tasks={tasks}
          contracts={contracts}
          lockedTask={sheet.task}
          initialDate={sheet.date}
          onClose={() => setSheet({ mode: 'closed' })}
          onSubmit={async (taskRow, input) => { await createWorklog(taskRow, input); setSheet({ mode: 'closed' }); }}
        />
      )}
      {sheet.mode === 'edit' && (
        <WorklogDrawer
          title="Upravit záznam"
          tasks={tasks}
          contracts={contracts}
          initial={sheet.worklog}
          onClose={() => setSheet({ mode: 'closed' })}
          onSubmit={async (_taskRow, input) => { await updateWorklog(sheet.worklog.syncId, input); setSheet({ mode: 'closed' }); }}
          onDelete={async () => { await deleteWorklog(sheet.worklog.syncId); setSheet({ mode: 'closed' }); }}
        />
      )}
    </div>
  );
}
