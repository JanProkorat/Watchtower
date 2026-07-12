import type { CSSProperties } from 'react';
import type { SupabaseAuthState } from '@watchtower/data-supabase';
import { glassPanel, glassFillStrong } from '@watchtower/ui-core';
import { LoginForm } from './LoginForm.js';

interface Props {
  open: boolean;
  onClose: () => void;
  signIn: SupabaseAuthState['signIn'];
}

/** Centered modal login. Backdrop tap or a successful sign-in closes it. */
export function LoginDialog({ open, onClose, signIn }: Props): JSX.Element | null {
  if (!open) return null;
  return (
    <div data-testid="login-dialog-backdrop" onClick={onClose} style={scrimStyle}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 320,
          ...glassPanel({ radius: 22, fill: glassFillStrong, blur: 40, saturate: 1.9, brightness: 1.1 }),
          padding: 28,
        }}
      >
        <LoginForm signIn={signIn} onSuccess={onClose} />
      </div>
    </div>
  );
}

const scrimStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
};
