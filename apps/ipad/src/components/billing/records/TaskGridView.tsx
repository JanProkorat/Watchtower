import { useState } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { buildTaskGrid } from '@watchtower/shared/billing/records/task-grid.js';
import { addMonths, czechMonthLabel } from '../../../lib/monthHelpers.js';
import { formatHours, formatCzk } from '../../../lib/czFormat.js';
import { C } from '../reports/tokens.js';

const CELL = 34; // px per day column

export function TaskGridView(): JSX.Element {
  const { data } = useBilling();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];

  const g = buildTaskGrid(worklogs, { month, projectId });
  const dayHeaders = Array.from({ length: g.daysInMonth }, (_, i) => i + 1);
  const hrs = (min: number) => (min === 0 ? '' : (min / 60).toFixed(1).replace('.', ','));

  const btn: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '4px 10px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
  const cellBase: React.CSSProperties = { width: CELL, minWidth: CELL, textAlign: 'center', fontSize: 11, borderLeft: `1px solid ${C.border}` };
  const nameCol: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: C.ground, minWidth: 180, maxWidth: 180, paddingRight: 8 };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: C.ground, minHeight: '100%', color: C.text, display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 11, background: C.ground, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button style={btn} onClick={() => setMonth(addMonths(month, -1))}>‹</button>
        <div style={{ fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{czechMonthLabel(month)}</div>
        <button style={btn} onClick={() => setMonth(addMonths(month, 1))}>›</button>
        <button style={btn} onClick={() => setMonth(new Date().toISOString().slice(0, 7))}>Dnes</button>
        <div style={{ flex: 1 }} />
        <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value === '' ? undefined : Number(e.target.value))} style={btn}>
          <option value="">Všechny projekty</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name || '(bez názvu)'}</option>)}
        </select>
      </div>

      {g.tasks.length === 0 ? (
        <div style={{ padding: 24, color: C.muted, fontSize: 14 }}>žádné záznamy pro tento měsíc</div>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, color: C.text }}>
            <thead>
              <tr>
                <th style={{ ...nameCol, textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600 }}>Úkol</th>
                {dayHeaders.map((d) => <th key={d} style={{ ...cellBase, color: C.muted, fontWeight: 600, padding: '6px 0' }}>{d}</th>)}
                <th style={{ ...cellBase, minWidth: 56, width: 56, color: C.muted, fontWeight: 600 }}>Σ</th>
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
                        <span style={{ fontFamily: 'monospace', color: C.muted, flexShrink: 0 }}>{t.taskNumber ?? '(bez úkolu)'}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}>{t.taskTitle ?? ''}</span>
                      </div>
                    </td>
                    {t.perDay.map((min, i) => <td key={i} style={{ ...cellBase, padding: '5px 0', color: min ? C.text : C.border }}>{hrs(min)}</td>)}
                    <td style={{ ...cellBase, minWidth: 56, width: 56, fontWeight: 700 }}>{hrs(rowTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ position: 'sticky', bottom: 22 }}>
                <td style={{ ...nameCol, fontSize: 11, color: C.muted, fontWeight: 700, paddingTop: 8 }}>Celkem (h)</td>
                {g.dailyTotals.map((min, i) => <td key={i} style={{ ...cellBase, paddingTop: 8, color: C.violet, fontWeight: 600 }}>{hrs(min)}</td>)}
                <td style={{ ...cellBase, minWidth: 56, width: 56, paddingTop: 8, color: C.violet, fontWeight: 700 }}>{formatHours(g.monthTotalMinutes)}</td>
              </tr>
              <tr style={{ position: 'sticky', bottom: 0, background: C.ground }}>
                <td style={{ ...nameCol, fontSize: 11, color: C.muted, fontWeight: 700 }}>Výdělek</td>
                {g.dailyEarnings.map((czk, i) => <td key={i} style={{ ...cellBase, color: czk ? C.text : C.border }}>{czk ? Math.round(czk) : ''}</td>)}
                <td style={{ ...cellBase, minWidth: 56, width: 56, color: C.violet, fontWeight: 700 }}>{formatCzk(g.monthTotalCzk)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
