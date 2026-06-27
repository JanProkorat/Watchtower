import { useState } from 'react';
import type { SupabaseAuthState } from '../../state/useSupabaseAuth.js';

interface Props {
  signIn: SupabaseAuthState['signIn'];
}

export function BillingLogin({ signIn }: Props): JSX.Element {
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0e0f12',
      }}
    >
      <div
        style={{
          width: 320,
          backgroundColor: '#1a1b1f',
          border: '1px solid #2e3038',
          borderRadius: 12,
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: '#c4b8ff',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
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
              backgroundColor: '#2d1515',
              border: '1px solid #7f1d1d',
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
            backgroundColor: busy ? '#4b4a72' : '#7c6df0',
            color: busy ? '#9ca3af' : '#fff',
            fontSize: 15,
            fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {busy ? 'Přihlašuji…' : 'Přihlásit'}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #2e3038',
  backgroundColor: '#13141a',
  color: '#e5e7eb',
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
  outline: 'none',
};
