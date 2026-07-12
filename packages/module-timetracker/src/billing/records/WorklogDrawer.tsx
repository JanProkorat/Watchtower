import { useState } from 'react';
import type { TaskRow, WorklogRow, ContractRow } from '@watchtower/shared/billing/types.js';
import { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';
import { computeDerivedForWrite, type WorklogWriteInput } from '@watchtower/data-supabase';
import { formatCzk } from '@watchtower/ui-core';
import { BottomSheet, glassCard, ctaGradient, ctaGlow, type SheetAnchor } from '@watchtower/ui-core';
import { C } from '../reports/tokens.js';

export function WorklogDrawer({ title, tasks, contracts, initial, lockedTask, initialDate, anchor, onClose, onSubmit, onDelete }: {
  title: string;
  tasks: TaskRow[];
  contracts: ContractRow[];
  initial?: WorklogRow;
  lockedTask?: TaskRow;
  initialDate?: string;
  anchor?: SheetAnchor | null;
  onClose(): void;
  onSubmit(task: TaskRow, input: WorklogWriteInput): Promise<void>;
  onDelete?(): Promise<void>;
}): JSX.Element {
  const isEdit = initial != null;
  const isLocked = !isEdit && lockedTask != null;
  const showPicker = !isEdit && !isLocked;
  const [taskId, setTaskId] = useState<number | null>(isLocked ? lockedTask!.taskId : null);
  const [taskQuery, setTaskQuery] = useState('');
  const [date, setDate] = useState(initial?.workDate ?? initialDate ?? new Date().toISOString().slice(0, 10));
  const [minutesStr, setMinutesStr] = useState(initial ? String((initial.minutes / 60).toFixed(2)).replace('.', ',') : '');
  const [reportedStr, setReportedStr] = useState(initial?.reportedMinutes != null ? String((initial.reportedMinutes / 60).toFixed(2)).replace('.', ',') : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);

  const minutes = parseMinutes(minutesStr);
  const reported = reportedStr.trim() === '' ? null : parseMinutes(reportedStr);
  const minutesValid = Number.isFinite(minutes) && minutes > 0;
  const reportedValid = reported === null || (Number.isFinite(reported) && reported > 0);

  const pickedTask: TaskRow | null = isLocked
    ? lockedTask!
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

  const fixedTask = isEdit ? initial! : lockedTask;

  async function submit() {
    const taskRow = isEdit
      ? ({ taskId: 0, taskNumber: initial!.taskNumber, taskTitle: initial!.taskTitle ?? '', projectId: initial!.projectId, projectName: initial!.projectName, projectColor: initial!.projectColor, projectKind: initial!.projectKind, isBillable: initial!.isBillable } as TaskRow)
      : pickedTask!;
    setSaving(true);
    await onSubmit(taskRow, { taskId: taskRow.taskId, workDate: date, minutes, reportedMinutes: reported, description: description.trim() === '' ? null : description.trim() });
    setSaving(false);
  }

  return (
    <BottomSheet onClose={onClose} anchor={anchor}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f4f4f8' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {showPicker && (
          <div>
            <div style={label}>Úkol</div>
            <input style={field} placeholder="Hledat úkol…" value={taskQuery} onChange={(e) => setTaskQuery(e.target.value)} />
            <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredTasks.map((t) => (
                <button key={t.taskId} onClick={() => setTaskId(t.taskId)} style={{ ...glassCard(10), padding: '7px 11px', textAlign: 'left', cursor: 'pointer', border: taskId === t.taskId ? '2px solid #7dd3fc' : '1px solid rgba(255,255,255,0.10)', display: 'flex', gap: 9, alignItems: 'center', fontFamily: 'inherit', color: C.text, width: '100%' }}>
                  {t.projectColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.projectColor, flexShrink: 0 }} />}
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.muted }}>{t.taskNumber ?? '—'}</span>
                  <span style={{ fontSize: 12, color: '#d7dbe6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.taskTitle}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {fixedTask && (
          <div style={{ fontSize: 13, color: C.muted }}>
            {fixedTask.taskNumber ? `${fixedTask.taskNumber} · ` : ''}{fixedTask.taskTitle || fixedTask.projectName}
          </div>
        )}

        <div>
          <div style={label}>Datum</div>
          <input type="date" style={field} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
    </BottomSheet>
  );
}
