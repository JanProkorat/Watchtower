import { useState } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { buildTaskGrid } from '@watchtower/shared/billing/records/task-grid.js';
import { addMonths, czechMonthLabel } from '../../../lib/monthHelpers.js';
import { formatHours, formatCzk } from '../../../lib/czFormat.js';
import { czechHolidays } from '@watchtower/shared/billing/workdays.js';
import { C } from '../reports/tokens.js';
import { glassPanel, dataPanelFill } from '../../../theme/glass.js';

const CELL = 34; // px per day column
const DOW_ABBR = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

interface DayMeta { isWeekend: boolean; isToday: boolean; kind: 'holiday' | 'vacation' | 'sick' | 'other' | null }

// Per-cell tint for non-working / status days. Presentation only — does not affect totals.
function dayTint(meta: DayMeta): string | undefined {
  if (meta.kind === 'vacation') return 'rgba(34,211,238,0.16)';
  if (meta.kind === 'sick') return 'rgba(248,113,113,0.16)';
  if (meta.kind === 'holiday') return 'rgba(168,156,240,0.20)';
  if (meta.isWeekend) return 'rgba(150,160,190,0.13)';
  return undefined;
}

export function TaskGridView(): JSX.Element {
  const { data } = useBilling();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];

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

  const btn: React.CSSProperties = { background: 'rgba(255,255,255,0.08)', color: '#c2c9d8', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10, padding: '0 14px', height: 30, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  const cellBase: React.CSSProperties = { width: CELL, minWidth: CELL, textAlign: 'center', fontSize: 11, borderLeft: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' };
  const nameCol: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: '#101019', minWidth: 180, maxWidth: 180, paddingRight: 8 };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: 'transparent', minHeight: '100%', color: C.text, display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 11, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...glassPanel({ radius: 13, blur: 28, saturate: 1.7 }), borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
        <button style={btn} onClick={() => setMonth(addMonths(month, -1))}>‹</button>
        <div style={{ fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: 'center', color: '#f4f4f8' }}>{czechMonthLabel(month)}</div>
        <button style={btn} onClick={() => setMonth(addMonths(month, 1))}>›</button>
        <button style={btn} onClick={() => setMonth(new Date().toISOString().slice(0, 7))}>Dnes</button>
        <div style={{ flex: 1 }} />
        <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value === '' ? undefined : Number(e.target.value))} style={{ ...btn, height: 34, padding: '0 12px' }}>
          <option value="">Všechny projekty</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name || '(bez názvu)'}</option>)}
        </select>
      </div>

      {/* legend — matches the prototype's non-working-day key */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11, color: C.muted, padding: '10px 16px 0' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(150,160,190,0.45)', display: 'inline-block' }} />víkend</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#a89cf0', display: 'inline-block' }} />svátek</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#22D3EE', display: 'inline-block' }} />dovolená</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#f87171', display: 'inline-block' }} />nemoc</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, boxShadow: 'inset 0 0 0 1.5px #a89cf0', display: 'inline-block' }} />dnes</span>
      </div>

      {g.tasks.length === 0 ? (
        <div style={{ padding: 24, color: C.muted, fontSize: 14 }}>žádné záznamy pro tento měsíc</div>
      ) : (
        <div style={{ margin: '12px 16px', borderRadius: 12, overflow: 'hidden', background: dataPanelFill, border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '70vh' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, color: C.text }}>
              <thead>
                <tr>
                  <th style={{ ...nameCol, textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, background: '#14151d', padding: '6px 8px 6px 0', zIndex: 2 }}>Úkol</th>
                  {dayHeaders.map((d, i) => {
                    const meta = dayMeta[i]!;
                    const bg = dayTint(meta);
                    const todayStyle: React.CSSProperties = meta.isToday ? { boxShadow: 'inset 0 0 0 1.5px rgba(168,156,240,0.7)' } : {};
                    const weColor = meta.isWeekend ? '#c9bdff' : undefined;
                    return (
                      <th key={d} style={{ ...cellBase, background: bg, ...todayStyle, color: C.muted, fontWeight: 600, padding: '4px 0' }}>
                        <div style={{ fontSize: 10, color: weColor ?? '#c2c9d8', lineHeight: 1.15 }}>{d}</div>
                        <div style={{ fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.2px', color: weColor ?? C.muted }}>{DOW_ABBR[(new Date(Date.UTC(yr, mo - 1, d)).getUTCDay() + 6) % 7]!}</div>
                      </th>
                    );
                  })}
                  <th style={{ ...cellBase, minWidth: 56, width: 56, color: C.muted, fontWeight: 600, background: '#14151d' }}>Σ</th>
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
                      {t.perDay.map((min, i) => {
                        const meta = dayMeta[i]!;
                        const bg = dayTint(meta);
                        const todayStyle: React.CSSProperties = meta.isToday ? { boxShadow: 'inset 0 0 0 1.5px rgba(168,156,240,0.7)' } : {};
                        return <td key={i} style={{ ...cellBase, padding: '5px 0', background: bg, color: min ? '#c2c9d8' : '#5a6072', ...todayStyle }}>{hrs(min)}</td>;
                      })}
                      <td style={{ ...cellBase, minWidth: 56, width: 56, fontWeight: 700, color: C.violet }}>{hrs(rowTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ position: 'sticky', bottom: 27 }}>
                  <td style={{ ...nameCol, fontSize: 11, color: C.muted, fontWeight: 700, paddingTop: 8, background: '#161620', borderTop: '1px solid rgba(255,255,255,0.12)' }}>Celkem (h)</td>
                  {g.dailyTotals.map((min, i) => {
                    const bg = dayTint(dayMeta[i]!);
                    return <td key={i} style={{ ...cellBase, background: bg ?? '#161620', paddingTop: 8, color: C.violet, fontWeight: 600, borderTop: '1px solid rgba(255,255,255,0.12)' }}>{hrs(min)}</td>;
                  })}
                  <td style={{ ...cellBase, minWidth: 56, width: 56, paddingTop: 8, color: C.violet, fontWeight: 700, background: '#161620', borderTop: '1px solid rgba(255,255,255,0.12)' }}>{formatHours(g.monthTotalMinutes)}</td>
                </tr>
                <tr style={{ position: 'sticky', bottom: 0 }}>
                  <td style={{ ...nameCol, fontSize: 11, color: C.muted, fontWeight: 700, background: '#161620' }}>Výdělek</td>
                  {g.dailyEarnings.map((czk, i) => {
                    const bg = dayTint(dayMeta[i]!);
                    return <td key={i} style={{ ...cellBase, background: bg ?? '#161620', color: czk ? '#c2c9d8' : '#5a6072', fontSize: 10 }}>{czk ? Math.round(czk) : ''}</td>;
                  })}
                  <td style={{ ...cellBase, minWidth: 56, width: 56, color: C.violet, fontWeight: 700, background: '#161620' }}>{formatCzk(g.monthTotalCzk)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
