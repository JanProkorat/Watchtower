// apps/ipad/src/components/NotificationHub.tsx
import { glassPanel, glassCard, text, accent } from '../theme/glass.js';
import type { AttentionItem } from '../state/attentionList.js';

interface Props { items: AttentionItem[]; onSelect(instanceId: string): void; onClose(): void }

export function NotificationHub({ items, onSelect, onClose }: Props) {
  return (
    <>
      {/* click-away scrim — blurred dim per spec */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, zIndex: 20,
          background: 'rgba(6,7,11,0.45)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      />
      {/* frosted popover panel */}
      <div style={{
        position: 'absolute', top: 56, left: 8, zIndex: 21, width: 300, maxHeight: '60%', overflowY: 'auto',
        ...glassPanel({ radius: 16 }),
        padding: '14px 6px 8px',
      }}>
        {/* header row */}
        <div style={{
          display: 'flex', alignItems: 'center', marginBottom: 10, padding: '0 8px',
        }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: text.primary }}>Upozornění</span>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
              color: text.muted, fontSize: 16, lineHeight: 1,
              WebkitTapHighlightColor: 'transparent',
            }}
          >✕</button>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: '10px 12px', color: text.dim, fontSize: 13 }}>Žádná upozornění</div>
        ) : items.map((it) => (
          <button key={it.instanceId} onClick={() => onSelect(it.instanceId)} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10,
            border: 'none', cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
            /* glassCard-light row */
            ...glassCard(10),
            marginBottom: 4,
          }}>
            {/* amber glowing status dot */}
            <span style={{
              flexShrink: 0,
              width: 8, height: 8, borderRadius: '50%',
              background: '#f5a524',
              boxShadow: '0 0 8px #f5a524',
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
              <div style={{ fontSize: 12, color: text.muted }}>{it.reason}</div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
