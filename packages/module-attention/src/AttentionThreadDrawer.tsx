// packages/module-attention/src/AttentionThreadDrawer.tsx
//
// The reply-thread UI shown when the user taps a notification (D3). Renders
// the escalation thread — claude "snapshot" rows (the question Claude asked,
// plus its parsed quick-tap options) interleaved with the user's own replies
// — inside the shared adaptive BottomSheet, with a composer (option chips +
// free-text + Send) wired to useAttentionReply (C3). Plain React + inline
// styles + glass tokens (no MUI); ENGLISH user-facing strings.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { BottomSheet, dataPanelFill, text, accent, glassCard, ctaGradient, ctaGlow, type SheetAnchor } from '@watchtower/ui-core';
import { useAttentionReply, type AttentionThread, type AttentionMessage } from '@watchtower/data-supabase';

interface Props {
  thread: AttentionThread;
  onClose(): void;
  /** Present only on connected iPad — opens the live terminal for this instance. */
  openInTerminal?: (instanceId: string) => void;
  anchor?: SheetAnchor | null;
}

const field: CSSProperties = {
  background: 'rgba(255,255,255,0.07)', color: text.primary, border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 11, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
  outline: 'none', resize: 'vertical', minHeight: 60,
};

const chip: CSSProperties = {
  ...glassCard(999), padding: '6px 14px', fontSize: 13, fontWeight: 600, color: text.primary,
  cursor: 'pointer', fontFamily: 'inherit', border: '1px solid rgba(255,255,255,0.14)',
};

/** Find the syncId of the last `role==='claude'` message, or null when the thread has no claude row yet. */
function findLatestClaudeSyncId(messages: AttentionMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'claude') return m.syncId;
  }
  return null;
}

/** Find the last `role==='claude'` message itself (for its options), or null. */
function findLatestClaudeMessage(messages: AttentionMessage[]): AttentionMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'claude') return m;
  }
  return null;
}

export function AttentionThreadDrawer({ thread, onClose, openInTerminal, anchor }: Props): JSX.Element {
  const { sendReply, pending, error } = useAttentionReply();
  const [draft, setDraft] = useState('');

  const latestClaudeSyncId = findLatestClaudeSyncId(thread.messages);
  const latestClaudeMessage = findLatestClaudeMessage(thread.messages);
  const latestOptions = latestClaudeMessage?.options ?? [];

  const canSend = !pending && !thread.closed && latestClaudeSyncId != null;

  async function sendOption(optionNumber: number) {
    if (!canSend || latestClaudeSyncId == null) return;
    await sendReply(thread.instanceId, latestClaudeSyncId, String(optionNumber));
  }

  async function sendFreeText() {
    if (!canSend || latestClaudeSyncId == null) return;
    const t = draft.trim();
    if (t === '') return;
    const ok = await sendReply(thread.instanceId, latestClaudeSyncId, draft);
    if (ok) setDraft('');
  }

  return (
    <BottomSheet onClose={onClose} anchor={anchor}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: text.primary }}>{thread.label}</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: text.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '50vh', overflowY: 'auto' }}>
        {thread.messages.map((m) =>
          m.role === 'claude' ? (
            // Read-only snapshot of the question Claude asked. Quick-tap option
            // buttons live in the composer below (tied to the LATEST claude
            // row only) rather than per-row here: a reply always targets
            // latestClaudeSyncId, so buttons on a historical (already-answered
            // or superseded) row would be misleading dead controls.
            <div
              key={m.syncId}
              style={{
                background: dataPanelFill, borderRadius: 12, padding: '10px 12px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13,
                color: text.secondary, whiteSpace: 'pre-wrap', overflowX: 'auto',
              }}
            >
              <div style={{ fontWeight: 700, color: text.primary }}>{m.body}</div>
            </div>
          ) : (
            <div key={m.syncId} style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ background: ctaGradient, color: '#fff', borderRadius: 12, padding: '8px 12px', fontSize: 13.5, maxWidth: '80%', boxShadow: ctaGlow }}>
                {m.body}
              </div>
            </div>
          ),
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {latestOptions.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {latestOptions.map((o) => (
              <button key={o.number} onClick={() => sendOption(o.number)} disabled={!canSend} style={{ ...chip, opacity: canSend ? 1 : 0.5, cursor: canSend ? 'pointer' : 'default' }}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          style={field}
          placeholder="Write a reply…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canSend}
        />
        {error && <div style={{ fontSize: 12.5, color: '#f87171' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {openInTerminal && (
            <button
              onClick={() => openInTerminal(thread.instanceId)}
              style={{ height: 36, padding: '0 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: text.secondary, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.10)' }}
            >
              Open in terminal
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={sendFreeText}
            disabled={!canSend || draft.trim() === ''}
            style={{
              height: 38, padding: '0 16px', borderRadius: 11, border: 'none',
              background: canSend && draft.trim() !== '' ? ctaGradient : 'rgba(255,255,255,0.08)',
              color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
              cursor: canSend && draft.trim() !== '' ? 'pointer' : 'default',
              boxShadow: canSend && draft.trim() !== '' ? ctaGlow : 'none',
            }}
          >
            {pending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
