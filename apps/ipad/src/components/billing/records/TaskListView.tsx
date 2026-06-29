import { useState, useMemo } from 'react';
import { useBilling } from '../../../state/useBilling.js';
import { useTaskMutations } from '../../../state/useTaskMutations.js';
import { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';
import type { TaskRow, EpicRow, ProjectRow } from '@watchtower/shared/billing/types.js';
import { canEdit, canEditTask, type TaskWriteInput } from '../../../state/billingWrites.js';
import { C } from '../reports/tokens.js';

const STATUS_LABEL: Record<string, string> = {
  open: 'Otevřený', in_progress: 'Probíhá', to_accept: 'K akceptaci', done: 'Hotovo',
};
const STATUS_OPTIONS = ['open', 'in_progress', 'to_accept', 'done'];

type DrawerState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; task: TaskRow };

export function TaskListView(): JSX.Element {
  const { data, state, patchTasks } = useBilling();
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<DrawerState>({ mode: 'closed' });

  const tasks = data?.tasks ?? [];
  const epics = data?.epics ?? [];
  const projects = data?.projects ?? [];
  const editable = canEdit(state);

  const { createTask, updateTask, deleteTask, error } = useTaskMutations({ tasks, epics, projects, patchTasks });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q === ''
      ? tasks
      : tasks.filter((t) => `${t.taskNumber ?? ''} ${t.taskTitle} ${t.projectName}`.toLowerCase().includes(q));
    return [...rows].sort((a, b) => a.projectName.localeCompare(b.projectName) || a.taskTitle.localeCompare(b.taskTitle));
  }, [tasks, query]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: C.ground, minHeight: '100%', color: C.text }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.ground, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="Hledat úkol…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 140, background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit' }} />
        {editable && <button onClick={() => setDrawer({ mode: 'create' })} style={{ background: C.violet, color: '#fff', border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>+ Přidat úkol</button>}
      </div>
      {!editable && <div style={{ padding: '6px 16px', fontSize: 12, color: C.muted }}>jen pro čtení offline</div>}
      {error && <div style={{ padding: '6px 16px', fontSize: 12, color: C.red }}>{error}</div>}

      <div style={{ padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>žádné úkoly</div>}
        {filtered.map((t) => (
          <button
            key={t.syncId}
            onClick={() => editable && setDrawer({ mode: 'edit', task: t })}
            disabled={!editable}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', textAlign: 'left', cursor: editable ? 'pointer' : 'default', fontFamily: 'inherit', color: C.text, width: '100%' }}
          >
            {t.projectColor && <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.projectColor, flexShrink: 0 }} />}
            {t.taskNumber && <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.muted, flexShrink: 0 }}>{t.taskNumber}</span>}
            <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.taskTitle || '(bez názvu)'}</span>
            <span style={{ fontSize: 10, color: t.status === 'done' ? C.muted : C.violet, border: `1px solid ${C.border}`, borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>{STATUS_LABEL[t.status] ?? t.status}</span>
          </button>
        ))}
      </div>

      {drawer.mode === 'create' && (
        <TaskDrawer
          title="Nový úkol"
          epics={epics}
          projects={projects}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (input) => { await createTask(input); setDrawer({ mode: 'closed' }); }}
        />
      )}
      {drawer.mode === 'edit' && (
        <TaskDrawer
          title="Upravit úkol"
          epics={epics}
          projects={projects}
          initial={drawer.task}
          readOnly={!canEditTask(drawer.task.status)}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (input) => { await updateTask(drawer.task.syncId, input); setDrawer({ mode: 'closed' }); }}
          onDelete={async () => { await deleteTask(drawer.task.syncId); setDrawer({ mode: 'closed' }); }}
        />
      )}
    </div>
  );
}

function TaskDrawer({ title, epics, projects, initial, readOnly, onClose, onSubmit, onDelete }: {
  title: string;
  epics: EpicRow[];
  projects: ProjectRow[];
  initial?: TaskRow;
  readOnly?: boolean;
  onClose(): void;
  onSubmit(input: TaskWriteInput): Promise<void>;
  onDelete?(): Promise<void>;
}): JSX.Element {
  const [epicId, setEpicId] = useState<number | null>(initial ? initial.epicId : null);
  const [number, setNumber] = useState(initial?.taskNumber ?? '');
  const [title2, setTitle2] = useState(initial?.taskTitle ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'open');
  const [estimateStr, setEstimateStr] = useState(initial?.estimatedMinutes != null ? String((initial.estimatedMinutes / 60).toFixed(2)).replace('.', ',') : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);

  const estimate = estimateStr.trim() === '' ? null : parseMinutes(estimateStr);
  const estimateValid = estimate === null || (Number.isFinite(estimate) && estimate > 0);
  const canSubmit = !readOnly && epicId != null && number.trim() !== '' && title2.trim() !== '' && estimateValid && !saving;

  const field: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
  const label: React.CSSProperties = { fontSize: 12, color: C.muted, marginBottom: 4 };

  // Epics grouped by project for the picker.
  const grouped = projects
    .map((p) => ({ project: p, epics: epics.filter((e) => e.projectId === p.id) }))
    .filter((g) => g.epics.length > 0);

  async function submit() {
    if (epicId == null) return;
    setSaving(true);
    await onSubmit({
      epicId,
      number: number.trim(),
      title: title2.trim(),
      status,
      estimatedMinutes: estimate,
      description: description.trim() === '' ? null : description.trim(),
    });
    setSaving(false);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.ground, borderTopLeftRadius: 16, borderTopRightRadius: 16, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {readOnly && <div style={{ fontSize: 12, color: C.muted }}>Úkol je uzavřen (Hotovo) — jen pro čtení.</div>}

        <div>
          <div style={label}>Epik</div>
          <select disabled={readOnly} value={epicId ?? ''} onChange={(e) => setEpicId(e.target.value === '' ? null : Number(e.target.value))} style={field}>
            <option value="">— vyber epik —</option>
            {grouped.map((g) => (
              <optgroup key={g.project.id} label={g.project.name || '(projekt)'}>
                {g.epics.map((ep) => <option key={ep.epicId} value={ep.epicId}>{ep.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Číslo</div>
            <input disabled={readOnly} style={field} value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Stav</div>
            <select disabled={readOnly} value={status} onChange={(e) => setStatus(e.target.value)} style={field}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div style={label}>Název</div>
          <input disabled={readOnly} style={field} value={title2} onChange={(e) => setTitle2(e.target.value)} />
        </div>
        <div>
          <div style={label}>Odhad (h, volitelné — např. 1,5)</div>
          <input disabled={readOnly} style={{ ...field, borderColor: estimateStr && !estimateValid ? C.red : C.border }} value={estimateStr} onChange={(e) => setEstimateStr(e.target.value)} />
        </div>
        <div>
          <div style={label}>Popis (volitelné)</div>
          <input disabled={readOnly} style={field} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {onDelete && !readOnly && (
            <button onClick={async () => { setSaving(true); await onDelete(); }} disabled={saving} style={{ ...field, width: 'auto', color: C.red, cursor: 'pointer' }}>Smazat</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...field, width: 'auto', cursor: 'pointer' }}>Zrušit</button>
          {!readOnly && (
            <button onClick={submit} disabled={!canSubmit} style={{ ...field, width: 'auto', background: canSubmit ? C.violet : C.border, color: '#fff', border: 'none', cursor: canSubmit ? 'pointer' : 'default' }}>
              {saving ? 'Ukládám…' : 'Uložit'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
