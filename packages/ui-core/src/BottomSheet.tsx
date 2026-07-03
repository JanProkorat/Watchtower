import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { glassPanel, glassFillStrong } from './glass.js';
import { useIsNarrow } from './useIsNarrow.js';

// A viewport-relative rect of the element that triggered the sheet. On iPad the
// sheet renders as a popover anchored to this; capture it at the tap with
// anchorFromEvent(e).
export interface SheetAnchor { top: number; left: number; width: number; height: number; }

export function anchorFromEvent(e: { currentTarget: Element }): SheetAnchor {
  const r = e.currentTarget.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

// Keyframes ship with the component (the PullToRefresh pattern) so they work in
// every app without per-app global CSS. Honors prefers-reduced-motion.
const ANIM_CSS = `
@keyframes wt-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes wt-scrim-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes wt-pop-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .wt-sheet-panel, .wt-sheet-scrim { animation: none !important; }
}
/* WebKit (iOS) centers date-input values by default and gives the control an
   intrinsic min-width that won't shrink — so in a narrow popover it overflows
   the panel. Left-align the value and let it shrink to its container. */
.wt-sheet-panel input[type="date"] { -webkit-appearance: none; appearance: none; display: block; text-align: left; min-width: 0; max-width: 100%; width: 100%; box-sizing: border-box; }
.wt-sheet-panel input[type="date"]::-webkit-date-and-time-value { text-align: left; }
.wt-sheet-panel input[type="date"]::-webkit-datetime-edit { text-align: left; padding: 0; }
`;

const POP_W = 360;   // popover width cap (px)
const MARGIN = 12;   // min gap from the viewport edge
const GAP = 10;      // gap between anchor and popover

const baseGlass = (): CSSProperties => glassPanel({ radius: 20, fill: glassFillStrong, blur: 40, saturate: 1.9, brightness: 1.1 });

/**
 * Adaptive modal surface. iPhone (narrow) → bottom sheet that slides up. iPad
 * (wide) → a popover anchored to `anchor` (the tapped element); if no anchor is
 * given it falls back to a centered form-sheet card. Tapping outside calls
 * onClose; taps inside are swallowed. `style` extends/overrides the panel.
 */
export function BottomSheet({ onClose, children, style, anchor }: {
  onClose(): void;
  children: ReactNode;
  style?: CSSProperties;
  anchor?: SheetAnchor | null;
}): JSX.Element {
  const isNarrow = useIsNarrow();
  const mode: 'sheet' | 'popover' | 'center' = isNarrow ? 'sheet' : anchor ? 'popover' : 'center';
  const panelRef = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<{ left: number; top: number; arrowLeft: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    if (mode !== 'popover' || !anchor) return;
    function place(): void {
      const el = panelRef.current;
      if (!el) return;
      const pw = el.offsetWidth;
      const ph = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = anchor!.left + anchor!.width / 2 - pw / 2;
      left = Math.max(MARGIN, Math.min(left, vw - pw - MARGIN));
      let below = true;
      let top = anchor!.top + anchor!.height + GAP;
      if (top + ph > vh - MARGIN) {
        const above = anchor!.top - ph - GAP;
        if (above >= MARGIN) {
          top = above;
          below = false;
        } else {
          // Neither side fits (very tall popover / short viewport): clamp to the
          // bottom edge and point the arrow toward whichever half the anchor sits in.
          top = Math.max(MARGIN, vh - ph - MARGIN);
          below = anchor!.top <= vh / 2;
        }
      }
      const arrowLeft = Math.max(14, Math.min(pw - 28, anchor!.left + anchor!.width / 2 - left - 7));
      setPop({ left, top, arrowLeft, below });
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [mode, anchor]);

  if (mode === 'popover') {
    const panelStyle: CSSProperties = {
      ...baseGlass(),
      position: 'fixed',
      left: pop?.left ?? -9999,
      top: pop?.top ?? -9999,
      width: `min(${POP_W}px, calc(100vw - ${MARGIN * 2}px))`,
      maxHeight: '78vh',
      overflowY: 'auto',
      borderRadius: 16,
      border: '1px solid rgba(255,255,255,0.20)',
      boxShadow: '0 18px 44px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.30)',
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      zIndex: 101,
      visibility: pop ? 'visible' : 'hidden',
      animation: 'wt-pop-in 160ms ease-out',
      transformOrigin: pop?.below ? 'top center' : 'bottom center',
      ...style,
    };
    return (
      <>
        {/* Transparent catcher: click-outside dismiss, no heavy scrim (popover feel). */}
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(6,7,11,0.12)' }} />
        <style>{ANIM_CSS}</style>
        <div ref={panelRef} className="wt-sheet-panel" onClick={(e) => e.stopPropagation()} style={panelStyle}>
          {pop && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: pop.arrowLeft,
                [pop.below ? 'top' : 'bottom']: -7,
                width: 14,
                height: 14,
                background: glassFillStrong,
                borderLeft: '1px solid rgba(255,255,255,0.20)',
                borderTop: '1px solid rgba(255,255,255,0.20)',
                transform: pop.below ? 'rotate(45deg)' : 'rotate(225deg)',
              } as CSSProperties}
            />
          )}
          {children}
        </div>
      </>
    );
  }

  // sheet (iPhone) + center (iPad fallback): blurred scrim, panel differs only in placement/shape.
  const scrim: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(6,7,11,0.45)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    zIndex: 100,
    display: 'flex',
    alignItems: mode === 'center' ? 'center' : 'flex-end',
    justifyContent: 'center',
    animation: 'wt-scrim-in 200ms ease',
  };
  const panelStyle: CSSProperties =
    mode === 'center'
      ? {
          ...baseGlass(),
          width: 'min(460px, calc(100vw - 40px))',
          maxHeight: '85vh',
          overflowY: 'auto',
          borderRadius: 22,
          border: '1px solid rgba(255,255,255,0.20)',
          boxShadow: '0 18px 44px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.30)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          animation: 'wt-pop-in 200ms cubic-bezier(0.32,0.72,0,1)',
          ...style,
        }
      : {
          ...baseGlass(),
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
    <div className="wt-sheet-scrim" onClick={onClose} style={scrim}>
      <style>{ANIM_CSS}</style>
      <div className="wt-sheet-panel" onClick={(e) => e.stopPropagation()} style={panelStyle}>
        {children}
      </div>
    </div>
  );
}
