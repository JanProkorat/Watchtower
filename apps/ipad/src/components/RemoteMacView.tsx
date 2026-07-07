import { useEffect, useRef, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { RemoteVnc, type VncState } from '../lib/remoteVnc.js';
import { useConnection } from '../state/connectionContext.js';
import { type Connection } from '../connection.js';
import { loadVncCreds, saveVncCreds, type VncCreds } from '../state/vncCreds.js';
import { WakeButton } from './WakeButton.js';
import { baseBg, statusGlass, glassPanel, text, ctaGradient, ctaGlow } from '@watchtower/ui-core';

const store = {
  get: async (k: string) => (await Preferences.get({ key: k })).value,
  set: async (k: string, v: string) => { await Preferences.set({ key: k, value: v }); },
};

const isIos = Capacitor.getPlatform() === 'ios';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function RemoteMacView({ connection, immersive, onToggleImmersive }: {
  connection: Connection;
  immersive: boolean;
  onToggleImmersive: () => void;
}) {
  useConnection(); // ensures we're inside the provider
  const [creds, setCreds] = useState<VncCreds | null>(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [status, setStatus] = useState<VncState>('connecting');
  const [loginOpen, setLoginOpen] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [nonce, setNonce] = useState(0); // bump to re-present
  const [form, setForm] = useState({ username: '', password: '' });
  const presenting = useRef(false);

  // Load saved macOS credentials once.
  useEffect(() => {
    void loadVncCreds(store).then((c) => {
      if (c) setForm((f) => ({ ...f, username: c.username }));
      setCreds(c);
      setCredsLoaded(true);
    });
  }, []);

  // Present the native VC whenever we have credentials (iOS only). Subscribe to
  // native lifecycle events; disconnect + remove listeners on unmount/re-present.
  useEffect(() => {
    if (!creds || !isIos) return;
    let removers: Array<{ remove: () => void }> = [];
    let cancelled = false;
    setStatus('connecting');
    presenting.current = true;

    void (async () => {
      removers = await Promise.all([
        RemoteVnc.addListener('state', (d) => {
          setStatus(d.status);
          if (d.status === 'connected') { setLoginOpen(false); setAuthFailed(false); }
        }),
        RemoteVnc.addListener('authFailed', () => { setAuthFailed(true); setLoginOpen(true); }),
        RemoteVnc.addListener('closed', () => { setStatus('disconnected'); }),
      ]);
      if (cancelled) { removers.forEach((r) => r.remove()); return; }
      await RemoteVnc.present({ host: connection.host, username: creds.username, password: creds.password });
    })();

    return () => {
      cancelled = true;
      removers.forEach((r) => r.remove());
      void RemoteVnc.disconnect();
      presenting.current = false;
    };
  }, [creds, connection, nonce]);

  async function submitCreds() {
    const next = { username: form.username.trim(), password: form.password };
    if (!next.username || !next.password) return;
    await saveVncCreds(store, next);
    setAuthFailed(false);
    setLoginOpen(false);
    setStatus('connecting');
    setCreds(next); // new ref → re-present effect runs
  }

  if (!credsLoaded) {
    return (
      <div style={{ ...fill, alignItems: 'center', justifyContent: 'center', color: text.muted, fontSize: 14 }}>
        Načítání…
      </div>
    );
  }

  if (!isIos) {
    return (
      <div style={{ ...fill, alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: text.muted, fontSize: 14, lineHeight: 1.5 }}>
        Vzdálený Mac je dostupný jen v aplikaci na iPadu.
      </div>
    );
  }

  if (!creds || loginOpen) {
    const err = statusGlass('disconnected');
    return (
      <div style={{ ...fill, alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
        <div style={{ ...glassPanel({ radius: 22 }), padding: 24, display: 'grid', gap: 12, width: '100%', maxWidth: 380 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: text.primary }}>Přihlášení k obrazovce Macu</div>
          <div style={{ fontSize: 13, color: text.muted, lineHeight: 1.45 }}>
            Zadejte <b>uživatelské jméno účtu macOS</b> (krátké jméno, např. „jan" — ne Apple ID)
            a heslo, kterým se přihlašujete k Macu.
          </div>
          {authFailed && (
            <div role="alert" style={{ ...err.panel, borderRadius: 12, padding: '9px 13px', color: err.accent, fontSize: 13 }}>
              Přihlášení selhalo – zkontrolujte krátké jméno účtu macOS a heslo.
            </div>
          )}
          <input placeholder="krátké jméno účtu macOS (např. jan)" autoCapitalize="none" autoCorrect="off"
            value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} style={inputStyle} />
          <input placeholder="heslo k Macu" type="password"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={inputStyle} />
          <button onClick={() => void submitCreds()} style={primaryBtn}>Připojit</button>
        </div>
      </div>
    );
  }

  // Native VC is presented over the WebView. This view shows only the connect/
  // disconnect chrome that sits behind it while (re)connecting or after close.
  return (
    <div style={{ ...fill, flexDirection: 'column', position: 'relative', alignItems: 'center', justifyContent: 'center', background: baseBg }}>
      {status !== 'connected' && (
        <StatusBanner
          status={status}
          connection={connection}
          onRetry={() => setNonce((n) => n + 1)}
          onChangeLogin={() => setLoginOpen(true)}
        />
      )}
    </div>
  );
}

function StatusBanner({ status, connection, onRetry, onChangeLogin }: {
  status: VncState;
  connection: Connection;
  onRetry: () => void;
  onChangeLogin: () => void;
}) {
  const g = statusGlass(status === 'disconnected' ? 'disconnected' : 'connecting');
  return (
    <div role="status" aria-live="polite" style={{
      ...g.panel, borderRadius: 16, padding: '11px 18px', maxWidth: 'calc(100% - 32px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
      color: g.accent, fontSize: 13, fontWeight: 600,
    }}>
      <span style={{ ...g.dot, flexShrink: 0 }} />
      {status === 'connecting' ? (
        <span>Připojuji k obrazovce Macu…</span>
      ) : (
        <>
          <span>Odpojeno – zkontrolujte Sdílení obrazovky na Macu</span>
          <button onClick={onRetry} style={glassBtn(g.accent)}>Zkusit znovu</button>
          <button onClick={onChangeLogin} style={glassBtn(g.accent)}>Změnit přihlášení</button>
          {connection.mac && <WakeButton connection={connection} />}
        </>
      )}
    </div>
  );
}

const fill: React.CSSProperties = { display: 'flex', flex: 1, minWidth: 0, height: '100%', backgroundColor: 'transparent' };
const inputStyle: React.CSSProperties = {
  padding: '11px 13px', borderRadius: 11, border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.06)', color: text.primary, fontSize: 14,
  fontFamily: 'system-ui, sans-serif', outline: 'none',
};
const primaryBtn: React.CSSProperties = {
  padding: '11px 0', borderRadius: 12, border: 'none', background: ctaGradient,
  boxShadow: ctaGlow, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};
function glassBtn(color: string): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.20)',
    background: 'rgba(255,255,255,0.08)', color, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  };
}
