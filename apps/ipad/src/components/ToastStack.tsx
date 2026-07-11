// apps/ipad/src/components/ToastStack.tsx
//
// Floating status toasts, stacked in the top-right corner. They OVERLAY content
// and never affect layout — rendered absolutely inside a position:relative
// parent, so a banner appearing never pushes the rail/terminal/billing content
// down. Persistent states (auth-block, disconnected) stay until resolved;
// transient ones (connecting) are driven by the caller's state. Coexists with
// the bottom-right connection pill.
import type { ReactNode } from 'react';
import { statusGlass, type StatusState } from '@watchtower/ui-core';

export interface ToastItem {
  id: string;
  state: StatusState;
  title: string;
  subtitle?: string;
  /** Optional inline action (e.g. a button or the WakeButton). */
  action?: ReactNode;
  /** When set, renders a ✕ that calls this. */
  onClose?: () => void;
}

export function ToastStack({ items }: { items: ToastItem[] }) {
  if (items.length === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: 320,
        maxWidth: 'calc(100% - 32px)',
        // The container is click-through; individual toasts re-enable pointer
        // events so the surface beneath stays interactive around them.
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => {
        const g = statusGlass(t.state);
        return (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            style={{
              ...g.panel,
              borderRadius: 13,
              padding: '11px 14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              color: g.accent,
              fontSize: 12,
              fontWeight: 500,
              pointerEvents: 'auto',
              boxShadow: '0 18px 46px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.18)',
            }}
          >
            <span style={{ ...g.dot, marginTop: 4, flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{t.title}</span>
              {t.subtitle && <span style={{ opacity: 0.85, fontWeight: 400 }}>{t.subtitle}</span>}
              {t.action && <div style={{ marginTop: 8 }}>{t.action}</div>}
            </div>
            {t.onClose && (
              <button
                onClick={t.onClose}
                aria-label="Zavřít"
                style={{
                  marginLeft: 4,
                  border: 'none',
                  background: 'transparent',
                  color: g.accent,
                  opacity: 0.65,
                  fontSize: 14,
                  lineHeight: 1.1,
                  padding: 0,
                  cursor: 'pointer',
                  flexShrink: 0,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
