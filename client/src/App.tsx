import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
  ThemeProvider,
  Typography,
} from '@mui/material';
import { watchtowerTheme } from './theme.js';
import { useInstances } from './state/useInstances.js';
import { TabStrip, DASHBOARD_TAB } from './components/TabStrip.js';
import { Terminal } from './components/Terminal.js';
import { TerminalErrorBoundary } from './components/TerminalErrorBoundary.js';
import type { WatchtowerBridge } from '../../shared/ipcContract.js';

const TERMINAL_STATES = new Set(['finished', 'crashed', 'suspended']);
function isTerminalState(status: string): boolean {
  return TERMINAL_STATES.has(status);
}

function DeadInstancePane({
  active,
  status,
  cwd,
}: {
  active: boolean;
  status: string;
  cwd: string;
}) {
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        display: active ? 'flex' : 'none',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: 1.5,
        p: 6,
        backgroundColor: 'background.default',
      }}
    >
      <Typography variant="h6">Session is {status}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
        {cwd}
      </Typography>
      <Typography variant="caption" color="text.disabled" sx={{ maxWidth: 540 }}>
        The pty for this session ended (or never started under this orchestrator run).
        Use <strong>+</strong> to spawn a fresh claude in the same directory. Suspend / resume
        across restarts arrives in Phase 8.
      </Typography>
    </Box>
  );
}

declare global {
  interface Window {
    watchtower: WatchtowerBridge;
  }
}

export function App() {
  const { instances, activeId, setActive, spawn, remove } = useInstances();
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<{ id: string; cwd: string } | null>(null);

  const handleRemove = (id: string, isLive: boolean) => {
    if (!isLive) {
      void remove(id);
      return;
    }
    const inst = instances.find((i) => i.id === id);
    setConfirmClose({ id, cwd: inst?.cwd ?? id });
  };

  const handleNew = async () => {
    try {
      // Native folder picker — works in Electron (electron-only IPC) and falls
      // through to the stub's "error: standalone browser mode" path in plain
      // browser dev. window.prompt isn't supported in Electron, hence the picker.
      const pick = await window.watchtower.invoke('chooseDirectory', {
        defaultPath: '~/Projects',
      });
      if (!pick.path) return; // user cancelled
      const res = await spawn(pick.path);
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
          onRemove={handleRemove}
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
            instances.map((i) =>
              isTerminalState(i.status) ? (
                <DeadInstancePane
                  key={i.id}
                  active={i.id === activeId}
                  status={i.status}
                  cwd={i.cwd}
                />
              ) : (
                <TerminalErrorBoundary
                  key={i.id}
                  instanceId={i.id}
                  cwd={i.cwd}
                  active={i.id === activeId}
                >
                  <Terminal instanceId={i.id} active={i.id === activeId} />
                </TerminalErrorBoundary>
              ),
            )
          )}
        </Box>
      </Box>
      <Dialog
        open={Boolean(confirmClose)}
        onClose={() => setConfirmClose(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Close this session?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Claude in{' '}
            <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
              {confirmClose?.cwd}
            </Box>{' '}
            is still running. Closing the tab kills the pty and forgets the
            session. Use Cancel to keep it alive.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClose(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (confirmClose) void remove(confirmClose.id);
              setConfirmClose(null);
            }}
          >
            Kill &amp; close
          </Button>
        </DialogActions>
      </Dialog>
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
