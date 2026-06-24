import { alpha, createTheme, type ThemeOptions } from '@mui/material/styles';

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
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
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

export const darkTheme = createTheme({
  ...shared,
  palette: {
    mode: 'dark',
    primary: { main: '#7c5cff' },
    secondary: { main: '#22d3ee' },
    success: { main: '#22c55e' },
    warning: { main: '#f59e0b' },
    error: { main: '#ef4444' },
    info: { main: '#38bdf8' },
    divider: 'rgba(255,255,255,0.08)',
    background: { default: '#0a0b0f', paper: '#13151c' },
    text: { primary: '#e5e7eb', secondary: '#9aa3b2' },
  },
  components: {
    ...shared.components,
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: alpha('#13151c', 0.65),
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          color: '#e5e7eb',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#0d0f15',
          borderRight: 'none',
          boxShadow: '4px 0 32px rgba(0,0,0,0.35)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: {
          borderColor: 'rgba(255,255,255,0.08)',
        },
      },
    },
  },
});

export const lightTheme = createTheme({
  ...shared,
  palette: {
    mode: 'light',
    primary: { main: '#6e54e0' },
    secondary: { main: '#0ea5b7' },
    success: { main: '#16a34a' },
    warning: { main: '#d97706' },
    error: { main: '#dc2626' },
    info: { main: '#0284c7' },
    divider: 'rgba(15,18,24,0.08)',
    background: { default: '#f7f8fa', paper: '#ffffff' },
    text: { primary: '#0f1218', secondary: '#5b6370' },
  },
  components: {
    ...shared.components,
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: alpha('#ffffff', 0.7),
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          color: '#0f1218',
          borderBottom: '1px solid rgba(15,18,24,0.06)',
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#ffffff',
          borderRight: 'none',
          boxShadow: '4px 0 32px rgba(15,18,24,0.06)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: {
          borderColor: 'rgba(15,18,24,0.08)',
        },
      },
    },
  },
});
