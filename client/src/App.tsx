import { CssBaseline, ThemeProvider, Box, Typography } from '@mui/material';
import { watchtowerTheme } from './theme.js';

export function App() {
  return (
    <ThemeProvider theme={watchtowerTheme}>
      <CssBaseline />
      <Box sx={{ p: 6 }}>
        <Typography variant="h4">Watchtower</Typography>
        <Typography variant="body2" color="text.secondary">
          Renderer is alive.
        </Typography>
      </Box>
    </ThemeProvider>
  );
}
