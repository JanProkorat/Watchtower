// packages/module-attention/src/NotificationHub.tsx
//
// Shared presentational popover for the attention/notification bell feed.
// Ported from apps/ipad/src/components/NotificationHub.tsx — same click-away
// scrim + frosted popover + list-of-rows layout — but consumes BellItem (D1's
// merge output) instead of the iPad-local AttentionItem, and uses ENGLISH
// user-facing strings. Plain React + inline CSSProperties (no MUI); glass
// treatment comes from @watchtower/ui-core.
import type { CSSProperties } from 'react';
import { glassPanel, glassCard, text, accent, accentIcon } from '@watchtower/ui-core';
import type { BellItem } from './mergeAttention.js';

interface Props {
  items: BellItem[];
  onSelect(instanceId: string): void;
  onClose(): void;
}

/** Amber for permission gates. */
const AMBER = '#f5a524';
/** Red for crashes. */
const RED = '#f87171';

interface KindStyle {
  /** Glowing status-dot / accent colour for the row. */
  color: string;
  /** Leading glyph. */
  glyph: string;
}

/** Map a BellItem.kind onto its header glyph + accent colour. */
function kindStyle(kind: string | null): KindStyle {
  switch (kind) {
    case 'waiting-permission':
      return { color: AMBER, glyph: '⌘' };
    case 'crashed':
      return { color: RED, glyph: '⚠' };
    case 'idle-notify':
    case 'waiting-input':
      return { color: accent, glyph: '💬' };
    default:
      return { color: accent, glyph: '💬' };
  }
}

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
          <span style={{ fontWeight: 600, fontSize: 13, color: text.primary }}>Notifications</span>
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
          <div style={{ padding: '10px 12px', color: text.dim, fontSize: 13 }}>No notifications</div>
        ) : items.map((it) => {
          const ks = kindStyle(it.kind);
          const rowStyle: CSSProperties = {
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10,
            border: 'none', cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
            /* glassCard-light row */
            ...glassCard(10),
            marginBottom: 4,
          };
          return (
            <button key={it.instanceId} onClick={() => onSelect(it.instanceId)} style={rowStyle}>
              {/* kind glyph + glowing status dot in the kind's accent colour */}
              <span style={{
                flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, fontSize: 13, lineHeight: 1,
                color: it.kind === 'waiting-permission' ? ks.color : accentIcon,
                textShadow: `0 0 8px ${ks.color}`,
              }}>{ks.glyph}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
                <div style={{ fontSize: 12, color: text.muted }}>{it.reason}</div>
              </div>
              {/* trailing glowing status dot in the kind accent */}
              <span style={{
                flexShrink: 0,
                width: 8, height: 8, borderRadius: '50%',
                background: ks.color,
                boxShadow: `0 0 8px ${ks.color}`,
              }} />
            </button>
          );
        })}
      </div>
    </>
  );
}
