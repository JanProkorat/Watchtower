import { createTheme } from '@mui/material/styles';

export const watchtowerTheme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#0e0f12', paper: '#15171c' },
    primary: { main: '#7aa7ff' },
    secondary: { main: '#f0a868' },
    error: { main: '#ef5350' },
    warning: { main: '#ffb74d' },
    success: { main: '#66bb6a' },
  },
  shape: { borderRadius: 6 },
  typography: { fontFamily: 'Inter, system-ui, -apple-system, sans-serif' },
});
