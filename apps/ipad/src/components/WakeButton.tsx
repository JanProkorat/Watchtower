import { useWake } from '../state/useWake.js';
import type { Connection } from '../connection.js';

// "Probudit Mac" button. Disabled until a MAC is configured. Fire-and-forget:
// after a tap it shows a transient "Paket odeslán" — it cannot confirm the Mac
// actually woke (UDP has no ack); the normal reconnect loop takes over.
export function WakeButton({ connection }: { connection: Connection }) {
  const { status, wake } = useWake();
  const disabled = !connection.mac || status === 'sending';

  const label =
    status === 'sending' ? 'Odesílám…'
    : status === 'sent' ? 'Paket odeslán'
    : status === 'error' ? 'Chyba odeslání'
    : '⏻ Probudit Mac';

  return (
    <button
      onClick={() => { void wake(connection); }}
      disabled={disabled}
      title={connection.mac ? 'Probudit Mac' : 'Nejprve nastavte MAC adresu'}
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid #2e3038',
        backgroundColor: disabled ? '#1a1b1f' : '#23304a',
        color: disabled ? '#6b7280' : '#93c5fd',
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  );
}
