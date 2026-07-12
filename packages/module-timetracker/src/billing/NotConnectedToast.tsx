import type { CSSProperties } from 'react';
import { statusGlass } from '@watchtower/ui-core';

interface Props {
  onSignIn: () => void;
}

/**
 * Compact floating "not signed in" toast for the Supabase-backed pages — a
 * top-right overlay in the iPad's connection-toast style (statusGlass card +
 * dot + inline action), laid out as a single horizontal row and sized to its
 * content so it stays small. Absolutely positioned so it OVERLAYS content and
 * never pushes the page down; the host must be `position: relative`. Uses the
 * `authBlock` (amber) state — a sign-in prompt, mirroring the Mac "waiting for
 * login" toast rather than the red connection-lost one.
 */
export function NotConnectedToast({ onSignIn }: Props): JSX.Element {
  const g = statusGlass('authBlock');
  return (
    <div style={containerStyle}>
      <div
        role="status"
        aria-live="polite"
        style={{
          ...g.panel,
          borderRadius: 11,
          padding: '7px 9px 7px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: g.accent,
          pointerEvents: 'auto',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.16)',
        }}
      >
        <span style={{ ...g.dot, flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap' }}>Not signed in</span>
          <span style={{ fontSize: 10.5, fontWeight: 400, opacity: 0.8, lineHeight: 1.2, whiteSpace: 'nowrap' }}>Showing cached data</span>
        </div>
        <button onClick={onSignIn} style={signInBtn}>Sign in</button>
      </div>
    </div>
  );
}

// Click-through wrapper, shrink-to-fit at the top-right; the card re-enables
// pointer events.
const containerStyle: CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  zIndex: 50,
  maxWidth: 'calc(100% - 24px)',
  pointerEvents: 'none',
};

const signInBtn: CSSProperties = {
  flexShrink: 0,
  padding: '5px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.22)',
  background: 'rgba(255,255,255,0.12)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  WebkitTapHighlightColor: 'transparent',
};
