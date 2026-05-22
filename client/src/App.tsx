import { useState } from 'react';
import { Alert, Box, CssBaseline, Snackbar, ThemeProvider, Typography } from '@mui/material';
import { watchtowerTheme } from './theme.js';
import { useInstances } from './state/useInstances.js';
import { TabStrip, DASHBOARD_TAB } from './components/TabStrip.js';
import { Terminal } from './components/Terminal.js';
import type { WatchtowerBridge } from '../../shared/ipcContract.js';

declare global {
  interface Window {
    watchtower: WatchtowerBridge;
  }
}

export function App() {
  const { instances, activeId, setActive, spawn } = useInstances();
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const handleNew = async () => {
    // Quick prompt for the first end-to-end smoke. The proper modal lands in WT-T19.
    const cwd = window.prompt('Working directory for new claude instance?', '~/Projects');
    if (!cwd) return;
    try {
      const res = await spawn(cwd);
      if (!res.instanceId) {
        setSpawnError(res.error ?? 'spawn failed — no instance id returned');
      }
    } catch (err) {
      setSpawnError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDashboard = activeId === null || activeId === DASHBOARD_TAB;

  return (
    <ThemeProvider theme={watchtowerTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <TabStrip
          instances={instances}
          activeId={activeId}
          onSelect={(id) => setActive(id === DASHBOARD_TAB ? null : id)}
          onNew={() => void handleNew()}
        />
        <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {onDashboard ? (
            <Box sx={{ p: 4 }}>
              <Typography variant="h5">Watchtower</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {instances.length} instance{instances.length === 1 ? '' : 's'}.
                {' '}
                Click <strong>+</strong> in the tab strip to spawn a new claude.
              </Typography>
            </Box>
          ) : (
            instances.map((i) => (
              <Terminal key={i.id} instanceId={i.id} active={i.id === activeId} />
            ))
          )}
        </Box>
      </Box>
      <Snackbar
        open={Boolean(spawnError)}
        autoHideDuration={10000}
        onClose={() => setSpawnError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="error"
          onClose={() => setSpawnError(null)}
          sx={{ maxWidth: 720, fontFamily: 'Menlo, monospace', fontSize: 12 }}
        >
          spawn failed: {spawnError}
        </Alert>
      </Snackbar>
    </ThemeProvider>
  );
}
