import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
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
import { NewInstanceModal } from './components/NewInstanceModal.js';
import { ModuleRail, type ModuleId } from './components/ModuleRail.js';
import { DashboardTab } from './components/DashboardTab.js';
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

function LoadingScreen() {
  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.75,
        backgroundColor: 'background.default',
        color: 'text.secondary',
      }}
    >
      <CircularProgress size={22} thickness={4} />
      <Typography variant="body2">Watchtower</Typography>
    </Box>
  );
}

export function App() {
  const { instances, activeId, loaded, setActive, spawn, remove, reorder } = useInstances();
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<{ id: string; cwd: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [activeModule, setActiveModule] = useState<ModuleId>('instances');

  const handleRemove = (id: string, isLive: boolean) => {
    if (!isLive) {
      void remove(id);
      return;
    }
    const inst = instances.find((i) => i.id === id);
    setConfirmClose({ id, cwd: inst?.cwd ?? id });
  };

  const doSpawn = async (cwd: string) => {
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

  if (!loaded) {
    return (
      <ThemeProvider theme={watchtowerTheme}>
        <CssBaseline />
        <LoadingScreen />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={watchtowerTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh' }}>
        <ModuleRail active={activeModule} onSelect={setActiveModule} />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TabStrip
          instances={instances}
          activeId={activeId}
          onSelect={(id) => setActive(id === DASHBOARD_TAB ? null : id)}
          onNew={() => setNewOpen(true)}
          onRemove={handleRemove}
          onReorder={(ids) => void reorder(ids)}
        />
        <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {onDashboard ? (
            <DashboardTab
              instances={instances}
              onOpen={(id) => setActive(id)}
              onKill={(id) => void remove(id)}
              onRemove={(id) => void remove(id)}
              onNew={() => setNewOpen(true)}
            />
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
                  <Terminal
                    instanceId={i.id}
                    active={i.id === activeId}
                    status={i.status}
                  />
                </TerminalErrorBoundary>
              ),
            )
          )}
        </Box>
        </Box>
      </Box>
      <NewInstanceModal
        open={newOpen}
        defaultCwd="~/Projects"
        onClose={() => setNewOpen(false)}
        onSpawn={(cwd) => void doSpawn(cwd)}
      />
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
