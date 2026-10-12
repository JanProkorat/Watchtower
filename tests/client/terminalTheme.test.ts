import { describe, it, expect } from 'vitest';
import { TERMINAL_BG, TERMINAL_OPTIONS, TERMINAL_THEME } from '../../apps/desktop/src/components/terminalTheme';

describe('terminalTheme', () => {
  it('paints one ground everywhere the terminal shows through', () => {
    expect(TERMINAL_THEME.background).toBe(TERMINAL_BG);
    expect(TERMINAL_THEME.cursorAccent).toBe(TERMINAL_BG);
    expect(TERMINAL_OPTIONS.theme).toBe(TERMINAL_THEME);
  });

  it('allows the proposed API the Unicode 11 addon needs', () => {
    expect(TERMINAL_OPTIONS.allowProposedApi).toBe(true);
  });

  it('defines the full 16-colour ANSI palette, black distinct from the ground', () => {
    const keys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
    for (const k of keys) {
      expect(TERMINAL_THEME[k]).toMatch(/^#[0-9a-f]{6}$/);
      const bright = `bright${k[0]!.toUpperCase()}${k.slice(1)}` as keyof typeof TERMINAL_THEME;
      expect(TERMINAL_THEME[bright]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(TERMINAL_THEME.black).not.toBe(TERMINAL_BG);
  });
});
