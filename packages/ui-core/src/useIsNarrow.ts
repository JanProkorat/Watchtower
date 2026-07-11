import { useEffect, useState } from 'react';

// Viewport-width breakpoint below which shared TimeTracker views opt into
// phone-width layout tweaks (stacking side-by-side inputs, wrapping KPI rows,
// slimmer grid columns). The iPad renders well above this, so gating every
// tweak on useIsNarrow() keeps the iPad layout byte-for-byte unchanged while
// the iPhone (portrait ~390–430px) gets the narrow variant.
export const NARROW_MAX_WIDTH = 480;

/**
 * True when the viewport is at most `maxWidth` px wide (default 480 — phone
 * portrait). SSR-safe (returns false when there's no `window`/`matchMedia`) and
 * updates on viewport changes via a matchMedia listener.
 */
export function useIsNarrow(maxWidth: number = NARROW_MAX_WIDTH): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [isNarrow, setIsNarrow] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    setIsNarrow(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return isNarrow;
}
