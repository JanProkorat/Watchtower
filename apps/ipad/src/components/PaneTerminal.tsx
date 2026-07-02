import { useRef, type CSSProperties } from 'react';
import type { Rect } from '@watchtower/shared/computePaneRects.js';
import { useXtermSession } from '../lib/useXtermSession.js';

interface Props {
  instanceId: string;
  rect: Rect;
  focused: boolean;
  onFocus: () => void;
  onSplit: (dir: 'row' | 'col', position: 'before' | 'after') => void;
  onClose: () => void;
}

/**
 * One terminal pane, absolutely positioned at `rect` inside the WorkspacePane
 * container. The xterm host div keeps a stable DOM parent for its whole life
 * (never reparented), so scrollback/buffer survive splits and resizes — only
 * its left/top/width/height change. The pane's own ResizeObserver (inside
 * useXtermSession) re-fits and drives ptyResize whenever the rect changes.
 *
 * Top-right chrome: split-right, split-down, close — brighter when focused.
 */
export function PaneTerminal({ instanceId, rect, focused, onFocus, onSplit, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useXtermSession(hostRef, instanceId, { onFocus });

  return (
    <div
      onPointerDown={onFocus}
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        boxSizing: 'border-box',
        backgroundColor: '#0e0f12',
        borderRadius: 12,
        // Neutral border in both states — no full-perimeter purple ring/tint.
        border: '1px solid rgba(255,255,255,0.10)',
        // Focus is shown as a thin accent line at the TOP only (inset shadow,
        // so it costs no layout space and doesn't tint the whole pane).
        boxShadow: focused
          ? 'inset 0 3px 0 rgba(129,140,248,0.95), 0 10px 28px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)'
          : '0 10px 28px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}
    >
      {/* Inner padded host so text doesn't hug the rounded corners. FitAddon
          reads this content box, so the padding is subtracted automatically. */}
      <div ref={hostRef} style={{ width: '100%', height: '100%', padding: 10, boxSizing: 'border-box', overflow: 'hidden', position: 'relative' }} />

      {/* Pane chrome — top-right. stopPropagation so tapping a button doesn't
          also fall through to the pane-focus handler. */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          display: 'flex',
          gap: 4,
          opacity: focused ? 1 : 0.45,
          transition: 'opacity 120ms ease',
          zIndex: 6,
        }}
      >
        <ChromeButton title="Rozdělit vpravo" glyph="⇥" onTap={() => onSplit('row', 'after')} />
        <ChromeButton title="Rozdělit dolů" glyph="⤓" onTap={() => onSplit('col', 'after')} />
        <ChromeButton title="Zavřít panel" glyph="✕" onTap={onClose} />
      </div>
    </div>
  );
}

const chromeButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 7,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(20,22,28,0.6)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  color: '#e5e7eb',
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

function ChromeButton({ title, glyph, onTap }: { title: string; glyph: string; onTap: () => void }) {
  return (
    <button
      title={title}
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onTap(); }}
      style={chromeButtonStyle}
    >
      {glyph}
    </button>
  );
}
