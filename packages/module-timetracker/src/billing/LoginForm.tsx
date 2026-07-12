import { useState } from 'react';
import type { SupabaseAuthState } from '@watchtower/data-supabase';
import { ctaGradient, ctaGlow, text } from '@watchtower/ui-core';

interface Props {
  signIn: SupabaseAuthState['signIn'];
  /** Called after a sign-in that resolved with no error (host closes dialog etc.). */
  onSuccess?: () => void;
}

/**
 * The Supabase email/password form — heading, inputs, error box, submit. Layout-
 * agnostic (a plain column): the host supplies the card/centering/scrim. Used by
 * the full-screen `BillingLogin` (iPhone) and the `LoginDialog` (iPad).
 */
export function LoginForm({ signIn, onSuccess }: Props): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const result = await signIn(email, password);
      if (result.error) setError(result.error);
      else onSuccess?.();
    } catch {
      setError('Přihlášení se nezdařilo. Zkuste to znovu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#bae6fd', fontFamily: 'system-ui, sans-serif' }}>
        Přihlášení
      </h2>

      <input
        type="email"
        placeholder="E-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={inputStyle}
        autoCapitalize="none"
        autoCorrect="off"
      />

      <input
        type="password"
        placeholder="Heslo"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={inputStyle}
      />

      {error && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(110,24,24,0.32)',
            border: '1px solid rgba(248,113,113,0.40)',
            color: '#fca5a5',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={() => void handleSubmit()}
        disabled={busy}
        style={{
          padding: '10px 0',
          borderRadius: 8,
          border: 'none',
          background: busy ? 'rgba(56,189,248,0.35)' : ctaGradient,
          boxShadow: busy ? 'none' : ctaGlow,
          color: busy ? text.muted : '#fff',
          fontSize: 15,
          fontWeight: 600,
          cursor: busy ? 'not-allowed' : 'pointer',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {busy ? 'Přihlašuji…' : 'Přihlásit'}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.07)',
  color: '#e5e7eb',
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
  outline: 'none',
};
