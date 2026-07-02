import { useState } from 'react';
import { useBilling } from '@watchtower/data-supabase';
import { useWorklogMutations } from '@watchtower/data-supabase';
import { groupWorklogsByDay } from '@watchtower/shared/billing/records/worklog-list.js';
import type { WorklogRow } from '@watchtower/shared/billing/types.js';
import { canEdit } from '@watchtower/data-supabase';
import { addMonths, czechMonthLabel } from '@watchtower/ui-core';
import { formatHours, formatDateCz } from '@watchtower/ui-core';
import { C } from '../reports/tokens.js';
import { glassPanel, glassCard, ctaGradient, ctaGlow } from '@watchtower/ui-core';
import { WorklogDrawer } from './WorklogDrawer.js';

const SOURCE_LABEL: Record<string, string> = { manual: 'manual', 'watchtower-auto': 'watchtower', 'jira-sync': 'jira' };

type DrawerState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; worklog: WorklogRow };

export function WorklogListView(): JSX.Element {
  const { data, state, patchWorklogs } = useBilling();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const [drawer, setDrawer] = useState<DrawerState>({ mode: 'closed' });

  const worklogs = data?.worklogs ?? [];
  const projects = data?.projects ?? [];
  const tasks = data?.tasks ?? [];
  const contracts = data?.contracts ?? [];
  const editable = canEdit(state);

  const { createWorklog, updateWorklog, deleteWorklog, error } = useWorklogMutations({ worklogs, contracts, patchWorklogs });

  const days = groupWorklogsByDay(worklogs, { month, projectId });

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: 'transparent', minHeight: '100%', color: C.text }}>
      <MonthBar
        month={month}
        onPrev={() => setMonth(addMonths(month, -1))}
        onNext={() => setMonth(addMonths(month, 1))}
        onToday={() => setMonth(new Date().toISOString().slice(0, 7))}
        projects={projects}
        projectId={projectId}
        onProject={setProjectId}
        canAdd={editable}
        onAdd={() => setDrawer({ mode: 'create' })}
      />
      {!editable && (
        <div style={{ padding: '6px 16px', fontSize: 12, color: C.muted }}>jen pro čtení offline</div>
      )}
      {error && (
        <div style={{ padding: '6px 16px', fontSize: 12, color: C.red }}>{error}</div>
      )}
      <div style={{ padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {days.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>žádné záznamy</div>}
        {days.map((d) => (
          <div key={d.date}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f8' }}>{formatDateCz(d.date)}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{formatHours(d.totalMinutes)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {d.entries.map((w) => (
                <button
                  key={w.syncId}
                  onClick={() => editable && setDrawer({ mode: 'edit', worklog: w })}
                  disabled={!editable}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, ...glassCard(10), border: '1px solid rgba(255,255,255,0.10)', padding: '8px 12px', textAlign: 'left', cursor: editable ? 'pointer' : 'default', fontFamily: 'inherit', color: C.text, width: '100%' }}
                >
                  {w.projectColor && <div style={{ width: 9, height: 9, borderRadius: '50%', background: w.projectColor, flexShrink: 0 }} />}
                  {w.taskNumber && <div style={{ fontFamily: 'monospace', fontSize: 11, color: C.muted, flexShrink: 0 }}>{w.taskNumber}</div>}
                  <div style={{ flex: 1, fontSize: 12.5, color: '#d7dbe6', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.taskTitle || w.projectName}</div>
                  {w.source && <div style={{ fontSize: 9.5, color: C.muted, border: '1px solid rgba(255,255,255,0.10)', borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase', flexShrink: 0, background: 'rgba(255,255,255,0.04)', letterSpacing: '0.05em' }}>{SOURCE_LABEL[w.source] ?? w.source}</div>}
                  <div style={{ fontSize: 12.5, color: '#f4f4f8', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {formatHours(w.minutes)}
                    {w.effectiveMinutes !== w.minutes && <span style={{ color: C.muted }}> → {formatHours(w.effectiveMinutes)}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {drawer.mode === 'create' && (
        <WorklogDrawer
          title="Nový záznam"
          tasks={tasks}
          contracts={contracts}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (taskRow, input) => { await createWorklog(taskRow, input); setDrawer({ mode: 'closed' }); }}
        />
      )}
      {drawer.mode === 'edit' && (
        <WorklogDrawer
          title="Upravit záznam"
          tasks={tasks}
          contracts={contracts}
          initial={drawer.worklog}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (_taskRow, input) => { await updateWorklog(drawer.worklog.syncId, input); setDrawer({ mode: 'closed' }); }}
          onDelete={async () => { await deleteWorklog(drawer.worklog.syncId); setDrawer({ mode: 'closed' }); }}
        />
      )}
    </div>
  );
}

function MonthBar({ month, onPrev, onNext, onToday, projects, projectId, onProject, canAdd, onAdd }: {
  month: string; onPrev(): void; onNext(): void; onToday(): void;
  projects: { id: number; name: string }[]; projectId: number | undefined; onProject(id: number | undefined): void;
  canAdd: boolean; onAdd(): void;
}): JSX.Element {
  const stepBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#c9bdff', fontSize: 18, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
  const flatBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#c2c9d8', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 10, padding: '10px 16px 12px', display: 'flex', flexDirection: 'column', gap: 10, ...glassPanel({ radius: 13, blur: 28, saturate: 1.7 }), borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
      {/* Row 1: month stepper (‹ label ›) + Dnes */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button style={stepBtn} onClick={onPrev} aria-label="Předchozí měsíc">‹</button>
        <div style={{ minWidth: 128, textAlign: 'center', fontSize: 15, fontWeight: 700, color: '#f4f4f8' }}>{czechMonthLabel(month)}</div>
        <button style={stepBtn} onClick={onNext} aria-label="Další měsíc">›</button>
        <div style={{ flex: 1 }} />
        <button style={flatBtn} onClick={onToday}>Dnes</button>
      </div>
      {/* Row 2: project filter (grows) + add */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <select
          value={projectId ?? ''}
          onChange={(e) => onProject(e.target.value === '' ? undefined : Number(e.target.value))}
          style={{ flex: 1, minWidth: 0, height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#c2c9d8', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
        >
          <option value="">Všechny projekty</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name || '(bez názvu)'}</option>)}
        </select>
        {canAdd && <button style={{ height: 36, padding: '0 16px', borderRadius: 9, border: 'none', background: ctaGradient, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: ctaGlow, display: 'inline-flex', alignItems: 'center', flexShrink: 0 }} onClick={onAdd}>+ Přidat</button>}
      </div>
    </div>
  );
}

