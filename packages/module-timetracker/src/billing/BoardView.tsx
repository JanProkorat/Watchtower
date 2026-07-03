import { useState } from 'react';
import { useBilling } from '@watchtower/data-supabase';
import { buildBoard, type BoardCard } from '@watchtower/shared/billing/board/board.js';
import type { JiraSyncRequestPayload, JiraSyncResultPayload } from '@watchtower/shared/ipcContract.js';
import { useIsNarrow, glassPanel, dataPanelFill } from '@watchtower/ui-core';
import { C } from './reports/tokens.js';
import { BoardUploadSheet } from './BoardUploadSheet.js';

// Read-only Jira-status board: three columns (To Do / Rozpracované / K akceptaci)
// built by the pure `buildBoard` helper from the tasks + worklogs the client
// already holds. No writes — matches the desktop board's grouping so iPad/
// iPhone show the same state without a second sync path.
//
// iPad-only actions (re-sync from Jira, upload worklogs to Jira) are injected
// via the optional `actions` prop — bridge-agnostic: when absent (iPhone, or
// the Mac unreachable) the board stays exactly as before. There is no shared
// billing provider, so the injected callbacks perform ONLY the Mac RPC; this
// component re-pulls its own data via its own `useBilling().refresh()` once a
// callback resolves.

/** Mac-RPC capability injected by the iPad shell. Undefined on iPhone. */
export interface BoardActions {
  online: boolean;
  /** Re-sync the given projects from Jira on the Mac; resolves when all done. */
  sync: (projectIds: number[]) => Promise<{ ok: boolean; authFailed: boolean; error?: string }>;
  /** Jira worklog upload — dryRun preview. */
  preview: (req: JiraSyncRequestPayload) => Promise<JiraSyncResultPayload>;
  /** Jira worklog upload — real run. */
  upload: (req: JiraSyncRequestPayload) => Promise<JiraSyncResultPayload>;
}

const hrs = (min: number): string => (min / 60).toFixed(1).replace('.', ',');

function timeLine(card: BoardCard): string {
  const logged = hrs(card.loggedMinutes);
  if (card.estimateMinutes != null && card.estimateMinutes > 0) {
    return `${logged} / ${hrs(card.estimateMinutes)} h`;
  }
  return `${logged} h`;
}

function BoardCardTile({ card }: { card: BoardCard }): JSX.Element {
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 9,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {card.projectColor && (
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: card.projectColor, flexShrink: 0 }} />
        )}
        <span style={{ fontFamily: 'monospace', color: C.muted, fontSize: 11, flexShrink: 0 }}>
          {card.taskNumber ?? '(bez úkolu)'}
        </span>
      </div>
      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.3,
          color: '#c2c9d8',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {card.taskTitle}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, gap: 6 }}>
        <span
          style={{
            fontSize: 9.5,
            color: C.violetDim,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {card.jiraStatus}
        </span>
        <span style={{ fontSize: 11, color: C.muted, flexShrink: 0, whiteSpace: 'nowrap' }}>{timeLine(card)}</span>
      </div>
    </div>
  );
}

export function BoardView({ actions }: { actions?: BoardActions } = {}): JSX.Element {
  const { data, refresh } = useBilling();
  // Phone width: columns shrink so ~1.5 columns preview on screen; iPad keeps
  // the roomier width. Either way the row always scrolls horizontally.
  const isNarrow = useIsNarrow();
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'amber'; text: string } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const projects = data?.projects ?? [];
  const tasks = data?.tasks ?? [];

  const g = buildBoard(tasks, data?.worklogs ?? [], { projectId });
  const totalCards = g.columns.reduce((sum, c) => sum + c.cards.length, 0);
  const colWidth = isNarrow ? 200 : 240;

  async function handleSync() {
    if (!actions) return;
    const ids = projectId != null
      ? [projectId]
      : Array.from(new Set(tasks.filter((t) => t.jiraStatus != null).map((t) => t.projectId)));
    if (ids.length === 0) return;
    setSyncing(true);
    try {
      const result = await actions.sync(ids);
      await refresh();
      if (result.authFailed) setNotice({ kind: 'amber', text: 'Přihlaste se k Jira na Macu' });
      else if (result.error) setNotice({ kind: 'error', text: result.error });
      else setNotice(null);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        background: 'transparent',
        height: '100%',
        minHeight: 0,
        color: C.text,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          zIndex: 11,
          padding: '10px 16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          ...glassPanel({ radius: 13, blur: 28, saturate: 1.7 }),
          borderRadius: 0,
          borderLeft: 'none',
          borderRight: 'none',
          borderTop: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.10)',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value === '' ? undefined : Number(e.target.value))}
            style={{
              flex: 1,
              minWidth: 0,
              height: 36,
              padding: '0 12px',
              borderRadius: 9,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)',
              color: '#c2c9d8',
              fontSize: 13,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <option value="">Všechny projekty</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || '(bez názvu)'}
              </option>
            ))}
          </select>
          {actions && (
            <>
              <button
                onClick={handleSync}
                disabled={!actions.online || syncing}
                style={{
                  height: 36,
                  padding: '0 12px',
                  borderRadius: 9,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.06)',
                  color: actions.online ? '#c2c9d8' : C.muted,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: actions.online && !syncing ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {syncing ? 'Synchronizuji…' : 'Synchronizovat'}
              </button>
              <button
                onClick={() => setUploadOpen(true)}
                disabled={!actions.online}
                style={{
                  height: 36,
                  padding: '0 12px',
                  borderRadius: 9,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.06)',
                  color: actions.online ? '#c2c9d8' : C.muted,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: actions.online ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                Nahrát výkazy
              </button>
            </>
          )}
        </div>
        {actions && !actions.online && (
          <div style={{ fontSize: 11, color: C.muted }}>Mac není dostupný</div>
        )}
        {actions && notice && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 8,
              background: notice.kind === 'error' ? 'rgba(248,113,113,0.12)' : 'rgba(251,191,36,0.12)',
              border: `1px solid ${notice.kind === 'error' ? C.red : C.amber}`,
            }}
          >
            <span style={{ fontSize: 12, color: notice.kind === 'error' ? C.red : C.amber }}>{notice.text}</span>
            <button
              onClick={() => setNotice(null)}
              style={{ background: 'none', border: 'none', color: C.muted, fontSize: 14, cursor: 'pointer', flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {totalCards === 0 ? (
        <div style={{ padding: 24, color: C.muted, fontSize: 14 }}>žádné úkoly z Jira nástěnky</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 16px', display: 'flex', gap: 12 }}>
          {g.columns.map((col) => (
            <div
              key={col.key}
              style={{
                minWidth: colWidth,
                width: colWidth,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 12,
                background: dataPanelFill,
                border: '1px solid rgba(255,255,255,0.08)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#f4f4f8' }}>{col.title}</span>
                <span
                  style={{
                    minWidth: 20,
                    height: 20,
                    padding: '0 6px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.08)',
                    color: C.muted,
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {col.cards.length}
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {col.cards.map((card) => (
                  <BoardCardTile key={`${card.projectId}:${card.taskNumber ?? ''}`} card={card} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {actions && uploadOpen && (
        <BoardUploadSheet
          actions={actions}
          projectId={projectId}
          onClose={() => setUploadOpen(false)}
          onUploaded={refresh}
        />
      )}
    </div>
  );
}
