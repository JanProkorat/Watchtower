// apps/ipad/src/components/TerminalView.tsx
import { useRef } from 'react';
import { useXtermSession } from '../lib/useXtermSession.js';

interface Props {
  instanceId: string;
}

export function TerminalView({ instanceId }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useXtermSession(hostRef, instanceId);

  return (
    <div
      ref={hostRef}
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        // Solid dark fill — a terminal must stay legible, so it isn't frosted;
        // the rounded frame + hairline + soft shadow make it read as a panel
        // floating on the ambient background instead of an edge-to-edge slab.
        backgroundColor: '#0e0f12',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 10px 28px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)',
        // Inner breathing room so text doesn't hug the rounded corners. FitAddon
        // reads the host's content box, so this padding is subtracted from the
        // cols/rows calc automatically.
        padding: 10,
        overflow: 'hidden',
        position: 'relative',
      }}
    />
  );
}
