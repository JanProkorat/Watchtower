// apps/ipad/src/components/NotificationHub.tsx
import type { AttentionItem } from '../state/attentionList.js';

interface Props { items: AttentionItem[]; onSelect(instanceId: string): void; onClose(): void }

export function NotificationHub({ items, onSelect, onClose }: Props) {
  return (
    <>
      {/* click-away scrim */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 20 }} />
      <div style={{
        position: 'absolute', top: 56, left: 8, zIndex: 21, width: 280, maxHeight: '60%', overflowY: 'auto',
        background: '#13141a', border: '1px solid #2e3038', borderRadius: 10, padding: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}>
        {items.length === 0 ? (
          <div style={{ padding: 12, color: '#6b7280', fontSize: 13 }}>Žádná upozornění</div>
        ) : items.map((it) => (
          <button key={it.instanceId} onClick={() => onSelect(it.instanceId)} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8,
            border: 'none', background: 'transparent', color: '#e5e7eb', cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{it.label}</div>
            <div style={{ fontSize: 12, color: '#fca5a5' }}>{it.reason}</div>
          </button>
        ))}
      </div>
    </>
  );
}
