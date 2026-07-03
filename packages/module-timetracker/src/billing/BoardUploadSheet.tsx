import { useState, type CSSProperties } from 'react';
import type { JiraSyncRequestPayload, JiraSyncResultPayload, JiraSyncEntryPayload } from '@watchtower/shared/ipcContract.js';
import { glassPanel, glassFillStrong, ctaGradient, ctaGlow } from '@watchtower/ui-core';
import { C } from './reports/tokens.js';
import type { BoardActions } from './BoardView.js';

// iPad-only bottom sheet: Jira worklog upload with a dryRun preview step
// before the real POST. Reuses the fixed-backdrop + bottom-pinned glass panel
// markup from records/WorklogListView.tsx's WorklogDrawer so it matches the
// rest of the module's sheet chrome.

type Phase = 'idle' | 'previewing' | 'preview' | 'uploading' | 'done';

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-based
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = `${y}-${pad(m)}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${pad(m)}-${pad(lastDay)}`;
  return { from, to };
}

const STATUS_COLOR: Record<JiraSyncEntryPayload['status'], string> = {
  posted: C.cyan,
  failed: C.red,
  skipped: C.muted,
  pending: C.amber,
};
const STATUS_LABEL: Record<JiraSyncEntryPayload['status'], string> = {
  posted: 'nahráno',
  failed: 'chyba',
  skipped: 'přeskočeno',
  pending: 'čeká',
};

const field: CSSProperties = { background: 'rgba(255,255,255,0.07)', color: '#d7dbe6', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 11, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' };
const label: CSSProperties = { fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.muted, marginBottom: 5 };

export function BoardUploadSheet({ actions, projectId, onClose, onUploaded }: {
  actions: BoardActions;
  /** Board's current project filter — carried through to the request when set. */
  projectId?: number;
  onClose(): void;
  /** Called after a successful upload so the caller can re-pull board data. */
  onUploaded(): Promise<void>;
}): JSX.Element {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [onlyUnposted, setOnlyUnposted] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<JiraSyncResultPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === 'previewing' || phase === 'uploading';
  const req: JiraSyncRequestPayload = { from, to, onlyUnposted, ...(projectId != null ? { projectId } : {}) };

  async function preview() {
    setPhase('previewing');
    setError(null);
    try {
      const r = await actions.preview(req);
      setResult(r);
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }

  async function upload() {
    setPhase('uploading');
    setError(null);
    try {
      const r = await actions.upload(req);
      setResult(r);
      await onUploaded();
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('preview');
    }
  }

  const nonSkipped = result ? result.entries.filter((e) => e.status !== 'skipped').length : 0;
  const canUpload = phase === 'preview' && nonSkipped > 0;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(6,7,11,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...glassPanel({ radius: 20, fill: glassFillStrong, blur: 40, saturate: 1.9, brightness: 1.1 }), borderBottomLeftRadius: 0, borderBottomRightRadius: 0, border: '1px solid rgba(255,255,255,0.20)', borderBottom: 'none', boxShadow: '0 -20px 60px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.30)', width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f4f4f8' }}>Nahrát výkazy do Jira</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Od</div>
            <input type="date" style={field} value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Do</div>
            <input type="date" style={field} value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#d7dbe6', cursor: busy ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={onlyUnposted} onChange={(e) => setOnlyUnposted(e.target.checked)} disabled={busy} />
          Jen dosud nenahrané
        </label>

        {error && <div style={{ fontSize: 12, color: C.red }}>{error}</div>}

        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12.5, color: C.muted }}>
              Celkem {result.totalCandidates}
              {result.skippedNoJiraKey > 0 && ` · bez klíče ${result.skippedNoJiraKey}`}
              {result.skippedAlreadyPosted > 0 && ` · již nahráno ${result.skippedAlreadyPosted}`}
              {result.skippedTaskNotOpen > 0 && ` · úkol uzavřen ${result.skippedTaskNotOpen}`}
              {result.dryRun
                ? ` · k nahrání ${result.attempted}`
                : ` · nahráno ${result.posted} · chyby ${result.failed} · dokončeno úkolů ${result.tasksMarkedDone}`}
            </div>
            {result.neededBrowserRefresh && (
              <div style={{ fontSize: 12, color: C.amber }}>
                Na Macu se otevřelo přihlašovací okno prohlížeče — dokončete přihlášení a zkuste to znovu.
              </div>
            )}
            <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {result.entries.map((entry) => (
                <div
                  key={entry.worklogId}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px', borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: STATUS_COLOR[entry.status] }}>
                      {STATUS_LABEL[entry.status]}
                    </span>
                    <span style={{ fontSize: 11, color: C.muted }}>{entry.workDate}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11.5, color: '#d7dbe6' }}>{entry.timeSpent}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#c2c9d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.taskNumber} {entry.taskTitle}
                  </div>
                  {entry.reason && <div style={{ fontSize: 11, color: C.muted }}>{entry.reason}</div>}
                  {entry.jiraWorklogUrl && <div style={{ fontSize: 11, color: C.violetDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.jiraWorklogUrl}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize: 10.5, color: C.muted }}>
          Pokud na Macu vypršelo přihlášení k Jira, může se při nahrávání otevřít okno prohlížeče.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ height: 36, padding: '0 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: '#c2c9d8', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.10)', display: 'inline-flex', alignItems: 'center' }}>
            {phase === 'done' ? 'Zavřít' : 'Zrušit'}
          </button>
          {phase !== 'done' && (
            <button
              onClick={preview}
              disabled={busy}
              style={{ height: 36, padding: '0 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#c2c9d8', fontSize: 12.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}
            >
              {phase === 'previewing' ? 'Načítám…' : 'Náhled'}
            </button>
          )}
          {phase !== 'done' && (
            <button
              onClick={upload}
              disabled={!canUpload || busy}
              style={{ height: 38, padding: '0 16px', borderRadius: 11, border: 'none', background: canUpload ? ctaGradient : 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: canUpload && !busy ? 'pointer' : 'default', fontFamily: 'inherit', boxShadow: canUpload ? ctaGlow : 'none' }}
            >
              {phase === 'uploading' ? 'Nahrávám…' : 'Nahrát'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
