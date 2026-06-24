import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc/core/rfb.js';
import { useConnection } from '../state/connectionContext.js';
import { connectionToVncWsUrl, type Connection } from '../connection.js';
import { VNC_KEYSYMS } from '../lib/vncKeys.js';

type VncStatus = 'connecting' | 'connected' | 'disconnected' | 'auth-failed';

export function RemoteMacView({ connection }: { connection: Connection }) {
  const { } = useConnection(); // ensures we're inside the provider
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [status, setStatus] = useState<VncStatus>('connecting');

  useEffect(() => {
    if (!screenRef.current) return;
    const url = `${connectionToVncWsUrl(connection)}?token=${encodeURIComponent(connection.token)}`;
    const rfb = new RFB(screenRef.current, url, {
      credentials: { password: connection.vncPassword ?? '' },
    });
    rfb.scaleViewport = true;
    rfb.background = '#0e0f12';
    rfbRef.current = rfb;
    setStatus('connecting');
    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onSecurityFailure = () => setStatus('auth-failed');
    rfb.addEventListener('connect', onConnect);
    rfb.addEventListener('disconnect', onDisconnect);
    rfb.addEventListener('securityfailure', onSecurityFailure);
    return () => {
      rfb.removeEventListener('connect', onConnect);
      rfb.removeEventListener('disconnect', onDisconnect);
      rfb.removeEventListener('securityfailure', onSecurityFailure);
      try { rfb.disconnect(); } catch { /* ignore */ }
      rfbRef.current = null;
    };
  }, [connection]);

  const tapKey = (keysym: number) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.sendKey(keysym, '', true);
    rfb.sendKey(keysym, '', false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0e0f12' }}>
      {status !== 'connected' && (
        <div role="status" style={{
          flexShrink: 0, padding: '6px 16px', textAlign: 'center', fontSize: 13,
          color: status === 'auth-failed' ? '#fca5a5' : '#93c5fd',
          backgroundColor: status === 'auth-failed' ? '#3b1f1f' : '#1e3a5f',
        }}>
          {status === 'connecting' && 'Připojuji k obrazovce Macu…'}
          {status === 'disconnected' && 'Odpojeno – zkontrolujte Sdílení obrazovky na Macu'}
          {status === 'auth-failed' && 'Nesprávné heslo pro sdílení obrazovky'}
        </div>
      )}
      <div ref={screenRef} style={{ flex: 1, minHeight: 0 }} />
      <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: 8, backgroundColor: '#13141a', borderTop: '1px solid #2e3038' }}>
        <KeyBtn label="Esc" onPress={() => tapKey(VNC_KEYSYMS.esc)} />
        <KeyBtn label="Tab" onPress={() => tapKey(VNC_KEYSYMS.tab)} />
        <KeyBtn label="Ctrl" onPress={() => tapKey(VNC_KEYSYMS.ctrl)} />
        <KeyBtn label="Alt" onPress={() => tapKey(VNC_KEYSYMS.alt)} />
      </div>
    </div>
  );
}

function KeyBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button onClick={onPress} style={{
      padding: '8px 14px', borderRadius: 8, border: '1px solid #2e3038',
      backgroundColor: '#1a1b1f', color: '#e5e7eb', fontSize: 13, fontWeight: 600,
      WebkitTapHighlightColor: 'transparent',
    }}>{label}</button>
  );
}
