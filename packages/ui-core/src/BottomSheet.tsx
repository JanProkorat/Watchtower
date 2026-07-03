import type { CSSProperties, ReactNode } from 'react';
import { glassPanel, glassFillStrong } from './glass.js';

// Appear animation: the panel slides up from the bottom edge while the scrim
// fades in. Keyframes are injected with the sheet (the PullToRefresh pattern)
// so the animation ships with this shared component into every app — no
// per-app global CSS needed. Duplicate @keyframes across mounts are harmless
// (only one sheet is open at a time, and the rules are identical). Honors
// prefers-reduced-motion by disabling both animations.
const SHEET_ANIM_CSS = `
@keyframes wt-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes wt-scrim-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .wt-sheet-panel { animation: none !important; }
  .wt-sheet-scrim { animation: none !important; }
}
`;

/**
 * Shared modal bottom sheet: a blurred scrim that fades in + a frosted-glass
 * panel that slides up from the bottom. Tapping the scrim calls onClose; taps
 * inside the panel are swallowed. Pass `style` to extend/override the panel
 * (e.g. gap, border) — it is spread last so callers win.
 */
export function BottomSheet({ onClose, children, style }: {
  onClose(): void;
  children: ReactNode;
  style?: CSSProperties;
}): JSX.Element {
  const panel: CSSProperties = {
    ...glassPanel({ radius: 20, fill: glassFillStrong, blur: 40, saturate: 1.9, brightness: 1.1 }),
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    border: '1px solid rgba(255,255,255,0.20)',
    borderBottom: 'none',
    boxShadow: '0 -20px 60px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.30)',
    width: '100%',
    maxHeight: '85vh',
    overflowY: 'auto',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    animation: 'wt-sheet-up 260ms cubic-bezier(0.32,0.72,0,1)',
    willChange: 'transform',
    ...style,
  };
  return (
    <div
      className="wt-sheet-scrim"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,7,11,0.45)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-end',
        animation: 'wt-scrim-in 200ms ease',
      }}
    >
      <style>{SHEET_ANIM_CSS}</style>
      <div className="wt-sheet-panel" onClick={(e) => e.stopPropagation()} style={panel}>
        {children}
      </div>
    </div>
  );
}
