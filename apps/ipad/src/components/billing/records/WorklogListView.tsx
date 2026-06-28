import { useState } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { useWorklogMutations } from '../../../state/useWorklogMutations.js';
import { groupWorklogsByDay } from '@watchtower/shared/billing/records/worklog-list.js';
import { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';
import type { TaskRow, WorklogRow, ContractRow } from '@watchtower/shared/billing/types.js';
import { canEdit, computeDerivedForWrite, type WorklogWriteInput } from '../../../state/billingWrites.js';
import { addMonths, czechMonthLabel } from '../../../lib/monthHelpers.js';
import { formatHours, formatDateCz, formatCzk } from '../../../lib/czFormat.js';
import { C } from '../reports/tokens.js';

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
    <div style={{ fontFamily: 'system-ui, sans-serif', background: C.ground, minHeight: '100%', color: C.text }}>
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
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{formatDateCz(d.date)}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{formatHours(d.totalMinutes)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {d.entries.map((w) => (
                <button
                  key={w.syncId}
                  onClick={() => editable && setDrawer({ mode: 'edit', worklog: w })}
                  disabled={!editable}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', textAlign: 'left', cursor: editable ? 'pointer' : 'default', fontFamily: 'inherit', color: C.text, width: '100%' }}
                >
                  {w.projectColor && <div style={{ width: 8, height: 8, borderRadius: '50%', background: w.projectColor, flexShrink: 0 }} />}
                  {w.taskNumber && <div style={{ fontFamily: 'monospace', fontSize: 12, color: C.muted, flexShrink: 0 }}>{w.taskNumber}</div>}
                  <div style={{ flex: 1, fontSize: 13, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.taskTitle || w.projectName}</div>
                  {w.source && <div style={{ fontSize: 10, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase', flexShrink: 0 }}>{SOURCE_LABEL[w.source] ?? w.source}</div>}
                  <div style={{ fontSize: 12, color: C.text, flexShrink: 0 }}>
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
      {canAdd && <button style={{ ...btn, background: C.violet, color: '#fff', border: 'none' }} onClick={onAdd}>+ Přidat</button>}
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

  const field: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
  const label: React.CSSProperties = { fontSize: 12, color: C.muted, marginBottom: 4 };

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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.ground, borderTopLeftRadius: 16, borderTopRightRadius: 16, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {!isEdit && (
          <div>
            <div style={label}>Úkol</div>
            <input style={field} placeholder="Hledat úkol…" value={taskQuery} onChange={(e) => setTaskQuery(e.target.value)} />
            <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredTasks.map((t) => (
                <button key={t.taskId} onClick={() => setTaskId(t.taskId)} style={{ ...field, textAlign: 'left', cursor: 'pointer', border: taskId === t.taskId ? `2px solid ${C.violet}` : `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {t.projectColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.projectColor, flexShrink: 0 }} />}
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.muted }}>{t.taskNumber ?? '—'}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.taskTitle}</span>
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
            <input style={{ ...field, borderColor: minutesStr && !minutesValid ? C.red : C.border }} value={minutesStr} onChange={(e) => setMinutesStr(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Vykázáno (volitelné)</div>
            <input style={{ ...field, borderColor: reportedStr && !reportedValid ? C.red : C.border }} value={reportedStr} onChange={(e) => setReportedStr(e.target.value)} />
          </div>
        </div>
        <div>
          <div style={label}>Popis (volitelné)</div>
          <input style={field} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {previewBilling && (
          <div style={{ fontSize: 13, color: C.muted }}>
            Výdělek: <span style={{ color: C.text, fontWeight: 600 }}>{previewBilling.earnedAmount != null ? formatCzk(previewBilling.earnedAmount) : '—'}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {onDelete && (
            <button onClick={async () => { setSaving(true); await onDelete(); }} disabled={saving} style={{ ...field, width: 'auto', color: C.red, cursor: 'pointer' }}>Smazat</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...field, width: 'auto', cursor: 'pointer' }}>Zrušit</button>
          <button onClick={submit} disabled={!canSubmit} style={{ ...field, width: 'auto', background: canSubmit ? C.violet : C.border, color: '#fff', border: 'none', cursor: canSubmit ? 'pointer' : 'default' }}>
            {saving ? 'Ukládám…' : 'Uložit'}
          </button>
        </div>
      </div>
    </div>
  );
}
