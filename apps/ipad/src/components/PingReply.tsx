// apps/ipad/src/components/PingReply.tsx
// Banner shown when an instance sends an attentionPing. Displays the ping
// title + body, a text field, and an "Odpovědět" button that invokes
// messaging:reply. Clears on success; shows a Czech error on failure.

import { useState } from 'react';
import { useConnection } from '../state/connectionContext.js';
import type { Ping } from '../state/pingStore.js';

interface Props {
  ping: Ping;
  onClear: () => void;
}

export function PingReply({ ping, onClear }: Props) {
  const { bridge } = useConnection();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleReply() {
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await bridge.invoke('messaging:reply', {
        instanceId: ping.instanceId,
        text: text.trim(),
      }) as { ok: boolean };
      if (res.ok) {
        onClear();
      } else {
        setError('Instance už neběží');
      }
    } catch {
      setError('Instance už neběží');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="status"
      style={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 16px',
        backgroundColor: '#1e1640',
        borderBottom: '1px solid #4f46ba',
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#c4b8ff', marginBottom: 2 }}>
            {ping.title}
          </div>
          <div style={{ fontSize: 13, color: '#a5b4fc', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {ping.body}
          </div>
        </div>
        {/* Dismiss button */}
        <button
          onClick={onClear}
          aria-label="Zavřít"
          style={{
            flexShrink: 0,
            padding: '2px 8px',
            borderRadius: 6,
            border: '1px solid #4f46ba',
            backgroundColor: 'transparent',
            color: '#9ca3af',
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          ✕
        </button>
      </div>

      {/* Reply row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleReply(); }}
          placeholder="Odpověď…"
          disabled={sending}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #4f46ba',
            backgroundColor: '#13121e',
            color: '#e5e7eb',
            fontSize: 14,
            fontFamily: 'system-ui, sans-serif',
            outline: 'none',
          }}
        />
        <button
          onClick={() => void handleReply()}
          disabled={sending || !text.trim()}
          style={{
            flexShrink: 0,
            padding: '8px 14px',
            borderRadius: 8,
            border: 'none',
            backgroundColor: sending || !text.trim() ? '#4b4a72' : '#7c6df0',
            color: sending || !text.trim() ? '#9ca3af' : '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: sending || !text.trim() ? 'not-allowed' : 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {sending ? 'Odesílám…' : 'Odpovědět'}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div
          role="alert"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            backgroundColor: '#2d1515',
            border: '1px solid #7f1d1d',
            color: '#fca5a5',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
