import { useEffect, useRef, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import RFB from '@novnc/novnc/core/rfb.js';
import { useConnection } from '../state/connectionContext.js';
import { connectionToVncWsUrl, type Connection } from '../connection.js';
import { loadVncCreds, saveVncCreds, type VncCreds } from '../state/vncCreds.js';
import { WakeButton } from './WakeButton.js';
import { baseBg, statusGlass, glassPanel, text, ctaGradient, ctaGlow } from '../theme/glass.js';

// Capacitor Preferences-backed store (same shape as App's).
const store = {
  get: async (k: string) => (await Preferences.get({ key: k })).value,
  set: async (k: string, v: string) => { await Preferences.set({ key: k, value: v }); },
};

type VncStatus = 'connecting' | 'connected' | 'disconnected';

export function RemoteMacView({ connection, immersive, onToggleImmersive }: {
  connection: Connection;
  immersive: boolean;
  onToggleImmersive: () => void;
}) {
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
    rfb.background = baseBg;
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

  // Toggling immersive hides/shows the rail, so the screen container resizes
  // without a window resize. noVNC's scaleViewport only recomputes on window
  // 'resize', so nudge it once the layout has reflowed.
  useEffect(() => {
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    return () => clearTimeout(id);
  }, [immersive]);

  // In immersive mode also hide the iOS status bar (clock/battery) for a true
  // full-screen remote view. Restored on exit and on unmount. iOS only — on web
  // the plugin is a no-op we skip so dev builds don't warn.
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return;
    void (immersive ? StatusBar.hide() : StatusBar.show()).catch(() => { /* ignore */ });
    return () => { void StatusBar.show().catch(() => { /* ignore */ }); };
  }, [immersive]);

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
      <div style={{ ...fill, alignItems: 'center', justifyContent: 'center', color: text.muted, fontSize: 14 }}>
        Načítání…
      </div>
    );
  }

  // Show the macOS login when there are no credentials yet, or auth failed,
  // or the user explicitly asked to change them.
  if (!creds || loginOpen) {
    const err = statusGlass('disconnected');
    return (
      <div style={{ ...fill, alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
        <div style={{ ...glassPanel({ radius: 22 }), padding: 24, display: 'grid', gap: 12, width: '100%', maxWidth: 380 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: text.primary }}>Přihlášení k obrazovce Macu</div>
          <div style={{ fontSize: 13, color: text.muted, lineHeight: 1.45 }}>
            Zadejte <b>uživatelské jméno účtu macOS</b> (krátké jméno, např. „jan“ — ne Apple ID)
            a heslo, kterým se přihlašujete k Macu.
          </div>
          {authFailed && (
            <div role="alert" style={{
              ...err.panel, borderRadius: 12, padding: '9px 13px', color: err.accent, fontSize: 13,
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
    <div style={{ ...fill, flexDirection: 'column', position: 'relative' }}>
      {/* Screen area. In normal mode it's inset into a rounded glass panel like
          the terminal; in immersive (fullscreen) mode it goes edge-to-edge. */}
      <div style={{
        flex: 1, minHeight: 0, minWidth: 0, display: 'flex',
        padding: immersive ? 0 : '10px 12px 12px', boxSizing: 'border-box',
      }}>
        <div style={{
          flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', background: baseBg,
          ...(immersive ? null : {
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 10px 28px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)',
          }),
        }}>
          {/* touchAction:none stops the WebView from hijacking touch gestures so
              noVNC's own gesture handler gets them (two-finger drag = scroll). */}
          <div ref={screenRef} style={{ width: '100%', height: '100%', touchAction: 'none', overscrollBehavior: 'none' }} />
        </div>
      </div>

      {/* Floating glass status banner — overlays the screen (never pushes it),
          shown only while the VNC session isn't live. */}
      {status !== 'connected' && (
        <StatusBanner
          status={status}
          connection={connection}
          onRetry={() => setNonce((n) => n + 1)}
          onChangeLogin={() => setLoginOpen(true)}
        />
      )}

      {/* Fullscreen toggle — hides the app chrome so only the remote screen shows. */}
      <FullscreenButton immersive={immersive} onToggle={onToggleImmersive} />
    </div>
  );
}

// Top-right glass icon button that toggles immersive (fullscreen) mode.
function FullscreenButton({ immersive, onToggle }: { immersive: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={immersive ? 'Ukončit celou obrazovku' : 'Celá obrazovka'}
      style={{
        position: 'absolute', top: 16, right: 16, zIndex: 25,
        width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 12, border: '1px solid rgba(255,255,255,0.20)',
        background: 'rgba(20,22,32,0.55)', backdropFilter: 'blur(24px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.6)', color: text.primary,
        boxShadow: '0 8px 22px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent', padding: 0,
      }}
    >
      {immersive ? <CompressIcon /> : <ExpandIcon />}
    </button>
  );
}

function ExpandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function CompressIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

// Floating, centred glass pill that reports the VNC connection state. While
// disconnected it offers retry / change-login / wake; while connecting it is a
// quiet status line. Replaces the old solid red/blue bar.
function StatusBanner({ status, connection, onRetry, onChangeLogin }: {
  status: VncStatus;
  connection: Connection;
  onRetry: () => void;
  onChangeLogin: () => void;
}) {
  const g = statusGlass(status === 'disconnected' ? 'disconnected' : 'connecting');
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 20, maxWidth: 'calc(100% - 32px)',
        ...g.panel, borderRadius: 16, padding: '11px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
        color: g.accent, fontSize: 13, fontWeight: 600,
      }}
    >
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

const fill: React.CSSProperties = {
  display: 'flex', flex: 1, minWidth: 0, height: '100%', backgroundColor: 'transparent',
};

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
