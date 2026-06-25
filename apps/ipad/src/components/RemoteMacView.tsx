import { useEffect, useRef, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import RFB from '@novnc/novnc/core/rfb.js';
import { useConnection } from '../state/connectionContext.js';
import { connectionToVncWsUrl, type Connection } from '../connection.js';
import { VNC_KEYSYMS } from '../lib/vncKeys.js';
import { loadVncCreds, saveVncCreds, type VncCreds } from '../state/vncCreds.js';

// Capacitor Preferences-backed store (same shape as App's).
const store = {
  get: async (k: string) => (await Preferences.get({ key: k })).value,
  set: async (k: string, v: string) => { await Preferences.set({ key: k, value: v }); },
};

type VncStatus = 'connecting' | 'connected' | 'disconnected';

export function RemoteMacView({ connection }: { connection: Connection }) {
  useConnection(); // ensures we're inside the provider
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [creds, setCreds] = useState<VncCreds | null>(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [status, setStatus] = useState<VncStatus>('connecting');
  // loginOpen: show the macOS login form. Set on auth failure (a separate flag
  // so the `disconnect` event noVNC fires *right after* securityfailure can't
  // clobber it) and via the "Změnit přihlášení" escape hatch.
  const [loginOpen, setLoginOpen] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [nonce, setNonce] = useState(0); // bump to force a reconnect
  const [form, setForm] = useState({ username: '', password: '' });

  // Load saved macOS credentials once.
  useEffect(() => {
    void loadVncCreds(store).then((c) => {
      if (c) setForm((f) => ({ ...f, username: c.username }));
      setCreds(c);
      setCredsLoaded(true);
    });
  }, []);

  // (Re)connect whenever we have credentials and the screen target is mounted.
  useEffect(() => {
    if (!creds || !screenRef.current) return;
    const url = `${connectionToVncWsUrl(connection)}?token=${encodeURIComponent(connection.token)}`;
    setStatus('connecting');
    const rfb = new RFB(screenRef.current, url, {
      // macOS Screen Sharing uses Apple auth (RFB type 30): the macOS *account*
      // short name + login password. noVNC computes the Diffie-Hellman itself.
      credentials: { username: creds.username, password: creds.password },
    });
    rfb.scaleViewport = true;
    rfb.background = '#0e0f12';
    rfbRef.current = rfb;
    const onConnect = () => { setStatus('connected'); setLoginOpen(false); setAuthFailed(false); };
    const onDisconnect = () => setStatus('disconnected');
    // Wrong creds → server rejects (securityfailure), or noVNC re-requests them.
    // Re-open the login; do NOT rely on `status`, which `disconnect` overwrites.
    const onAuthFail = () => { setAuthFailed(true); setLoginOpen(true); };
    rfb.addEventListener('connect', onConnect);
    rfb.addEventListener('disconnect', onDisconnect);
    rfb.addEventListener('securityfailure', onAuthFail);
    rfb.addEventListener('credentialsrequired', onAuthFail);
    return () => {
      rfb.removeEventListener('connect', onConnect);
      rfb.removeEventListener('disconnect', onDisconnect);
      rfb.removeEventListener('securityfailure', onAuthFail);
      rfb.removeEventListener('credentialsrequired', onAuthFail);
      try { rfb.disconnect(); } catch { /* ignore */ }
      rfbRef.current = null;
    };
  }, [creds, connection, nonce]);

  const tapKey = (keysym: number) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.sendKey(keysym, '', true);
    rfb.sendKey(keysym, '', false);
  };

  async function submitCreds() {
    const next = { username: form.username.trim(), password: form.password };
    if (!next.username || !next.password) return;
    await saveVncCreds(store, next);
    setAuthFailed(false);
    setLoginOpen(false);
    setStatus('connecting');
    setCreds(next); // new ref → reconnect effect runs
  }

  if (!credsLoaded) {
    return (
      <div style={{ ...fill, alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 14 }}>
        Načítání…
      </div>
    );
  }

  // Show the macOS login when there are no credentials yet, or auth failed,
  // or the user explicitly asked to change them.
  if (!creds || loginOpen) {
    return (
      <div style={{ ...fill, alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gap: 10, width: '100%', maxWidth: 360 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#c4b8ff' }}>Přihlášení k obrazovce Macu</div>
          <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.4 }}>
            Zadejte <b>uživatelské jméno účtu macOS</b> (krátké jméno, např. „jan“ — ne Apple ID)
            a heslo, kterým se přihlašujete k Macu.
          </div>
          {authFailed && (
            <div role="alert" style={{
              padding: '8px 12px', borderRadius: 8, backgroundColor: '#2d1515',
              border: '1px solid #7f1d1d', color: '#fca5a5', fontSize: 13,
            }}>
              Přihlášení selhalo – zkontrolujte krátké jméno účtu macOS a heslo.
            </div>
          )}
          <input
            placeholder="krátké jméno účtu macOS (např. jan)"
            autoCapitalize="none"
            autoCorrect="off"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="heslo k Macu"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            style={inputStyle}
          />
          <button onClick={() => void submitCreds()} style={primaryBtn}>Připojit</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...fill, flexDirection: 'column' }}>
      {status !== 'connected' && (
        <div role="status" style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          padding: '6px 16px', textAlign: 'center', fontSize: 13,
          color: status === 'disconnected' ? '#fca5a5' : '#93c5fd',
          backgroundColor: status === 'disconnected' ? '#3b1f1f' : '#1e3a5f',
        }}>
          {status === 'connecting' && 'Připojuji k obrazovce Macu…'}
          {status === 'disconnected' && (
            <>
              <span>Odpojeno – zkontrolujte Sdílení obrazovky na Macu</span>
              <button onClick={() => setNonce((n) => n + 1)} style={ghostBtn}>Zkusit znovu</button>
              <button onClick={() => setLoginOpen(true)} style={ghostBtn}>Změnit přihlášení</button>
            </>
          )}
        </div>
      )}
      <div ref={screenRef} style={{ flex: 1, minHeight: 0 }} />
      <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: 8, backgroundColor: '#13141a', borderTop: '1px solid #2e3038' }}>
        <KeyBtn label="Esc" onPress={() => tapKey(VNC_KEYSYMS.esc)} />
        <KeyBtn label="Tab" onPress={() => tapKey(VNC_KEYSYMS.tab)} />
        <KeyBtn label="Ctrl" onPress={() => tapKey(VNC_KEYSYMS.ctrl)} />
        <KeyBtn label="Alt" onPress={() => tapKey(VNC_KEYSYMS.alt)} />
        <div style={{ flex: 1 }} />
        <KeyBtn label="Přihlášení" onPress={() => setLoginOpen(true)} />
      </div>
    </div>
  );
}

const fill: React.CSSProperties = { display: 'flex', height: '100%', backgroundColor: '#0e0f12' };

const inputStyle: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 8, border: '1px solid #2e3038',
  backgroundColor: '#1a1b1f', color: '#e5e7eb', fontSize: 14,
  fontFamily: 'system-ui, sans-serif', outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  padding: '10px 0', borderRadius: 8, border: 'none', backgroundColor: '#7c6df0',
  color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid #7f1d1d',
  backgroundColor: 'transparent', color: '#fca5a5', fontSize: 12, fontWeight: 600,
  WebkitTapHighlightColor: 'transparent',
};

function KeyBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button onClick={onPress} style={{
      padding: '8px 14px', borderRadius: 8, border: '1px solid #2e3038',
      backgroundColor: '#1a1b1f', color: '#e5e7eb', fontSize: 13, fontWeight: 600,
      WebkitTapHighlightColor: 'transparent',
    }}>{label}</button>
  );
}
