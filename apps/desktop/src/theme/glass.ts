import type { Theme } from '@mui/material/styles';

export interface GlassSurfaceOptions {
  /** 0 = base (default). Higher values slightly increase fill opacity and shadow. */
  elevation?: number;
}

export interface GlassSurfaceStyle {
  backgroundColor: string;
  backdropFilter: string;
  WebkitBackdropFilter: string;
  border: string;
  boxShadow: string;
}

/**
 * Returns an sx-compatible CSS object that applies a frosted-glass surface.
 *
 * Design constraints:
 * - Inner CSS blur is capped at 22px for GPU cost. The OS vibrancy layer
 *   (under-window, 22–40px) is the primary blur source; this is supplementary.
 * - Fill uses the theme's background.paper alpha value so the glass palette
 *   stays in sync with the MUI theme.
 * - elevation scales fill opacity and shadow depth linearly (0–4 range).
 *
 * Used by both MUI component overrides in theme.ts and inline sx props in
 * components added by later phases (B–G). Never hardcode blur/border in those
 * call sites — always go through this helper.
 */
export function glassSurface(theme: Theme, opts?: GlassSurfaceOptions): GlassSurfaceStyle {
  const elevation = Math.max(0, opts?.elevation ?? 0);
  const isDark = theme.palette.mode === 'dark';

  // Scale fill opacity with elevation (each step adds ~4% opacity).
  const elevationOpacityBoost = elevation * 0.04;

  // Base fill: theme.palette.background.paper is already set to an alpha value
  // in the themed palette (dark: rgba(60,64,86,0.34), light: rgba(255,255,255,0.50)).
  // We use it directly and boost opacity for higher elevations.
  // For elevation > 0, we construct a slightly more opaque version.
  let fill: string;
  if (isDark) {
    const opacity = Math.min(0.34 + elevationOpacityBoost, 0.72);
    fill = `rgba(60,64,86,${opacity.toFixed(2)})`;
  } else {
    const opacity = Math.min(0.50 + elevationOpacityBoost, 0.85);
    fill = `rgba(255,255,255,${opacity.toFixed(2)})`;
  }

  // Hairline border: light top edge highlight + subtle frame.
  const borderColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,18,24,0.10)';

  // Inset top highlight creates depth (simulates the glass rim catching light).
  const highlightColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.60)';
  // Shadow: stronger for higher elevations.
  const shadowAlpha = isDark ? (0.20 + elevation * 0.05) : (0.06 + elevation * 0.03);
  const shadowBlur = 8 + elevation * 6;
  const shadowColor = isDark
    ? `rgba(0,0,0,${shadowAlpha.toFixed(2)})`
    : `rgba(15,18,24,${shadowAlpha.toFixed(2)})`;

  return {
    backgroundColor: fill,
    // Inner CSS blur is capped at 22px — GPU cost guard (spec §Architecture 1).
    backdropFilter: 'blur(22px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
    border: `1px solid ${borderColor}`,
    boxShadow: `inset 0 1px 0 ${highlightColor}, 0 ${elevation > 0 ? elevation * 2 : 2}px ${shadowBlur}px ${shadowColor}`,
  };
}
