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

export interface GlassFillStyle {
  backgroundColor: string;
  border: string;
}

/**
 * Per-mode base fill RGB components and base opacity.
 *
 * These constants are the single source of truth for the glass fill color.
 * `theme.ts` imports them to set `palette.background.paper` so the two values
 * cannot drift independently:
 *   dark  paper → rgba(GLASS_FILL_DARK_RGB,  GLASS_FILL_DARK_OPACITY)
 *   light paper → rgba(GLASS_FILL_LIGHT_RGB, GLASS_FILL_LIGHT_OPACITY)
 */
export const GLASS_FILL_DARK_RGB = '60,64,86';
export const GLASS_FILL_DARK_OPACITY = 0.34;
export const GLASS_FILL_DARK_OPACITY_MAX = 0.72;

export const GLASS_FILL_LIGHT_RGB = '255,255,255';
export const GLASS_FILL_LIGHT_OPACITY = 0.50;
export const GLASS_FILL_LIGHT_OPACITY_MAX = 0.85;

/**
 * Shared internal: computes the fill color string for a given mode + elevation.
 * Used by both glassSurface and glassFill to keep the rgba math in one place.
 */
function computeGlassFill(isDark: boolean, elevation: number): string {
  const elevationOpacityBoost = elevation * 0.04;
  if (isDark) {
    const opacity = Math.min(GLASS_FILL_DARK_OPACITY + elevationOpacityBoost, GLASS_FILL_DARK_OPACITY_MAX);
    return `rgba(${GLASS_FILL_DARK_RGB},${opacity.toFixed(2)})`;
  } else {
    const opacity = Math.min(GLASS_FILL_LIGHT_OPACITY + elevationOpacityBoost, GLASS_FILL_LIGHT_OPACITY_MAX);
    return `rgba(${GLASS_FILL_LIGHT_RGB},${opacity.toFixed(2)})`;
  }
}

/**
 * Returns an sx-compatible CSS object that applies a frosted-glass surface.
 *
 * Design constraints:
 * - Inner CSS blur is capped at 22px for GPU cost. The OS vibrancy layer
 *   (under-window, 22–40px) is the primary blur source; this is supplementary.
 * - Fill color is derived from GLASS_FILL_DARK/LIGHT_RGB constants, which are
 *   also imported by theme.ts to set palette.background.paper — so the glass
 *   palette and MUI theme cannot drift.
 * - elevation scales fill opacity and shadow depth. Negative values are clamped
 *   to 0; there is no upper bound (opacity saturates at the per-mode max).
 *
 * Used by both MUI component overrides in theme.ts and inline sx props in
 * components added by later phases (B–G). Never hardcode blur/border in those
 * call sites — always go through this helper.
 */
export function glassSurface(theme: Theme, opts?: GlassSurfaceOptions): GlassSurfaceStyle {
  const elevation = Math.max(0, opts?.elevation ?? 0);
  const isDark = theme.palette.mode === 'dark';

  const fill = computeGlassFill(isDark, elevation);

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

/**
 * Use for elements that repeat many times (rows, cells, cards in a list) —
 * they sit over the already-blurred backdrop, so a second per-element
 * backdrop-filter only costs GPU without adding visible frosting benefit.
 *
 * Returns the same fill color and hairline border as glassSurface for the
 * given mode + elevation, but omits backdropFilter / WebkitBackdropFilter
 * and the inset shadow.
 */
export function glassFill(theme: Theme, opts?: GlassSurfaceOptions): GlassFillStyle {
  const elevation = Math.max(0, opts?.elevation ?? 0);
  const isDark = theme.palette.mode === 'dark';

  const fill = computeGlassFill(isDark, elevation);
  const borderColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,18,24,0.10)';

  return {
    backgroundColor: fill,
    border: `1px solid ${borderColor}`,
  };
}

// ---------------------------------------------------------------------------
// iPad "frosted-floating" chrome language (Instances rail + tab bars).
//
// These mirror the iPad app's Liquid Glass tokens (packages/ui-core/glass.ts /
// apps/ipad theme) but are THEME-AWARE — derived from theme.palette.primary and
// the mode — so the same look reads correctly in both light and dark mode.
// ---------------------------------------------------------------------------

/**
 * A floating rounded glass panel — the chrome material for the module rail and
 * floating bars. Same fill + blur as {@link glassSurface}, but with rounded
 * corners and a deeper soft drop shadow so the panel reads as lifted off the
 * OS vibrancy backdrop (matches the iPad rail's `glassPanel`).
 */
export function glassFloating(
  theme: Theme,
  opts?: { radius?: number; elevation?: number },
): GlassSurfaceStyle & { borderRadius: number } {
  const radius = opts?.radius ?? 18;
  const base = glassSurface(theme, { elevation: opts?.elevation ?? 1 });
  const isDark = theme.palette.mode === 'dark';
  const drop = isDark ? '0 18px 44px rgba(0,0,0,0.50)' : '0 12px 32px rgba(15,18,24,0.14)';
  const highlight = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.70)';
  return {
    ...base,
    borderRadius: radius,
    boxShadow: `inset 0 1px 0 ${highlight}, ${drop}`,
  };
}

// The purple wash + ring below mirror the tuned values the ModuleRail already
// uses inline (its active nav item), so the rail, instance TabStrip, and
// SessionTabBar all read as one consistent active-state language.

/** Translucent accent wash behind an active nav item / tab (iPad `accentWash`). */
export function accentWash(theme: Theme): string {
  return theme.palette.mode === 'dark' ? 'rgba(154,135,245,0.24)' : 'rgba(109,95,224,0.16)';
}

/** Ring highlight around an active nav item — inset top highlight + accent frame. */
export function accentRing(theme: Theme): string {
  const ring = theme.palette.mode === 'dark' ? 'rgba(154,135,245,0.30)' : 'rgba(109,95,224,0.25)';
  return `inset 0 1px 0 rgba(255,255,255,0.14), 0 0 0 1px ${ring}`;
}

/** Icon tint for an active nav item (iPad `accentIcon` → theme primary). */
export function accentIconColor(theme: Theme): string {
  return theme.palette.primary.main;
}

/** Text color for an active nav item / tab (white in dark, saturated primary in light). */
export function accentActiveText(theme: Theme): string {
  return theme.palette.mode === 'dark' ? '#ffffff' : theme.palette.primary.main;
}

/** Amber used for the attention (needs-input) status dot, matching the iPad. */
export const ATTENTION_AMBER = '#f5a524';

export type DotState = 'active' | 'attention' | 'idle';

/**
 * Glowing status dot for the instance / session tabs. `active` glows with the
 * project accent (falling back to the theme primary), `attention` glows amber,
 * and `idle` is a muted (or project-tinted) dot with no glow. Returned as an
 * sx-spreadable style object.
 */
export function statusDot(
  state: DotState,
  accent: string | undefined,
  theme: Theme,
): Record<string, string | number> {
  const base = { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 };
  if (state === 'attention') {
    return { ...base, backgroundColor: ATTENTION_AMBER, boxShadow: `0 0 8px ${ATTENTION_AMBER}` };
  }
  if (state === 'active') {
    const c = accent ?? theme.palette.primary.main;
    return { ...base, backgroundColor: c, boxShadow: `0 0 8px ${c}` };
  }
  const muted = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.28)' : 'rgba(15,18,24,0.28)';
  return { ...base, backgroundColor: accent ?? muted, boxShadow: 'none' };
}
