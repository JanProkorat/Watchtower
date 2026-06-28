import { useState } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { groupWorklogsByDay } from '@watchtower/shared/billing/records/worklog-list.js';
import { addMonths, czechMonthLabel } from '../../../lib/monthHelpers.js';
import { formatHours, formatDateCz } from '../../../lib/czFormat.js';
import { C } from '../reports/tokens.js';

const SOURCE_LABEL: Record<string, string> = { manual: 'manual', 'watchtower-auto': 'watchtower', 'jira-sync': 'jira' };

export function WorklogListView(): JSX.Element {
  const { data } = useBilling();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];
  const [projectId, setProjectId] = useState<number | undefined>(undefined);

  const days = groupWorklogsByDay(worklogs, { month, projectId });

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: C.ground, minHeight: '100%', color: C.text }}>
      <MonthBar month={month} onPrev={() => setMonth(addMonths(month, -1))} onNext={() => setMonth(addMonths(month, 1))} onToday={() => setMonth(new Date().toISOString().slice(0, 7))} projects={projects} projectId={projectId} onProject={setProjectId} />
      <div style={{ padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {days.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>žádné záznamy</div>}
        {days.map((d) => (
          <div key={d.date}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{formatDateCz(d.date)}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{formatHours(d.totalMinutes)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {d.entries.map((w) => (
                <div key={w.syncId} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px' }}>
                  {w.projectColor && <div style={{ width: 8, height: 8, borderRadius: '50%', background: w.projectColor, flexShrink: 0 }} />}
                  {w.taskNumber && <div style={{ fontFamily: 'monospace', fontSize: 12, color: C.muted, flexShrink: 0 }}>{w.taskNumber}</div>}
                  <div style={{ flex: 1, fontSize: 13, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.taskTitle || w.projectName}</div>
                  {w.source && <div style={{ fontSize: 10, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase', flexShrink: 0 }}>{SOURCE_LABEL[w.source] ?? w.source}</div>}
                  <div style={{ fontSize: 12, color: C.text, flexShrink: 0 }}>
                    {formatHours(w.minutes)}
                    {w.effectiveMinutes !== w.minutes && <span style={{ color: C.muted }}> → {formatHours(w.effectiveMinutes)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthBar({ month, onPrev, onNext, onToday, projects, projectId, onProject }: {
  month: string; onPrev(): void; onNext(): void; onToday(): void;
  projects: { id: number; name: string }[]; projectId: number | undefined; onProject(id: number | undefined): void;
}): JSX.Element {
  const btn: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '4px 10px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.ground, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button style={btn} onClick={onPrev}>‹</button>
      <div style={{ fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{czechMonthLabel(month)}</div>
      <button style={btn} onClick={onNext}>›</button>
      <button style={btn} onClick={onToday}>Dnes</button>
      <div style={{ flex: 1 }} />
      <select value={projectId ?? ''} onChange={(e) => onProject(e.target.value === '' ? undefined : Number(e.target.value))} style={{ ...btn }}>
        <option value="">Všechny projekty</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name || '(bez názvu)'}</option>)}
      </select>
    </div>
  );
}
