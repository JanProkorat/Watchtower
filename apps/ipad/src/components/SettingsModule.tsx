// apps/ipad/src/components/SettingsModule.tsx
//
// The Settings (Nastavení) module. Minimal for now — it's the new home of the
// account sign-out, moved out of the billing content header. Glass surfaces on
// the ambient background, consistent with the rest of the app.
import { useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { useSupabaseAuth } from '@watchtower/data-supabase';
import { glassCard, ctaGradient, ctaGlow, text } from '@watchtower/ui-core';
import { ConnectionFields } from './ConnectionFields.js';
import {
  connectionToFormState, commitConnectionEdit, type Connection, type ConnectionFormState,
} from '../connection.js';

// Same Capacitor Preferences store as App.tsx — duplicated here (rather than
// imported) to avoid a circular import between App.tsx and this module.
const store = {
  get: async (k: string) => (await Preferences.get({ key: k })).value,
  set: async (k: string, v: string) => { await Preferences.set({ key: k, value: v }); },
};

export function SettingsModule({ connection, onConnectionChange }: {
  connection: Connection;
  onConnectionChange: (c: Connection) => void;
}): JSX.Element {
  const { status, signOut } = useSupabaseAuth();
  const authed = status === 'in';

  const [form, setForm] = useState<ConnectionFormState>(() => connectionToFormState(connection));
  const [connError, setConnError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setConnError(null);
    setSaved(false);
    const r = await commitConnectionEdit(store, form);
    if (!r.ok) { setConnError(r.error); return; }
    onConnectionChange(r.value);
    setSaved(true);
  }

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

        {/* Connection card — editing the host is what enables Tailscale. */}
        <div style={{ ...glassCard(16), padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: text.muted }}>
            Připojení k Macu
          </div>
          <div style={{ fontSize: 12, color: text.dim }}>
            Pro přístup mimo domácí síť zadejte Tailscale název Macu jako host.
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <ConnectionFields form={form} onChange={setForm} />
          </div>
          {connError && <div style={{ fontSize: 12, color: '#ff8a8a' }}>{connError}</div>}
          {saved && <div style={{ fontSize: 12, color: '#9be7c0' }}>Uloženo, připojuji…</div>}
          <button onClick={() => void handleSave()} style={{
            alignSelf: 'flex-start', padding: '9px 16px', borderRadius: 11, border: 'none',
            background: ctaGradient, boxShadow: ctaGlow, color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
          }}>Uložit a připojit</button>
        </div>

        <div style={{ fontSize: 12, color: text.dim }}>Další nastavení připravujeme.</div>
      </div>
    </div>
  );
}
