import { useEffect, useState } from 'react';
import { CssBaseline, ThemeProvider, Box, Typography } from '@mui/material';
import { watchtowerTheme } from './theme.js';
import type { WatchtowerBridge } from '../../shared/ipcContract.js';

declare global {
  interface Window {
    watchtower: WatchtowerBridge;
  }
}

export function App() {
  const [helloVersion, setHelloVersion] = useState<string | null>(null);
  const [mainMs, setMainMs] = useState<number | null>(null);
  const [orchMs, setOrchMs] = useState<number | null>(null);

  useEffect(() => {
    const off = window.watchtower.on('hello', (p) => setHelloVersion(p.version));
    const sent = Date.now();
    void window.watchtower.invoke('ping', { now: sent }).then((res) => {
      setMainMs(res.main - sent);
      setOrchMs(res.orch - sent);
    });
    return off;
  }, []);

  return (
    <ThemeProvider theme={watchtowerTheme}>
      <CssBaseline />
      <Box sx={{ p: 6 }}>
        <Typography variant="h4">Watchtower</Typography>
        <Typography variant="body2" color="text.secondary">
          hello: {helloVersion ?? '…'} · main: {mainMs ?? '…'} ms · orch: {orchMs ?? '…'} ms
        </Typography>
      </Box>
    </ThemeProvider>
  );
}
