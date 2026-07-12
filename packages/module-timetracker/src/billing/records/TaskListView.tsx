import { useState, useMemo } from 'react';
import { useBilling } from '@watchtower/data-supabase';
import { useTaskMutations } from '@watchtower/data-supabase';
import { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';
import type { TaskRow, EpicRow, ProjectRow } from '@watchtower/shared/billing/types.js';
import { canEdit, canEditTask, type TaskWriteInput } from '@watchtower/data-supabase';
import { C } from '../reports/tokens.js';
import { BottomSheet, glassCard, ctaGradient, ctaGlow, anchorFromEvent, type SheetAnchor } from '@watchtower/ui-core';

const STATUS_LABEL: Record<string, string> = {
  open: 'Otevřený', in_progress: 'Probíhá', to_accept: 'K akceptaci', done: 'Hotovo',
};
const STATUS_OPTIONS = ['open', 'in_progress', 'to_accept', 'done'];

// Status chip styles — preserves the status→color/label mapping (open/done muted, in_progress/to_accept violet).
function statusChipStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 999, flexShrink: 0 };
  if (status === 'in_progress') return { ...base, color: C.violet, background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.40)' };
  if (status === 'to_accept') return { ...base, color: C.violet, background: 'rgba(56,189,248,0.28)', border: '1px solid rgba(56,189,248,0.55)' };
  return { ...base, color: C.muted, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' };
}

type DrawerState = { mode: 'closed' } | { mode: 'create'; anchor: SheetAnchor | null } | { mode: 'edit'; task: TaskRow; anchor: SheetAnchor | null };

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
    <div style={{ fontFamily: 'system-ui, sans-serif', background: 'transparent', minHeight: '100%', color: C.text }}>
      <div style={{ position: 'sticky', top: 12, zIndex: 10, margin: '12px 16px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...glassCard(16) }}>
        <input placeholder="Hledat úkol…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 140, background: 'rgba(255,255,255,0.07)', color: '#d7dbe6', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 11, padding: '0 12px', height: 34, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
        {editable && <button onClick={(e) => setDrawer({ mode: 'create', anchor: anchorFromEvent(e) })} style={{ height: 34, padding: '0 16px', borderRadius: 11, border: 'none', background: ctaGradient, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: ctaGlow }}>+ Přidat úkol</button>}
      </div>
      {!editable && <div style={{ padding: '6px 16px', fontSize: 12, color: C.muted }}>jen pro čtení offline</div>}
      {error && <div style={{ padding: '6px 16px', fontSize: 12, color: C.red }}>{error}</div>}

      <div style={{ padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>žádné úkoly</div>}
        {filtered.map((t) => (
          <button
            key={t.syncId}
            onClick={(e) => editable && setDrawer({ mode: 'edit', task: t, anchor: anchorFromEvent(e) })}
            disabled={!editable}
            style={{ display: 'flex', alignItems: 'center', gap: 10, ...glassCard(10), border: '1px solid rgba(255,255,255,0.10)', padding: '8px 12px', textAlign: 'left', cursor: editable ? 'pointer' : 'default', fontFamily: 'inherit', color: C.text, width: '100%' }}
          >
            {t.projectColor && <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.projectColor, flexShrink: 0 }} />}
            {t.taskNumber && <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.muted, flexShrink: 0 }}>{t.taskNumber}</span>}
            <span style={{ flex: 1, fontSize: 12.5, color: '#d7dbe6', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.taskTitle || '(bez názvu)'}</span>
            <span style={statusChipStyle(t.status)}>{STATUS_LABEL[t.status] ?? t.status}</span>
          </button>
        ))}
      </div>

      {drawer.mode === 'create' && (
        <TaskDrawer
          title="Nový úkol"
          epics={epics}
          projects={projects}
          anchor={drawer.anchor}
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
          anchor={drawer.anchor}
          onClose={() => setDrawer({ mode: 'closed' })}
          onSubmit={async (input) => { await updateTask(drawer.task.syncId, input); setDrawer({ mode: 'closed' }); }}
          onDelete={async () => { await deleteTask(drawer.task.syncId); setDrawer({ mode: 'closed' }); }}
        />
      )}
    </div>
  );
}

function TaskDrawer({ title, epics, projects, initial, readOnly, anchor, onClose, onSubmit, onDelete }: {
  title: string;
  epics: EpicRow[];
  projects: ProjectRow[];
  initial?: TaskRow;
  readOnly?: boolean;
  anchor?: SheetAnchor | null;
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

  const field: React.CSSProperties = { background: 'rgba(255,255,255,0.07)', color: '#d7dbe6', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 11, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' };
  const label: React.CSSProperties = { fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.muted, marginBottom: 5 };

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
    <BottomSheet onClose={onClose} anchor={anchor}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f4f4f8' }}>{title}</div>
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
          <input disabled={readOnly} style={{ ...field, borderColor: estimateStr && !estimateValid ? C.red : 'rgba(255,255,255,0.10)' }} value={estimateStr} onChange={(e) => setEstimateStr(e.target.value)} />
        </div>
        <div>
          <div style={label}>Popis (volitelné)</div>
          <input disabled={readOnly} style={field} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
          {onDelete && !readOnly && (
            <button onClick={async () => { setSaving(true); await onDelete(); }} disabled={saving} style={{ height: 36, padding: '0 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: '#fca5a5', background: 'rgba(110,24,24,0.32)', border: '1px solid rgba(248,113,113,0.40)', display: 'inline-flex', alignItems: 'center' }}>Smazat</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ height: 36, padding: '0 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: '#c2c9d8', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.10)', display: 'inline-flex', alignItems: 'center' }}>Zrušit</button>
          {!readOnly && (
            <button onClick={submit} disabled={!canSubmit} style={{ height: 38, padding: '0 16px', borderRadius: 11, border: 'none', background: canSubmit ? ctaGradient : 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: canSubmit ? 'pointer' : 'default', fontFamily: 'inherit', boxShadow: canSubmit ? ctaGlow : 'none', display: 'inline-flex', alignItems: 'center' }}>
              {saving ? 'Ukládám…' : 'Uložit'}
            </button>
          )}
        </div>
    </BottomSheet>
  );
}
