// apps/ipad/src/components/PullToRefresh.tsx
//
// Lightweight pull-to-refresh for the touch (iPad) UI — no external dependency.
// Wraps its own scroll container; when the user drags down while already at the
// top, it reveals a glass spinner and calls `onRefresh()` once past the
// threshold. `onRefresh` should resolve when the refetch settles so the spinner
// retracts. The touchmove listener is attached non-passive so we can
// preventDefault the iOS rubber-band while pulling.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { text, accentIcon } from '@watchtower/ui-core';

const THRESHOLD = 70; // px of pull (after resistance) needed to trigger
const MAX = 96; // px cap on the indicator travel
const RESISTANCE = 0.5;

export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Latest values for the non-passive native handlers (which close over refs).
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  pullRef.current = pull;
  refreshingRef.current = refreshing;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      const touch = e.touches[0];
      startY.current = touch && el.scrollTop <= 0 ? touch.clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current == null || refreshingRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dy = touch.clientY - startY.current;
      if (dy <= 0) {
        if (pullRef.current !== 0) setPull(0);
        return;
      }
      // We're pulling down from the top — take over the gesture so iOS doesn't
      // rubber-band the whole webview.
      e.preventDefault();
      setPull(Math.min(MAX, dy * RESISTANCE));
    };
    const onEnd = () => {
      if (startY.current == null) return;
      startY.current = null;
      if (pullRef.current >= THRESHOLD && !refreshingRef.current) {
        setRefreshing(true);
        setPull(THRESHOLD * 0.7);
        void onRefresh().finally(() => {
          setRefreshing(false);
          setPull(0);
        });
      } else {
        setPull(0);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [onRefresh]);

  const active = pull > 0 || refreshing;

  return (
    <div
      ref={scrollRef}
      style={{
        height: '100%',
        overflowY: 'auto',
        overscrollBehaviorY: 'contain',
        WebkitOverflowScrolling: 'touch',
        position: 'relative',
      }}
    >
      {/* Pull indicator — occupies the revealed gap above the content. */}
      <div
        style={{
          height: pull,
          marginTop: refreshing ? 8 : 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          transition: active ? 'none' : 'height 0.2s ease, margin-top 0.2s ease',
          color: text.muted,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.15)',
            borderTopColor: accentIcon,
            opacity: active ? 1 : 0,
            transform: refreshing ? undefined : `rotate(${Math.min(1, pull / THRESHOLD) * 270}deg)`,
            animation: refreshing ? 'ptr-spin 0.7s linear infinite' : undefined,
          }}
          aria-hidden
        />
        <style>{`@keyframes ptr-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
      {children}
    </div>
  );
}
