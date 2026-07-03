import { useState } from 'react';
import { useBilling } from '@watchtower/data-supabase';
import { buildBoard, type BoardCard } from '@watchtower/shared/billing/board/board.js';
import { useIsNarrow, glassPanel, dataPanelFill } from '@watchtower/ui-core';
import { C } from './reports/tokens.js';

// Read-only Jira-status board: three columns (To Do / Rozpracované / K akceptaci)
// built by the pure `buildBoard` helper from the tasks + worklogs the client
// already holds. No writes — matches the desktop board's grouping so iPad/
// iPhone show the same state without a second sync path.

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

export function BoardView(): JSX.Element {
  const { data } = useBilling();
  // Phone width: columns shrink so ~1.5 columns preview on screen; iPad keeps
  // the roomier width. Either way the row always scrolls horizontally.
  const isNarrow = useIsNarrow();
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const projects = data?.projects ?? [];

  const g = buildBoard(data?.tasks ?? [], data?.worklogs ?? [], { projectId });
  const totalCards = g.columns.reduce((sum, c) => sum + c.cards.length, 0);
  const colWidth = isNarrow ? 200 : 240;

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
        <select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value === '' ? undefined : Number(e.target.value))}
          style={{
            width: '100%',
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
    </div>
  );
}
