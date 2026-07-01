import { useState } from 'react';
import { useBilling } from '@watchtower/data-supabase';
import { useWorklogMutations } from '@watchtower/data-supabase';
import { groupWorklogsByDay } from '@watchtower/shared/billing/records/worklog-list.js';
import { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';
import type { TaskRow, WorklogRow, ContractRow } from '@watchtower/shared/billing/types.js';
import { canEdit, computeDerivedForWrite, type WorklogWriteInput } from '@watchtower/data-supabase';
import { addMonths, czechMonthLabel } from '@watchtower/ui-core';
import { formatHours, formatDateCz, formatCzk } from '@watchtower/ui-core';
import { C } from '../reports/tokens.js';
import { glassPanel, glassCard, ctaGradient, ctaGlow, glassFillStrong } from '@watchtower/ui-core';

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

function WorklogDrawer({ title, tasks, contracts, initial, onClose, onSubmit, onDelete }: {
  title: string;
  tasks: TaskRow[];
  contracts: ContractRow[];
  initial?: WorklogRow;
  onClose(): void;
  onSubmit(task: TaskRow, input: WorklogWriteInput): Promise<void>;
  onDelete?(): Promise<void>;
}): JSX.Element {
  const isEdit = initial != null;
  const [taskId, setTaskId] = useState<number | null>(isEdit ? null : null); // edit keeps the existing task; create picks one
  const [taskQuery, setTaskQuery] = useState('');
  const [date, setDate] = useState(initial?.workDate ?? new Date().toISOString().slice(0, 10));
  const [minutesStr, setMinutesStr] = useState(initial ? String((initial.minutes / 60).toFixed(2)).replace('.', ',') : '');
  const [reportedStr, setReportedStr] = useState(initial?.reportedMinutes != null ? String((initial.reportedMinutes / 60).toFixed(2)).replace('.', ',') : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);

  const minutes = parseMinutes(minutesStr);
  const reported = reportedStr.trim() === '' ? null : parseMinutes(reportedStr);
  const minutesValid = Number.isFinite(minutes) && minutes > 0;
  const reportedValid = reported === null || (Number.isFinite(reported) && reported > 0);

  // Resolve which project/task the preview + write target.
  const pickedTask: TaskRow | null = isEdit
    ? (tasks.find((t) => t.taskId === taskId) ?? null) // null in edit → task unchanged; project comes from initial
    : (tasks.find((t) => t.taskId === taskId) ?? null);
  const projectId = isEdit ? initial!.projectId : pickedTask?.projectId;
  const canSubmit = minutesValid && reportedValid && (isEdit || pickedTask != null) && !saving;

  const previewBilling = projectId != null && minutesValid
    ? computeDerivedForWrite(contracts, projectId, { minutes, reportedMinutes: reported, workDate: date })
    : null;

  const filteredTasks = taskQuery.trim() === ''
    ? tasks.slice(0, 50)
    : tasks.filter((t) => `${t.taskNumber ?? ''} ${t.taskTitle} ${t.projectName}`.toLowerCase().includes(taskQuery.toLowerCase())).slice(0, 50);

  const field: React.CSSProperties = { background: 'rgba(255,255,255,0.07)', color: '#d7dbe6', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 11, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' };
  const label: React.CSSProperties = { fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.muted, marginBottom: 5 };

  async function submit() {
    // Edit: reuse the existing task (taskId unchanged); Create: require a picked task.
    const taskRow = isEdit
      ? ({ taskId: 0, taskNumber: initial!.taskNumber, taskTitle: initial!.taskTitle ?? '', projectId: initial!.projectId, projectName: initial!.projectName, projectColor: initial!.projectColor, projectKind: initial!.projectKind, isBillable: initial!.isBillable } as TaskRow)
      : pickedTask!;
    setSaving(true);
    await onSubmit(taskRow, { taskId: taskRow.taskId, workDate: date, minutes, reportedMinutes: reported, description: description.trim() === '' ? null : description.trim() });
    setSaving(false);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(6,7,11,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...glassPanel({ radius: 20, fill: glassFillStrong, blur: 40, saturate: 1.9, brightness: 1.1 }), borderBottomLeftRadius: 0, borderBottomRightRadius: 0, border: '1px solid rgba(255,255,255,0.20)', borderBottom: 'none', boxShadow: '0 -20px 60px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.30)', width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f4f4f8' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {!isEdit && (
          <div>
            <div style={label}>Úkol</div>
            <input style={field} placeholder="Hledat úkol…" value={taskQuery} onChange={(e) => setTaskQuery(e.target.value)} />
            <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredTasks.map((t) => (
                <button key={t.taskId} onClick={() => setTaskId(t.taskId)} style={{ ...glassCard(10), padding: '7px 11px', textAlign: 'left', cursor: 'pointer', border: taskId === t.taskId ? '2px solid #a89cf0' : '1px solid rgba(255,255,255,0.10)', display: 'flex', gap: 9, alignItems: 'center', fontFamily: 'inherit', color: C.text, width: '100%' }}>
                  {t.projectColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.projectColor, flexShrink: 0 }} />}
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.muted }}>{t.taskNumber ?? '—'}</span>
                  <span style={{ fontSize: 12, color: '#d7dbe6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.taskTitle}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {isEdit && (
          <div style={{ fontSize: 13, color: C.muted }}>
            {initial!.taskNumber ? `${initial!.taskNumber} · ` : ''}{initial!.taskTitle || initial!.projectName}
          </div>
        )}

        <div>
          <div style={label}>Datum</div>
          <input type="date" style={field} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Čas (např. 1,5 / 1:30 / 1h30m)</div>
            <input style={{ ...field, borderColor: minutesStr && !minutesValid ? C.red : 'rgba(255,255,255,0.10)' }} value={minutesStr} onChange={(e) => setMinutesStr(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Vykázáno (volitelné)</div>
            <input style={{ ...field, borderColor: reportedStr && !reportedValid ? C.red : 'rgba(255,255,255,0.10)' }} value={reportedStr} onChange={(e) => setReportedStr(e.target.value)} />
          </div>
        </div>
        <div>
          <div style={label}>Popis (volitelné)</div>
          <input style={field} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {previewBilling && (
          <div style={{ fontSize: 13, color: C.muted }}>
            Výdělek: <span style={{ color: '#f4f4f8', fontWeight: 600 }}>{previewBilling.earnedAmount != null ? formatCzk(previewBilling.earnedAmount) : '—'}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
          {onDelete && (
            <button onClick={async () => { setSaving(true); await onDelete(); }} disabled={saving} style={{ height: 36, padding: '0 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: '#fca5a5', background: 'rgba(110,24,24,0.32)', border: '1px solid rgba(248,113,113,0.40)', display: 'inline-flex', alignItems: 'center' }}>Smazat</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ height: 36, padding: '0 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: '#c2c9d8', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.10)', display: 'inline-flex', alignItems: 'center' }}>Zrušit</button>
          <button onClick={submit} disabled={!canSubmit} style={{ height: 38, padding: '0 16px', borderRadius: 11, border: 'none', background: canSubmit ? ctaGradient : 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: canSubmit ? 'pointer' : 'default', fontFamily: 'inherit', boxShadow: canSubmit ? ctaGlow : 'none', display: 'inline-flex', alignItems: 'center' }}>
            {saving ? 'Ukládám…' : 'Uložit'}
          </button>
        </div>
      </div>
    </div>
  );
}
