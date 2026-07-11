import { createTheme, type ThemeOptions } from '@mui/material/styles';
import {
  glassSurface,
  GLASS_FILL_DARK_RGB,
  GLASS_FILL_DARK_OPACITY,
  GLASS_FILL_LIGHT_RGB,
  GLASS_FILL_LIGHT_OPACITY,
} from './theme/glass.js';

const fontStack =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif';

const shared: ThemeOptions = {
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: fontStack,
    h1: { fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontWeight: 700, letterSpacing: '-0.015em' },
    h4: { fontWeight: 700, letterSpacing: '-0.01em' },
    h5: { fontWeight: 600, letterSpacing: '-0.005em' },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 10 },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        '.tt-num': { fontVariantNumeric: 'tabular-nums' },
        'html, body, #root': { height: '100%' },
        body: { fontFeatureSettings: '"cv11", "ss01"' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
  },
};

// Compute glass surface styles for each mode at theme-build time.
// glassSurface only reads theme.palette.mode, so we can stub the theme object
// cheaply here rather than using MUI's callback styleOverrides (which carry
// heavier typing and are unavailable inside createTheme's own options object).
const darkGlass = glassSurface({ palette: { mode: 'dark' } } as import('@mui/material/styles').Theme);
const darkGlassEl1 = glassSurface({ palette: { mode: 'dark' } } as import('@mui/material/styles').Theme, { elevation: 1 });
const darkGlassEl2 = glassSurface({ palette: { mode: 'dark' } } as import('@mui/material/styles').Theme, { elevation: 2 });
const lightGlass = glassSurface({ palette: { mode: 'light' } } as import('@mui/material/styles').Theme);
const lightGlassEl1 = glassSurface({ palette: { mode: 'light' } } as import('@mui/material/styles').Theme, { elevation: 1 });
const lightGlassEl2 = glassSurface({ palette: { mode: 'light' } } as import('@mui/material/styles').Theme, { elevation: 2 });

export const darkTheme = createTheme({
  ...shared,
  palette: {
    mode: 'dark',
    primary: { main: '#38bdf8' },
    secondary: { main: '#22d3ee' },
    success: { main: '#22c55e' },
    warning: { main: '#f59e0b' },
    error: { main: '#ef4444' },
    info: { main: '#38bdf8' },
    divider: 'rgba(255,255,255,0.08)',
    // Alpha backgrounds so the macOS vibrancy layer shows through.
    // paper value mirrors GLASS_FILL_DARK_RGB/OPACITY in glass.ts — edit there, not here.
    background: { default: 'rgba(18,20,28,0.32)', paper: `rgba(${GLASS_FILL_DARK_RGB},${GLASS_FILL_DARK_OPACITY})` },
    text: { primary: '#e5e7eb', secondary: '#9aa3b2' },
  },
  components: {
    ...shared.components,
    // MuiAppBar: frosted glass override. Phase B wires TabStrip to glassSurface
    // directly (not via MuiAppBar component), but this override is kept live
    // and updated to also derive from glassSurface so both stay in sync.
    MuiAppBar: {
      styleOverrides: {
        root: {
          ...darkGlass,
          backgroundImage: 'none',
          boxShadow: 'none',
          color: '#e5e7eb',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          ...darkGlass,
          backgroundImage: 'none',
          borderRight: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          ...darkGlass,
          backgroundImage: 'none',
        },
        outlined: {
          ...darkGlass,
          backgroundImage: 'none',
          borderColor: 'rgba(255,255,255,0.10)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          ...darkGlassEl2,
          backgroundImage: 'none',
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          ...darkGlassEl1,
          backgroundImage: 'none',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          ...darkGlassEl1,
          backgroundImage: 'none',
        },
      },
    },
    // MuiTooltip intentionally not frosted — solid for legibility.
  },
});

export const lightTheme = createTheme({
  ...shared,
  palette: {
    mode: 'light',
    primary: { main: '#0284c7' },
    secondary: { main: '#0ea5b7' },
    success: { main: '#16a34a' },
    warning: { main: '#d97706' },
    error: { main: '#dc2626' },
    info: { main: '#0284c7' },
    divider: 'rgba(15,18,24,0.08)',
    // Alpha backgrounds so the macOS vibrancy layer shows through.
    // paper value mirrors GLASS_FILL_LIGHT_RGB/OPACITY in glass.ts — edit there, not here.
    background: { default: 'rgba(244,245,250,0.40)', paper: `rgba(${GLASS_FILL_LIGHT_RGB},${GLASS_FILL_LIGHT_OPACITY})` },
    text: {
      primary: '#0f1218',
      // Bumped from #5b6370 to #3d4450 for better contrast over light vibrancy.
      secondary: '#3d4450',
    },
  },
  components: {
    ...shared.components,
    // MuiAppBar: frosted glass override. Phase B wires TabStrip to glassSurface
    // directly (not via MuiAppBar component), but this override is kept live
    // and updated to also derive from glassSurface so both stay in sync.
    MuiAppBar: {
      styleOverrides: {
        root: {
          ...lightGlass,
          backgroundImage: 'none',
          boxShadow: 'none',
          color: '#0f1218',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          ...lightGlass,
          backgroundImage: 'none',
          borderRight: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          ...lightGlass,
          backgroundImage: 'none',
        },
        outlined: {
          ...lightGlass,
          backgroundImage: 'none',
          borderColor: 'rgba(15,18,24,0.10)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          ...lightGlassEl2,
          backgroundImage: 'none',
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          ...lightGlassEl1,
          backgroundImage: 'none',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          ...lightGlassEl1,
          backgroundImage: 'none',
        },
      },
    },
    // MuiTooltip intentionally not frosted — solid for legibility.
  },
});

export type ThemeMode = 'dark' | 'light';
