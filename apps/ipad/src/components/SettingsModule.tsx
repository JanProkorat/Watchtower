// apps/ipad/src/components/SettingsModule.tsx
//
// The Settings (Nastavení) module. Minimal for now — it's the new home of the
// account sign-out, moved out of the billing content header. Glass surfaces on
// the ambient background, consistent with the rest of the app.
import { useSupabaseAuth } from '../state/useSupabaseAuth.js';
import { glassCard, ctaGradient, ctaGlow, text } from '@watchtower/ui-core';

export function SettingsModule(): JSX.Element {
  const { status, signOut } = useSupabaseAuth();
  const authed = status === 'in';

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: text.primary,
        background: 'transparent',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 4px', color: '#f0f1f5', letterSpacing: 0.2 }}>
          Nastavení
        </h1>

        {/* Account card — sign-out lives here now. */}
        <div style={{ ...glassCard(16), padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: text.muted }}>
            Účet
          </div>
          <div style={{ fontSize: 13, color: text.secondary }}>
            {authed ? 'Přihlášen k fakturačním datům.' : 'Nepřihlášen.'}
          </div>
          <button
            onClick={() => void signOut()}
            disabled={!authed}
            style={{
              alignSelf: 'flex-start',
              padding: '9px 16px',
              borderRadius: 11,
              border: 'none',
              background: authed ? ctaGradient : 'rgba(255,255,255,0.06)',
              boxShadow: authed ? ctaGlow : 'none',
              color: authed ? '#fff' : text.dim,
              fontSize: 13,
              fontWeight: 600,
              cursor: authed ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Odhlásit
          </button>
        </div>

        <div style={{ fontSize: 12, color: text.dim }}>Další nastavení připravujeme.</div>
      </div>
    </div>
  );
}
