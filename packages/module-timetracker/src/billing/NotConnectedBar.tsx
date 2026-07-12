import { statusGlass, text } from '@watchtower/ui-core';

interface Props {
  onSignIn: () => void;
}

/**
 * Thin banner shown at the top of the Supabase-backed pages when signed out.
 * Communicates that data is cached/read-only and offers a way to sign in.
 */
export function NotConnectedBar({ onSignIn }: Props): JSX.Element {
  const s = statusGlass('disconnected');
  return (
    <div
      style={{
        ...s.panel,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        margin: '8px 12px 0',
        borderRadius: 12,
        flexShrink: 0,
      }}
    >
      <span style={s.dot} />
      <span style={{ flex: 1, fontSize: 13, color: text.secondary, fontFamily: 'system-ui, sans-serif' }}>
        Not signed in — showing cached data
      </span>
      <button
        onClick={onSignIn}
        style={{
          padding: '5px 12px',
          borderRadius: 9,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(255,255,255,0.10)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'system-ui, sans-serif',
          flexShrink: 0,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        Sign in
      </button>
    </div>
  );
}
