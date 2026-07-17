import { useEffect, useMemo, useState } from 'react';
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
import { ambientBackground } from './theme/glass.js';
import { invoke } from './state/ipc';
import { useThemeMode } from './state/useThemeMode.js';
import { useActiveModule } from './state/useActiveModule.js';
import { ToastProvider } from './state/useToast.js';
import { useInstances } from './state/useInstances.js';
import { useProjects } from './state/useProjects.js';
import { useTabs } from './state/useTabs.js';
import { useWorkspaceLayout } from './state/useWorkspaceLayout.js';
import { useHiddenInstances } from './state/useHiddenInstances.js';
import { useFocusedInstance } from './state/useFocusedInstance.js';
import { ensureTabMountedAndFocused } from './state/spawnIntoTab.js';
import { TabStrip } from './components/TabStrip.js';
import { tabsNeedingAttention } from './util/tabAttention.js';
import { NewInstanceModal } from './components/NewInstanceModal.js';
import { ModuleRail } from './components/ModuleRail.js';
import { FirstRunWizard } from './components/FirstRunWizard.js';
import { ModuleSettings } from './components/settings/ModuleSettings.js';
import { ModuleTimeTracker } from './components/timetracker/ModuleTimeTracker.js';
import { ModuleDashboard } from './components/dashboard/ModuleDashboard.js';
import { ModuleReviews } from './components/reviews/ModuleReviews.js';
import { ModuleNotes } from './components/notes/ModuleNotes.js';
import { SlotRegistryProvider } from './components/instances/SlotRegistry.js';
import { TerminalPool } from './components/instances/TerminalPool.js';
import { WorkspaceRoot } from './components/instances/WorkspaceRoot.js';
import { routeSpawnToTab } from './layout/routeSpawnToTab.js';
import {
  collectTabIds,
  findLeafById,
  findLeafByTabId,
} from '@watchtower/shared/workspaceTreeOps.js';
import { parseTabId } from './layout/tabId.js';
import { pruneLayout } from './layout/pruneLayout.js';
import { leafToCollapseOnHide } from './layout/hiddenPaneCollapse.js';
import { pruneAdHocCwds } from './layout/pruneAdHocCwds.js';
import { selectGlobalTab } from './layout/selectGlobalTab.js';
import { DASHBOARD_TAB_ID, type TabId } from '@watchtower/shared/layout.js';
import { useTimeTrackerView } from './state/useTimeTrackerView.js';
import { useSettingsView } from './state/useSettingsView.js';
import { usePrWatch } from './state/usePrWatch.js';
import type { WatchtowerBridge, PrHost, PrWatchInboxItem } from '@watchtower/shared/ipcContract.js';

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
  const { instances, activeId, loaded, setActive, spawn, kill, remove, setTask, reorder } = useInstances();
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<{ id: string; cwd: string } | null>(null);
  const [confirmTabClose, setConfirmTabClose] = useState<{
    label: string;
    ids: string[];
    liveCount: number;
  } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [pendingNewCwd, setPendingNewCwd] = useState<string | undefined>(undefined);
  const [activeModule, setActiveModule] = useActiveModule();
  const billingView = useTimeTrackerView(activeModule === 'billing');
  const settingsView = useSettingsView(activeModule === 'settings');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [openAdHocCwds, setOpenAdHocCwds] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  // Counter of in-flight spawns. The reactive prune below skips while >0
  // because the spawn flow mounts the target tab's leaf synchronously, but
  // the instance (which is what makes the tab show up in `tabs`) only
  // exists after the IPC resolves — pruning in between would unmount the
  // freshly-mounted leaf.
  const [spawnInFlight, setSpawnInFlight] = useState(0);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const { projects } = useProjects();
  const {
    loaded: layoutLoaded,
    layout,
    actions: layoutActions,
  } = useWorkspaceLayout();
  const { hidden: hiddenInstances, hide: hideInstance, unhide: unhideInstance, pruneStale: pruneHiddenStale } =
    useHiddenInstances();
  const tabs = useTabs(instances, projects, openAdHocCwds, layout.tabFocus, hiddenInstances);
  useFocusedInstance(layout, tabs);

  // Drop hidden ids that no longer correspond to a live instance row —
  // otherwise a long-dead instance would keep its hidden flag forever in
  // settings and pile up.
  useEffect(() => {
    pruneHiddenStale(new Set(instances.map((i) => i.id)));
  }, [instances, pruneHiddenStale]);

  // Reactive prune: whenever a leaf's tabId no longer exists in the derived
  // tab list (e.g. the user closed the last instance of a project), drop the
  // leaf from the layout tree. Guarded by a `hasInvalid` check so we only
  // call replaceTree when something actually needs cleaning — pruneRec
  // always allocates a new split node, so reference equality alone would
  // loop. Skipped while a spawn is in flight: the spawn synchronously
  // mounts the target tab's leaf, but the instance that puts the tab in
  // `tabs` only arrives after the IPC resolves.
  useEffect(() => {
    if (!layoutLoaded || spawnInFlight > 0) return;
    const validTabIds = new Set(tabs.map((t) => t.id));
    const leafTabIds = collectTabIds(layout.root);
    const hasInvalid = leafTabIds.some(
      (tid) => tid !== DASHBOARD_TAB_ID && !validTabIds.has(tid),
    );
    if (!hasInvalid) return;
    const pruned = pruneLayout(layout.root, validTabIds);
    layoutActions.replaceTree(pruned);
  }, [layoutLoaded, tabs, layout.root, layoutActions, spawnInFlight]);

  // Self-clean openAdHocCwds: a project-less folder's tab is force-shown by
  // deriveTabs while its cwd is in this set, so closing the tab's last session
  // must also drop the cwd or the empty tab lingers. Guarded by spawnInFlight
  // for the same reason as the layout prune above — a spawn adds the cwd
  // before its instance row exists, so pruning mid-spawn kills the new tab.
  useEffect(() => {
    if (spawnInFlight > 0) return;
    setOpenAdHocCwds((prev) => pruneAdHocCwds(prev, instances));
  }, [instances, spawnInFlight]);

  const mountedTabIds = useMemo(
    () => new Set<string>(collectTabIds(layout.root)),
    [layout.root],
  );
  // Tabs with a session blocked on the user (permission / waiting-input /
  // crashed) surface a ⚠️ in the strip in place of the accent dot.
  const attentionTabIds = useMemo(() => {
    const statusById = new Map(instances.map((i) => [i.id, i.status]));
    return tabsNeedingAttention(tabs, statusById);
  }, [tabs, instances]);
  const focusedTab: TabId | null = useMemo(() => {
    if (!layout.focusedLeafId) return null;
    const node = findLeafById(layout.root, layout.focusedLeafId);
    return node ? node.tabId : null;
  }, [layout]);

  const switchToInstance = (id: string) => {
    setActiveModule('instances');
    setActive(id);
    // Clicking Open on the dashboard implicitly un-hides — otherwise the
    // session would stay filtered out of its tab's columnOrder and the
    // user couldn't see the instance they just asked to open.
    unhideInstance(id);
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
  const spawnTerminalForCwd = (cwd: string) => {
    setActiveModule('instances');
    void doSpawn(cwd, 'shell');
  };
  const spawnClaudeForCwd = (cwd: string) => {
    setActiveModule('instances');
    void doSpawn(cwd, 'claude');
  };
  const cwdForTab = (id: TabId): string | null => {
    const parsed = parseTabId(id);
    if (parsed.kind === 'project') {
      return projects.find((p) => p.id === parsed.projectId)?.folderPath ?? null;
    }
    if (parsed.kind === 'cwd') return parsed.cwd;
    return null;
  };
  const switchToTimeTrackerProject = (projectId: number) => {
    // Set the hash before flipping the module so useTimeTrackerView reads
    // the right view on its initial mount.
    window.location.hash = `#billing/projects/${projectId}`;
    setActiveModule('billing');
  };

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void invoke('getSetting', { key: 'first_run_completed_at' }).then((r) => {
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

  // A macOS PR-notification click deep-links here. Handled at App level (not
  // inside ModuleReviews, which only mounts on the reviews module) so it can
  // switch to the reviews module first, then hand the target PR down. Signal
  // main we're ready so it flushes any deep-link buffered during cold start.
  const [deepLinkTarget, setDeepLinkTarget] = useState<
    { host: PrHost; repoKey: string; prNumber: number; focus?: 'comments' } | null
  >(null);
  useEffect(() => {
    const off = window.watchtower.on('deep-link', (d) => {
      if (d.module !== 'reviews') return;
      setActiveModule('reviews');
      setDeepLinkTarget({ host: d.host, repoKey: d.repoKey, prNumber: d.prNumber });
    });
    void invoke('deepLink:ready', {}).catch(() => {});
    return off;
  }, [setActiveModule]);

  // PR-watch inbox lives at App level so the ModuleRail's notification bell and
  // ModuleReviews (row badges + open-mark-seen) share one source — marking a
  // notification seen from the rail also clears the matching row badge.
  const prWatch = usePrWatch();
  // Clicking a notification: go to Reviews, open the PR straight to the Comments
  // tab (highlighting the newest thread), and clear its unread flag.
  const openNotification = (it: PrWatchInboxItem): void => {
    setActiveModule('reviews');
    setDeepLinkTarget({ host: it.host, repoKey: it.repoKey, prNumber: it.prNumber, focus: 'comments' });
    void prWatch.markSeen(it.host, it.repoKey, it.prNumber).catch(() => { /* invoke() toasts on failure */ });
  };
  const markAllNotificationsSeen = (): void => {
    for (const it of prWatch.items.filter((i) => i.unread)) {
      void prWatch.markSeen(it.host, it.repoKey, it.prNumber).catch(() => { /* invoke() toasts on failure */ });
    }
  };

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

  const isLiveStatus = (status: string): boolean =>
    !['finished', 'crashed', 'suspended'].includes(status);

  const handleCloseTab = (tabId: TabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tab.columnOrder.length === 0) return;
    const ids = tab.columnOrder;
    const liveCount = ids.reduce((acc, id) => {
      const inst = instances.find((i) => i.id === id);
      return acc + (inst && isLiveStatus(inst.status) ? 1 : 0);
    }, 0);
    if (liveCount === 0) {
      for (const id of ids) void remove(id);
      return;
    }
    setConfirmTabClose({ label: tab.label, ids, liveCount });
  };

  // Hiding the last visible session in a pane should collapse the pane so
  // sibling panes reclaim the space — not leave a dead "all hidden" placeholder.
  // The tab stays in the strip (deriveTabs keeps hidden-only tabs); clicking it
  // again re-mounts and un-hides its sessions (see the TabStrip onSelect).
  const handleHideSession = (id: string) => {
    const owningTab = tabs.find((t) => t.columnOrder.includes(id));
    hideInstance(id);
    if (!owningTab || owningTab.columnOrder.length !== 1) return;
    const leafId = leafToCollapseOnHide(layout.root, owningTab.id);
    if (leafId) layoutActions.unmountLeafAt(leafId);
  };

  const doSpawn = async (
    cwd: string,
    kind: 'claude' | 'shell' = 'claude',
    afterInstanceId?: string,
  ) => {
    setSpawnInFlight((n) => n + 1);
    try {
      const tabId = routeSpawnToTab(cwd, projects);
      if (tabId.startsWith('cwd:')) setOpenAdHocCwds((s) => new Set(s).add(cwd));
      ensureTabMountedAndFocused({ layout, actions: layoutActions }, tabId);
      setActiveModule('instances');
      const res = await spawn(cwd, undefined, kind);
      if (res.instanceId) {
        // Positional insert: place the new column immediately to the right of
        // the pane the "+" was clicked in (reorder writes display_order, which
        // is what deriveTabs sorts columns by). The DB row already exists, so
        // the order sticks even though the new instance isn't in local state yet.
        if (afterInstanceId) {
          const newId = res.instanceId;
          const currentIds = instances.map((i) => i.id).filter((id) => id !== newId);
          const idx = currentIds.indexOf(afterInstanceId);
          const ordered =
            idx >= 0
              ? [...currentIds.slice(0, idx + 1), newId, ...currentIds.slice(idx + 1)]
              : [...currentIds, newId];
          await reorder(ordered);
        }
        layoutActions.focusColumnInTab(tabId, res.instanceId);
        setActive(res.instanceId);
      } else {
        setSpawnError(res.error ?? 'spawn failed — no instance id returned');
      }
    } catch (err) {
      setSpawnError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpawnInFlight((n) => n - 1);
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
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', background: (t) => ambientBackground(t) }}>
            <DndContext
              sensors={dndSensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
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
                billingTab={billingView.view.tab}
                settingsTab={settingsView.view.tab}
                onSelect={setActiveModule}
                onSelectBillingTab={(tab) => {
                  setActiveModule('billing');
                  billingView.setTab(tab);
                }}
                onSelectSettingsTab={(tab) => {
                  setActiveModule('settings');
                  settingsView.setTab(tab);
                }}
                mode={mode}
                onToggleMode={toggleThemeMode}
                reviewsUnread={prWatch.unread}
                reviewsNotifications={prWatch.items}
                onOpenNotification={openNotification}
                onMarkAllNotificationsSeen={markAllNotificationsSeen}
              />
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                {/* Instance tab bar — visible on every module so you can jump back
                    to a session from anywhere. Hidden on the dashboard, which
                    already lists sessions in its own card. */}
                {activeModule !== 'dashboard' && (
                  <TabStrip
                    tabs={tabs}
                    mountedTabIds={mountedTabIds}
                    attentionTabIds={attentionTabIds}
                    workspaceActive={activeModule === 'instances'}
                    focusedTabId={activeModule === 'instances' ? focusedTab : null}
                    onSelect={(id) => {
                      // A tab collapsed by hiding all its sessions still shows in
                      // the strip. Clicking it should bring the window back with
                      // content, so un-hide its sessions before mounting — but only
                      // when the tab is actually collapsed (not currently mounted),
                      // so the sole-pane "N hidden" tray keeps working untouched.
                      const clicked = tabs.find((tab) => tab.id === id);
                      if (
                        clicked &&
                        clicked.columnOrder.length === 0 &&
                        clicked.hiddenInstanceIds.length > 0 &&
                        !findLeafByTabId(layout.root, id)
                      ) {
                        for (const hid of clicked.hiddenInstanceIds) unhideInstance(hid);
                      }
                      selectGlobalTab(id, {
                        setActiveModule,
                        ensureMounted: (tid) =>
                          ensureTabMountedAndFocused({ layout, actions: layoutActions }, tid),
                        setActive,
                        focusedInstanceIdForTab: (tid) =>
                          tabs.find((t) => t.id === tid)?.focusedInstanceId ?? null,
                      });
                    }}
                    onContextSplit={(id, dir) => {
                      setActiveModule('instances');
                      if (!layout.focusedLeafId) return;
                      // Don't duplicate a tab into a second leaf — the xterm host can
                      // only attach to one slot, so the second leaf steals the
                      // terminal and the first goes blank. If already mounted, focus it.
                      const existing = findLeafByTabId(layout.root, id);
                      if (existing) {
                        layoutActions.focusLeaf(existing.id);
                        return;
                      }
                      layoutActions.splitLeafAt(layout.focusedLeafId, dir, 'after', id);
                    }}
                    onContextNewInstance={(id) => {
                      const cwd = cwdForTab(id);
                      if (cwd) switchToNewInstanceForCwd(cwd);
                    }}
                    canSpawnInTab={(id) => cwdForTab(id) !== null}
                    onCloseTab={handleCloseTab}
                    onCloseInWorkspace={(id) => {
                      const node = findLeafByTabId(layout.root, id);
                      if (node) layoutActions.unmountLeafAt(node.id);
                    }}
                    onHideTab={(id) => {
                      const node = findLeafByTabId(layout.root, id);
                      if (node) layoutActions.unmountLeafAt(node.id);
                    }}
                    onNew={() => setNewOpen(true)}
                  />
                )}
                {activeModule === 'dashboard' && (
                  <ModuleDashboard
                    instances={instances}
                    onActivateInstance={switchToInstance}
                    onKillInstance={(id) => kill(id)}
                    onStartNewInstance={() => setNewOpen(true)}
                    onOpenProject={switchToTimeTrackerProject}
                  />
                )}
                {activeModule === 'settings' && <ModuleSettings view={settingsView.view} />}
                {activeModule === 'reviews' && (
                  <ModuleReviews
                    deepLinkTarget={deepLinkTarget}
                    onConsumeDeepLink={() => setDeepLinkTarget(null)}
                    watchItems={prWatch.items}
                    markSeen={prWatch.markSeen}
                    watchError={prWatch.error}
                  />
                )}
                {activeModule === 'billing' && (
                  <ModuleTimeTracker
                    view={billingView.view}
                    onSelectProject={billingView.selectProject}
                    onOpenInstanceForCwd={spawnClaudeForCwd}
                    onOpenTerminalForCwd={spawnTerminalForCwd}
                  />
                )}
                {activeModule === 'notes' && <ModuleNotes projects={projects} />}
                <Box
                  sx={{
                    display: activeModule === 'instances' ? 'flex' : 'none',
                    flex: 1,
                    flexDirection: 'column',
                    minHeight: 0,
                  }}
                >
                  <SlotRegistryProvider>
                      {layoutLoaded && (
                        <WorkspaceRoot
                          layout={layout}
                          tabs={tabs}
                          instances={instances}
                          actions={layoutActions}
                          dragInProgress={dragging}
                          onCloseColumn={(id) => {
                            const inst = instances.find((i) => i.id === id);
                            const isLive = inst
                              ? !['finished', 'crashed', 'suspended'].includes(inst.status)
                              : false;
                            handleRemove(id, isLive);
                          }}
                          onRestartColumn={(id) => void invoke('restartInstance', { instanceId: id })}
                          onHideSession={handleHideSession}
                          onUnhideSession={unhideInstance}
                          onSetTask={(instanceId, taskId) => void setTask(instanceId, taskId)}
                          onAddSession={(tabId) => {
                            const cwd = cwdForTab(tabId as TabId);
                            if (cwd) void doSpawn(cwd);
                          }}
                          onAddSessionAfter={(afterInstanceId, cwd, kind) =>
                            void doSpawn(cwd, kind, afterInstanceId)
                          }
                          dashboardOnNew={() => setNewOpen(true)}
                        />
                      )}
                      <TerminalPool instances={instances} />
                  </SlotRegistryProvider>
                </Box>
              </Box>
            </Box>
            </DndContext>
          </Box>
          <NewInstanceModal
            open={newOpen}
            defaultCwd={pendingNewCwd}
            onClose={() => {
              setNewOpen(false);
              setPendingNewCwd(undefined);
            }}
            onSpawn={(cwd, kind) => void doSpawn(cwd, kind)}
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
                The session in{' '}
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
          <Dialog
            open={Boolean(confirmTabClose)}
            onClose={() => setConfirmTabClose(null)}
            maxWidth="xs"
            fullWidth
          >
            <DialogTitle>Close {confirmTabClose?.label}?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                {confirmTabClose?.liveCount === 1
                  ? 'A session in this tab is still running. Closing the tab kills the pty and forgets the session. Use Cancel to keep it alive.'
                  : `${confirmTabClose?.liveCount ?? 0} sessions in this tab are still running. Closing the tab kills the ptys and forgets the sessions. Use Cancel to keep them alive.`}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmTabClose(null)}>Cancel</Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => {
                  if (confirmTabClose) {
                    for (const id of confirmTabClose.ids) void remove(id);
                  }
                  setConfirmTabClose(null);
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
