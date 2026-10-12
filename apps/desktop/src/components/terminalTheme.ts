import type { ITerminalOptions, ITheme } from '@xterm/xterm';

// The terminal's look, tuned toward the Claude desktop app: a warm near-black
// ground, cream text, the Claude clay as cursor and selection, and an ANSI
// palette warmed to sit with them. Claude Code's own UI mostly draws in 24-bit
// colour (COLORTERM=truecolor is set on the pty), so the ANSI palette chiefly
// shapes tool and shell output. The pane stays dark in both app themes.

/** Ground of the terminal and of every surface it shows through. */
export const TERMINAL_BG = '#1f1e1d';

const CLAY = '#d97757';

export const TERMINAL_THEME: ITheme = {
  background: TERMINAL_BG,
  foreground: '#e8e6dc',
  cursor: CLAY,
  cursorAccent: TERMINAL_BG,
  selectionBackground: 'rgba(217, 119, 87, 0.32)',
  selectionInactiveBackground: 'rgba(217, 119, 87, 0.18)',
  black: '#3a3936',
  red: '#e5735e',
  green: '#8fbf7f',
  yellow: '#e0b25c',
  blue: '#7aa2e3',
  magenta: '#c49be0',
  cyan: '#6fc2c0',
  white: '#d6d3c9',
  brightBlack: '#6b6a65',
  brightRed: '#f08a76',
  brightGreen: '#a6d496',
  brightYellow: '#f0c674',
  brightBlue: '#97b8f0',
  brightMagenta: '#d6b3f0',
  brightCyan: '#8ad6d4',
  brightWhite: '#faf9f5',
};

export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily: '"SF Mono", SFMono-Regular, Menlo, Monaco, monospace',
  fontSize: 13,
  fontWeight: '400',
  fontWeightBold: '600',
  // 1.0: any extra leading opens gaps in Claude Code's box-drawn borders,
  // which the DOM renderer draws as font glyphs and can't stretch.
  lineHeight: 1,
  letterSpacing: 0,
  cursorBlink: true,
  cursorStyle: 'bar',
  cursorWidth: 2,
  cursorInactiveStyle: 'outline',
  // Bold stays its own colour, as in the desktop app, rather than brightening.
  drawBoldTextInBrightColors: false,
  theme: TERMINAL_THEME,
  convertEol: true,
  scrollback: 5000,
  // Unicode11Addon is a proposed API.
  allowProposedApi: true,
};

/** Inner padding between the card edge and the text grid. FitAddon subtracts it. */
export const TERMINAL_PADDING = '10px 6px 8px 14px';
