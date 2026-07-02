import { useRef } from 'react';
import type { Rect } from '@watchtower/shared/computePaneRects.js';
import { useXtermSession } from '../lib/useXtermSession.js';

interface Props {
  instanceId: string;
  rect: Rect;
  focused: boolean;
  onFocus: () => void;
}

/**
 * One terminal pane, absolutely positioned at `rect` inside the WorkspacePane
 * container. The xterm host div keeps a stable DOM parent for its whole life
 * (never reparented), so scrollback/buffer survive splits and resizes — only
 * its left/top/width/height change. The pane's own ResizeObserver (inside
 * useXtermSession) re-fits and drives ptyResize whenever the rect changes.
 */
export function PaneTerminal({ instanceId, rect, focused, onFocus }: Props) {
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
        border: focused
          ? '1px solid rgba(129,140,248,0.9)'
          : '1px solid rgba(255,255,255,0.10)',
        boxShadow: focused
          ? '0 10px 28px rgba(0,0,0,0.40), 0 0 0 3px rgba(129,140,248,0.18), inset 0 1px 0 rgba(255,255,255,0.06)'
          : '0 10px 28px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}
    >
      {/* Inner padded host so text doesn't hug the rounded corners. FitAddon
          reads this content box, so the padding is subtracted automatically. */}
      <div ref={hostRef} style={{ width: '100%', height: '100%', padding: 10, boxSizing: 'border-box', overflow: 'hidden', position: 'relative' }} />
    </div>
  );
}
