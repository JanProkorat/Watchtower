import { useEffect, useMemo, useRef, useState } from 'react';
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
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import 'dayjs/locale/cs';
import { darkTheme, lightTheme } from './theme.js';
import { useThemeMode } from './state/useThemeMode.js';
import { useActiveModule } from './state/useActiveModule.js';
import { ToastProvider } from './state/useToast.js';
import { useInstances } from './state/useInstances.js';
import { useProjects } from './state/useProjects.js';
import { useTabs } from './state/useTabs.js';
import { useWorkspaceLayout } from './state/useWorkspaceLayout.js';
import { useFocusedInstance } from './state/useFocusedInstance.js';
import { ensureTabMountedAndFocused } from './state/spawnIntoTab.js';
import { TabStrip } from './components/TabStrip.js';
import { NewInstanceModal } from './components/NewInstanceModal.js';
import { ModuleRail } from './components/ModuleRail.js';
import { FirstRunWizard } from './components/FirstRunWizard.js';
import { ModuleSettings } from './components/settings/ModuleSettings.js';
import { ModuleTimeTracker } from './components/timetracker/ModuleTimeTracker.js';
import { ModuleDashboard } from './components/dashboard/ModuleDashboard.js';
import { SlotRegistryProvider } from './components/instances/SlotRegistry.js';
import { TerminalPool } from './components/instances/TerminalPool.js';
import { WorkspaceRoot } from './components/instances/WorkspaceRoot.js';
import { routeSpawnToTab } from './layout/routeSpawnToTab.js';
import {
  collectTabIds,
  findLeafById,
  findLeafByTabId,
} from './layout/workspaceTreeOps.js';
import { pruneLayout } from './layout/pruneLayout.js';
import { DASHBOARD_TAB_ID, type TabId } from '../../shared/layout.js';
import type { WatchtowerBridge } from '../../shared/ipcContract.js';

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
  const { mode, toggle: toggleThemeMode } = useThemeMode();
  const theme = useMemo(() => (mode === 'dark' ? darkTheme : lightTheme), [mode]);
  const { instances, activeId, loaded, setActive, spawn, kill, remove } = useInstances();
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<{ id: string; cwd: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [pendingNewCwd, setPendingNewCwd] = useState<string | undefined>(undefined);
  const [activeModule, setActiveModule] = useActiveModule();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [openAdHocCwds, setOpenAdHocCwds] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const { projects } = useProjects();
  const {
    loaded: layoutLoaded,
    layout,
    actions: layoutActions,
  } = useWorkspaceLayout();
  const tabs = useTabs(instances, projects, openAdHocCwds, layout.tabFocus);
  useFocusedInstance(layout, tabs);

  // Prune the layout once after both hydration and tab derivation are ready.
  // Any leaves whose tabId no longer exists (deleted project, terminated
  // instances on first load) are removed. Runtime mutations are guarded by
  // the action set so no further prune is needed.
  const pruneDoneRef = useRef(false);
  useEffect(() => {
    if (!layoutLoaded || pruneDoneRef.current) return;
    const validTabIds = new Set(tabs.map((t) => t.id));
    const pruned = pruneLayout(layout.root, validTabIds);
    if (pruned !== layout.root) layoutActions.replaceTree(pruned);
    pruneDoneRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutLoaded]);

  const mountedTabIds = useMemo(
    () => new Set<string>(collectTabIds(layout.root)),
    [layout.root],
  );
  const focusedTab: TabId | null = useMemo(() => {
    if (!layout.focusedLeafId) return null;
    const node = findLeafById(layout.root, layout.focusedLeafId);
    return node ? node.tabId : null;
  }, [layout]);

  const switchToInstance = (id: string) => {
    setActiveModule('instances');
    setActive(id);
    // Focus the tab + column that owns this instance.
    const inst = instances.find((i) => i.id === id);
    if (!inst) return;
    const tabId = routeSpawnToTab(inst.cwd, projects);
    ensureTabMountedAndFocused({ layout, actions: layoutActions }, tabId);
    layoutActions.focusColumnInTab(tabId, id);
  };
  const switchToNewInstanceForCwd = (cwd: string) => {
    setActiveModule('instances');
    setPendingNewCwd(cwd);
    setNewOpen(true);
  };
  const switchToTimeTrackerProject = (projectId: number) => {
    window.location.hash = `#timetracker/projects/${projectId}`;
    setActiveModule('timetracker');
  };

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void window.watchtower.invoke('getSetting', { key: 'first_run_completed_at' }).then((r) => {
      if (!cancelled && !r.value) setWizardOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  useEffect(() => {
    return window.watchtower.on('activateInstance', (p) => {
      setActive(p.instanceId);
    });
  }, [setActive]);

  useEffect(() => {
    return window.watchtower.on('triggerNewInstance', () => setNewOpen(true));
  }, []);

  const [orchDown, setOrchDown] = useState<null | { code: number | null; restarting: boolean }>(
    null,
  );
  useEffect(() => {
    return window.watchtower.on('orchestratorCrashed', (p) => {
      setOrchDown(p);
      if (p.restarting) {
        setTimeout(() => setOrchDown(null), 3000);
      }
    });
  }, []);

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
      const tabId = routeSpawnToTab(cwd, projects);
      if (tabId.startsWith('cwd:')) setOpenAdHocCwds((s) => new Set(s).add(cwd));
      ensureTabMountedAndFocused({ layout, actions: layoutActions }, tabId);
      const res = await spawn(cwd);
      if (res.instanceId) {
        layoutActions.focusColumnInTab(tabId, res.instanceId);
        setActiveModule('instances');
        setActive(res.instanceId);
      } else {
        setSpawnError(res.error ?? 'spawn failed — no instance id returned');
      }
    } catch (err) {
      setSpawnError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDragStart = (_e: DragStartEvent) => setDragging(true);
  const handleDragEnd = (e: DragEndEvent) => {
    setDragging(false);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;

    const leafZone = /^leaf:([^:]+):(centre|left|right|top|bottom)$/.exec(overId);
    if (leafZone) {
      const [, leafId, zone] = leafZone;
      const tabId = activeId as TabId;
      if (zone === 'centre') {
        layoutActions.replaceLeafTab(leafId!, tabId);
      } else {
        const dir: 'row' | 'col' = zone === 'left' || zone === 'right' ? 'row' : 'col';
        const position: 'before' | 'after' =
          zone === 'left' || zone === 'top' ? 'before' : 'after';
        layoutActions.splitLeafAt(leafId!, dir, position, tabId);
      }
      return;
    }

    if (activeId !== overId) {
      const ids = tabs.map((t) => t.id);
      const oldIdx = ids.indexOf(activeId as TabId);
      const newIdx = ids.indexOf(overId as TabId);
      if (oldIdx >= 0 && newIdx >= 0) {
        layoutActions.setTabStripOrder(arrayMove(ids, oldIdx, newIdx) as TabId[]);
      }
    }
  };

  if (!loaded) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="cs">
          <LoadingScreen />
        </LocalizationProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="cs">
        <ToastProvider>
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            {orchDown && (
              <Box
                sx={{
                  backgroundColor: orchDown.restarting ? 'warning.dark' : 'error.dark',
                  color: 'common.white',
                  px: 2,
                  py: 0.75,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <strong>
                  {orchDown.restarting
                    ? 'Orchestrator crashed — restarting…'
                    : 'Orchestrator crashed repeatedly.'}
                </strong>
                <span style={{ opacity: 0.85 }}>
                  {orchDown.restarting
                    ? 'Instances will reappear in a moment.'
                    : 'Manual restart needed (Cmd+Q + relaunch).'}
                </span>
              </Box>
            )}
            <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
              <ModuleRail
                active={activeModule}
                onSelect={setActiveModule}
                mode={mode}
                onToggleMode={toggleThemeMode}
              />
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                {activeModule === 'dashboard' && (
                  <ModuleDashboard
                    instances={instances}
                    onActivateInstance={switchToInstance}
                    onKillInstance={(id) => kill(id)}
                    onStartNewInstance={() => setNewOpen(true)}
                    onOpenProject={switchToTimeTrackerProject}
                  />
                )}
                {activeModule === 'settings' && <ModuleSettings active />}
                {activeModule === 'timetracker' && (
                  <ModuleTimeTracker
                    active
                    onActivateInstance={switchToInstance}
                    onOpenNewInstanceForCwd={switchToNewInstanceForCwd}
                  />
                )}
                <Box
                  sx={{
                    display: activeModule === 'instances' ? 'flex' : 'none',
                    flex: 1,
                    flexDirection: 'column',
                    minHeight: 0,
                  }}
                >
                  <SlotRegistryProvider>
                    <DndContext
                      sensors={dndSensors}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                    >
                      <TabStrip
                        tabs={tabs}
                        instances={instances}
                        mountedTabIds={mountedTabIds}
                        focusedTabId={focusedTab}
                        onSelect={(id) => {
                          ensureTabMountedAndFocused(
                            { layout, actions: layoutActions },
                            id,
                          );
                          if (id === DASHBOARD_TAB_ID) setActive(null);
                          else {
                            // Focus the tab's active column instance, if any.
                            const tab = tabs.find((t) => t.id === id);
                            if (tab?.focusedInstanceId) setActive(tab.focusedInstanceId);
                          }
                        }}
                        onContextSplit={(id, dir) => {
                          if (!layout.focusedLeafId) return;
                          layoutActions.splitLeafAt(
                            layout.focusedLeafId,
                            dir,
                            'after',
                            id,
                          );
                        }}
                        onCloseInWorkspace={(id) => {
                          const node = findLeafByTabId(layout.root, id);
                          if (node) layoutActions.unmountLeafAt(node.id);
                        }}
                        onNew={() => setNewOpen(true)}
                      />
                      {layoutLoaded && (
                        <WorkspaceRoot
                          layout={layout}
                          tabs={tabs}
                          instances={instances}
                          actions={layoutActions}
                          dragInProgress={dragging}
                          dashboardOnOpen={(id) => switchToInstance(id)}
                          dashboardOnKill={(id) => void kill(id)}
                          dashboardOnRemove={(id) => {
                            const inst = instances.find((i) => i.id === id);
                            handleRemove(id, inst ? !['finished', 'crashed', 'suspended'].includes(inst.status) : false);
                          }}
                          dashboardOnNew={() => setNewOpen(true)}
                        />
                      )}
                      <TerminalPool instances={instances} />
                    </DndContext>
                  </SlotRegistryProvider>
                </Box>
              </Box>
            </Box>
          </Box>
          <NewInstanceModal
            open={newOpen}
            defaultCwd={pendingNewCwd}
            onClose={() => {
              setNewOpen(false);
              setPendingNewCwd(undefined);
            }}
            onSpawn={(cwd) => void doSpawn(cwd)}
          />
          <FirstRunWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
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
        </ToastProvider>
      </LocalizationProvider>
    </ThemeProvider>
  );
}
