// apps/ipad/src/theme/glass.ts
//
// Liquid Glass design tokens for the iPad app — the single source of truth for
// the approved "frosted-floating" material language (spec
// docs/superpowers/specs/2026-06-25-ipad-liquid-glass-redesign-design.md).
//
// Dark-only. This is a CSS approximation of native Liquid Glass: blur +
// saturation + brightness + a hairline highlight border + elevation shadow.
//
// iOS 15 / Capacitor WKWebView requires the `-webkit-` prefix for
// `backdrop-filter`, so EVERY helper here emits BOTH `backdropFilter` and
// `WebkitBackdropFilter`. Components import from this module rather than
// copy-pasting magic numbers; tuning (frost strength, float, accent) happens
// here in one place.
import type { CSSProperties } from 'react';

// ── Base / ambient ────────────────────────────────────────────────────────

/** Near-black app base. Body stays this colour to avoid a white flash on load. */
export const baseBg = '#0b0c11';

/**
 * The ambient lit background — a faint brand-coloured glow (purple TL, cyan TR,
 * teal BR) over near-black, applied once behind everything (index.css `#root`).
 * Keep `index.css` in sync with this string.
 */
export const ambientBackground =
  'radial-gradient(60% 55% at 4% 0%, rgba(124,109,240,0.34), transparent 60%), ' +
  'radial-gradient(70% 65% at 100% 8%, rgba(77,208,225,0.22), transparent 55%), ' +
  'radial-gradient(85% 85% at 88% 100%, rgba(26,188,156,0.26), transparent 55%), ' +
  baseBg;

// ── Accents ────────────────────────────────────────────────────────────────

export const accent = '#7c6df0';
export const accentHover = '#a89cf0';
/** Icon colour for an active nav item. */
export const accentIcon = '#c9bdff';
/** Translucent purple wash behind an active nav item / tab. */
export const accentWash = 'rgba(168,156,240,0.22)';

/** Primary CTA — purple gradient + soft glow. */
export const ctaGradient = 'linear-gradient(135deg, #8b7cf2, #6d5fe0)';
export const ctaGlow = '0 8px 22px rgba(124,109,240,0.45), inset 0 1px 0 rgba(255,255,255,0.35)';

// ── Text ────────────────────────────────────────────────────────────────────

export const text = {
  primary: '#e5e7eb',
  secondary: '#c2c9d8',
  muted: '#9aa1ab',
  dim: '#5a6072',
} as const;

// ── Glass fill + builders ────────────────────────────────────────────────────

/** Default frosted-panel fill (rail, tab strip). */
export const glassFill = 'rgba(48,52,76,0.34)';
/** Stronger fill for modals / drawers that float over a scrim. */
export const glassFillStrong = 'rgba(56,60,86,0.55)';

const hairline = '1px solid rgba(255,255,255,0.15)';
const highlight = 'inset 0 1px 0 rgba(255,255,255,0.30)';

export interface GlassPanelOpts {
  /** Corner radius (rail 20, tab strip 14, modal 22, card 16). */
  radius?: number;
  /** Blur radius in px — keep ≤ 34 for iPad GPU budget (see spec perf note). */
  blur?: number;
  saturate?: number;
  brightness?: number;
  fill?: string;
  border?: string;
  shadow?: string;
}

/**
 * A frosted floating glass panel. Always sets both `backdropFilter` and
 * `WebkitBackdropFilter`. Tune frost/float via opts; defaults match the spec's
 * rail/tab-strip panel.
 */
export function glassPanel(opts: GlassPanelOpts = {}): CSSProperties {
  const {
    radius = 20,
    blur = 34,
    saturate = 1.8,
    brightness = 1.18,
    fill = glassFill,
    border = hairline,
    shadow = `0 18px 44px rgba(0,0,0,0.5), ${highlight}`,
  } = opts;
  const filter = `blur(${blur}px) saturate(${saturate}) brightness(${brightness})`;
  return {
    background: fill,
    backdropFilter: filter,
    WebkitBackdropFilter: filter,
    border,
    borderRadius: radius,
    boxShadow: shadow,
  };
}

/**
 * Lighter frosted card for content surfaces — KPI / contract / summary tiles,
 * list cards, and chart frames. Softer blur + shadow than the chrome panel so
 * data sits calmly on it.
 */
export function glassCard(radius = 16): CSSProperties {
  return glassPanel({
    radius,
    blur: 28,
    saturate: 1.7,
    brightness: 1.14,
    border: '1px solid rgba(255,255,255,0.10)',
    shadow: '0 10px 28px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.20)',
  });
}

/**
 * Near-solid fill for DENSE data panels (worklog ledger, task grid). Dense
 * numbers stay legible over the ambient background instead of being frosted —
 * apply this to the table/grid wrapper, not the card frame around it.
 */
export const dataPanelFill = 'rgba(14,15,23,0.62)';

// ── Status (banners / pill) ──────────────────────────────────────────────────

export type StatusState = 'connected' | 'connecting' | 'disconnected' | 'authBlock';

const STATUS: Record<StatusState, { fill: string; border: string; accent: string }> = {
  connected: { fill: 'rgba(26,90,66,0.34)', border: 'rgba(120,230,180,0.32)', accent: '#34d399' },
  connecting: { fill: 'rgba(20,52,92,0.45)', border: 'rgba(96,165,250,0.45)', accent: '#60a5fa' },
  disconnected: { fill: 'rgba(110,24,24,0.40)', border: 'rgba(248,113,113,0.45)', accent: '#f87171' },
  authBlock: { fill: 'rgba(120,82,8,0.40)', border: 'rgba(245,165,36,0.45)', accent: '#f5a524' },
};

export interface StatusGlass {
  /** Panel style for the banner / pill — includes both backdrop-filter props. */
  panel: CSSProperties;
  /** The state's accent colour (text + glowing dot). */
  accent: string;
  /** Style for the small glowing status dot. */
  dot: CSSProperties;
}

/** Glass treatment for a connection/auth status banner or pill. */
export function statusGlass(state: StatusState): StatusGlass {
  const s = STATUS[state];
  const filter = 'blur(24px) saturate(1.6)';
  return {
    panel: {
      background: s.fill,
      backdropFilter: filter,
      WebkitBackdropFilter: filter,
      border: `1px solid ${s.border}`,
      boxShadow: '0 8px 22px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
    },
    accent: s.accent,
    dot: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: s.accent,
      boxShadow: `0 0 8px ${s.accent}`,
    },
  };
}
