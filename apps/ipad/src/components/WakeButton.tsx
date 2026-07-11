import { useWake } from '../state/useWake.js';
import type { Connection } from '../connection.js';
import { glassPanel, statusGlass, accent, accentWash, text, ctaGradient } from '@watchtower/ui-core';

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

  // success / sent state → green status pill via statusGlass('connected')
  if (status === 'sent') {
    const sg = statusGlass('connected');
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 20,
        ...sg.panel,
        fontSize: 14, fontWeight: 600, color: sg.accent,
        whiteSpace: 'nowrap',
      }}>
        <span style={sg.dot} />
        {label}
      </div>
    );
  }

  // sending state → dimmed glass chip
  if (status === 'sending') {
    return (
      <button
        disabled
        style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '7px 14px', borderRadius: 20,
          ...glassPanel({ radius: 20, blur: 24, fill: 'rgba(48,52,76,0.28)', shadow: 'none' }),
          border: '1px solid rgba(255,255,255,0.08)',
          fontSize: 14, fontWeight: 600,
          color: text.dim,
          cursor: 'not-allowed', opacity: 0.55,
          whiteSpace: 'nowrap',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {label}
      </button>
    );
  }

  // idle / error state — glass field/chip with accent text; disabled (no MAC) is muted
  return (
    <button
      onClick={() => { void wake(connection); }}
      disabled={disabled}
      title={connection.mac ? 'Probudit Mac' : 'Nejprve nastavte MAC adresu'}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '7px 14px', borderRadius: 20,
        ...glassPanel({ radius: 20, blur: 24 }),
        border: disabled
          ? '1px solid rgba(255,255,255,0.06)'
          : `1px solid rgba(56,189,248,0.35)`,
        background: disabled ? 'rgba(48,52,76,0.20)' : accentWash,
        fontSize: 14, fontWeight: 600,
        color: disabled ? text.dim : (status === 'error' ? '#f87171' : accent),
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  );
}
