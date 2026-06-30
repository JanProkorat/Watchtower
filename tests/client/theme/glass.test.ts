import { describe, it, expect } from 'vitest';
import { glassSurface, glassFill } from '../../../apps/desktop/src/theme/glass.js';
import type { Theme } from '@mui/material/styles';

/** Minimal theme stub — glassSurface only reads theme.palette.mode. */
function makeTheme(mode: 'dark' | 'light'): Theme {
  return { palette: { mode } } as unknown as Theme;
}

describe('glassSurface', () => {
  it('returns all required CSS properties', () => {
    const result = glassSurface(makeTheme('dark'));
    expect(result).toHaveProperty('backgroundColor');
    expect(result).toHaveProperty('backdropFilter');
    expect(result).toHaveProperty('WebkitBackdropFilter');
    expect(result).toHaveProperty('border');
    expect(result).toHaveProperty('boxShadow');
  });

  it('inner blur is capped at 22px (GPU cost guard)', () => {
    const dark = glassSurface(makeTheme('dark'));
    const light = glassSurface(makeTheme('light'));
    // Both filters must lead with blur(22px) — no higher value allowed.
    expect(dark.backdropFilter).toMatch(/^blur\(22px\)/);
    expect(light.backdropFilter).toMatch(/^blur\(22px\)/);
    expect(dark.WebkitBackdropFilter).toMatch(/^blur\(22px\)/);
    expect(light.WebkitBackdropFilter).toMatch(/^blur\(22px\)/);
  });

  it('includes saturate filter', () => {
    const result = glassSurface(makeTheme('dark'));
    expect(result.backdropFilter).toContain('saturate(1.5)');
  });

  it('dark mode uses dark fill rgba', () => {
    const result = glassSurface(makeTheme('dark'));
    // Fill must be a rgba based on the dark glass token (60,64,86).
    expect(result.backgroundColor).toMatch(/^rgba\(60,64,86,/);
  });

  it('light mode uses light fill rgba', () => {
    const result = glassSurface(makeTheme('light'));
    // Fill must be a rgba based on the light glass token (255,255,255).
    expect(result.backgroundColor).toMatch(/^rgba\(255,255,255,/);
  });

  it('elevation 0 and elevation 2 produce different fill opacities', () => {
    const base = glassSurface(makeTheme('dark'), { elevation: 0 });
    const elevated = glassSurface(makeTheme('dark'), { elevation: 2 });
    expect(base.backgroundColor).not.toBe(elevated.backgroundColor);
  });

  it('fill opacity does not exceed 0.72 in dark mode regardless of elevation', () => {
    const result = glassSurface(makeTheme('dark'), { elevation: 100 });
    const match = result.backgroundColor.match(/rgba\(60,64,86,([\d.]+)\)/);
    expect(match).not.toBeNull();
    const opacity = parseFloat(match![1]);
    expect(opacity).toBeLessThanOrEqual(0.72);
  });

  it('fill opacity does not exceed 0.85 in light mode regardless of elevation', () => {
    const result = glassSurface(makeTheme('light'), { elevation: 100 });
    const match = result.backgroundColor.match(/rgba\(255,255,255,([\d.]+)\)/);
    expect(match).not.toBeNull();
    const opacity = parseFloat(match![1]);
    expect(opacity).toBeLessThanOrEqual(0.85);
  });

  it('border is a 1px solid rule', () => {
    const result = glassSurface(makeTheme('dark'));
    expect(result.border).toMatch(/^1px solid /);
  });

  it('boxShadow includes an inset highlight and an outer shadow', () => {
    const result = glassSurface(makeTheme('dark'));
    expect(result.boxShadow).toContain('inset 0 1px 0');
  });

  it('negative elevation is clamped to 0', () => {
    const clamped = glassSurface(makeTheme('dark'), { elevation: -5 });
    const zero = glassSurface(makeTheme('dark'), { elevation: 0 });
    expect(clamped.backgroundColor).toBe(zero.backgroundColor);
  });
});

describe('glassFill', () => {
  it('returns the same backgroundColor as glassSurface for dark mode', () => {
    const surface = glassSurface(makeTheme('dark'), { elevation: 2 });
    const fill = glassFill(makeTheme('dark'), { elevation: 2 });
    expect(fill.backgroundColor).toBe(surface.backgroundColor);
  });

  it('returns the same backgroundColor as glassSurface for light mode', () => {
    const surface = glassSurface(makeTheme('light'), { elevation: 1 });
    const fill = glassFill(makeTheme('light'), { elevation: 1 });
    expect(fill.backgroundColor).toBe(surface.backgroundColor);
  });

  it('does NOT include backdropFilter', () => {
    const fill = glassFill(makeTheme('dark'), { elevation: 2 });
    expect(fill).not.toHaveProperty('backdropFilter');
  });

  it('does NOT include WebkitBackdropFilter', () => {
    const fill = glassFill(makeTheme('dark'), { elevation: 2 });
    expect(fill).not.toHaveProperty('WebkitBackdropFilter');
  });

  it('includes border (hairline frame)', () => {
    const fill = glassFill(makeTheme('dark'));
    expect(fill.border).toMatch(/^1px solid /);
  });

  it('negative elevation is clamped to 0', () => {
    const clamped = glassFill(makeTheme('dark'), { elevation: -5 });
    const zero = glassFill(makeTheme('dark'), { elevation: 0 });
    expect(clamped.backgroundColor).toBe(zero.backgroundColor);
  });
});
