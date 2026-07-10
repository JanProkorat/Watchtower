import type React from 'react';
import { parseConnection, type ConnectionFormState } from '../connection.js';
import { WakeButton } from './WakeButton.js';
import { text } from '@watchtower/ui-core';

export const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 11,
  border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)',
  color: text.primary, fontSize: 15, outline: 'none', WebkitAppearance: 'none',
};

export function ConnectionFields({ form, onChange }: {
  form: ConnectionFormState;
  onChange: (f: ConnectionFormState) => void;
}): JSX.Element {
  const set = (patch: Partial<ConnectionFormState>) => onChange({ ...form, ...patch });
  const parsed = parseConnection(form);
  const wakeConnection = parsed.ok
    ? parsed.value
    : { host: form.host, port: 0, token: form.token,
        mac: form.mac.trim() || undefined, lanIp: form.lanIp.trim() || undefined,
        wanHost: form.wanHost.trim() || undefined,
        wanPort: form.wanPort.trim() ? Number(form.wanPort) : undefined };
  return (
    <>
      <input placeholder="Host Macu (LAN IP nebo Tailscale název)" value={form.host}
        onChange={(e) => set({ host: e.target.value })} style={inputStyle} />
      <input placeholder="port" value={form.port}
        onChange={(e) => set({ port: e.target.value })} style={inputStyle} />
      <input placeholder="token" type="password" value={form.token}
        onChange={(e) => set({ token: e.target.value })} style={inputStyle} />
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', margin: '6px 0', paddingTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: text.muted, marginBottom: 8 }}>Probuzení (Wake-on-LAN)</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <input placeholder="MAC adresa (AA:BB:CC:DD:EE:FF)" value={form.mac}
            onChange={(e) => set({ mac: e.target.value })} style={inputStyle} />
          <input placeholder="LAN IP Macu (doma)" value={form.lanIp}
            onChange={(e) => set({ lanIp: e.target.value })} style={inputStyle} />
          <input placeholder="DDNS host (mimo síť)" value={form.wanHost}
            onChange={(e) => set({ wanHost: e.target.value })} style={inputStyle} />
          <input placeholder="DDNS port (výchozí 9)" value={form.wanPort}
            onChange={(e) => set({ wanPort: e.target.value })} style={inputStyle} />
          <WakeButton connection={wakeConnection} />
        </div>
      </div>
    </>
  );
}
