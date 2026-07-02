import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Preferences } from '@capacitor/preferences';
import { PushNotifications } from '@capacitor/push-notifications';
import {
  parseConnection, loadConnection, saveConnection, type Connection,
} from './connection.js';
import { ConnectionProvider, useConnection } from './state/connectionContext.js';
import { useInstances } from './state/useInstances.js';
import { useProjects } from './state/useProjects.js';
import { useActiveTerminal } from './state/useActiveTerminal.js';
import { useAuthBlock } from './state/useAuthBlock.js';
import { useAttention } from './state/useAttention.js';
import { registerForPush } from './state/pushRegistration.js';
import { Rail, type RailModule, type BillingSection } from './components/Rail.js';
import { TabStrip } from './components/TabStrip.js';
import { WorkspacePane } from './components/WorkspacePane.js';
import { useWorkspaceLayout } from './state/useWorkspaceLayout.js';
import { groupInstancesByProject } from '@watchtower/shared/groupInstances.js';
import { SpawnModal } from './components/SpawnModal.js';
import { BillingArea } from '@watchtower/module-timetracker';
import { NotificationHub } from './components/NotificationHub.js';
import { WakeButton } from './components/WakeButton.js';
import { ToastStack, type ToastItem } from './components/ToastStack.js';

// Lazy-loaded so their heavy dependency graphs stay off the startup critical
// path. RemoteMacView pulls in noVNC, whose module has a TOP-LEVEL AWAIT (a
// hardware H264-decode probe); statically importing it gated the entire React
// mount on that probe, freezing the app for the first seconds. Neither module
// is the startup (dashboard) view, so deferring them is free.
const RemoteMacView = lazy(() =>
  import('./components/RemoteMacView.js').then((m) => ({ default: m.RemoteMacView })),
);
const SettingsModule = lazy(() =>
  import('./components/SettingsModule.js').then((m) => ({ default: m.SettingsModule })),
);
import { text, glassPanel, glassFillStrong, statusGlass, ctaGradient, ctaGlow, accent } from '@watchtower/ui-core';

// Retry button for the connection toast — translucent glass; `color: inherit`
// picks up the toast's status accent (red when disconnected).
const toastRetryBtn: CSSProperties = {
  padding: '6px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.22)',
  background: 'rgba(255,255,255,0.10)', color: 'inherit', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};

// ---------------------------------------------------------------------------
// Capacitor Preferences store (same helper as before)
// ---------------------------------------------------------------------------

const store = {
  get: async (k: string) => (await Preferences.get({ key: k })).value,
  set: async (k: string, v: string) => { await Preferences.set({ key: k, value: v }); },
};

// ---------------------------------------------------------------------------
// Non-live statuses — instances eligible for restart in the spawn modal
// ---------------------------------------------------------------------------

const NON_LIVE_STATUSES = new Set(['finished', 'crashed', 'suspended']);

// A project-group tab's workspace-layout key. Mirrors groupInstancesByProject's
// grouping: real projects key by id, unmatched instances share the 'other' tab.
function tabKey(projectId: number | null): string {
  return projectId == null ? 'other' : `project:${projectId}`;
}

// ---------------------------------------------------------------------------
// InstancesModule — the instances view content (Rail lives in Shell now)
// ---------------------------------------------------------------------------

function InstancesModule({ activeId, setActiveId, ackedIds }: { activeId: string | null; setActiveId: (id: string | null) => void; ackedIds: ReadonlySet<string> }) {
  const { instances } = useInstances();
  const { projects } = useProjects();
  const { bridge } = useConnection();
  const workspace = useWorkspaceLayout();
  const [spawnOpen, setSpawnOpen] = useState(false);

  const nonLiveInstances = instances.filter((i) => NON_LIVE_STATUSES.has(i.status));

  // Which project-group tab owns the currently-selected instance? Its workspace
  // layout (one tree per tab) is what the WorkspacePane tiles. Only the active
  // tab's terminals are mounted; switching tabs swaps whole layouts.
  const groups = useMemo(() => groupInstancesByProject(instances, projects), [instances, projects]);
  const activeGroup = activeId ? groups.find((g) => g.instanceIds.includes(activeId)) ?? null : null;
  const activeTabKey = activeGroup ? tabKey(activeGroup.projectId) : null;

  // Picker label for an instance. Instances in one project group share a cwd
  // (grouping matches cwd===folderPath), so the folder basename alone can't tell
  // them apart — append a short id tail for uniqueness.
  const instanceLabel = useCallback((id: string): string => {
    const inst = instances.find((i) => i.id === id);
    if (!inst) return id;
    const base = inst.cwd.split('/').filter(Boolean).pop() ?? inst.cwd;
    return `${base} · ${id.slice(-4)}`;
  }, [instances]);

  // #2 — Default to the first tab's first instance instead of the empty
  // "Vyberte instanci" state. Also re-selects when the active instance goes away
  // (e.g. killed, or a stale id after reconnect) so the view never gets stuck.
  useEffect(() => {
    const valid = activeId != null && groups.some((g) => g.instanceIds.includes(activeId));
    if (!valid && groups.length > 0) {
      const first = groups[0]?.instanceIds[0];
      if (first) setActiveId(first);
    }
  }, [activeId, groups, setActiveId]);

  // Seed the active tab's tiled default (all live instances) into state the
  // first time it's shown, so reconnecting/relaunching displays every running
  // instance — and so focus/resize don't collapse it to one pane.
  useEffect(() => {
    if (activeTabKey && activeGroup && activeId) {
      workspace.ensureTab(activeTabKey, activeGroup.instanceIds, activeId);
    }
  }, [activeTabKey, activeGroup, activeId, workspace]);

  // #3 — When a NEW instance appears in the active project tab (e.g. just
  // spawned), tile it into the current layout (split right) so it's visible
  // immediately instead of hidden behind the single-pane default. Pre-existing
  // instances on first load are seeded as "seen" so they are NOT auto-tiled
  // (keeps the launch view uncluttered); only later arrivals are split in.
  const seenInstanceIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = instances.map((i) => i.id);
    if (seenInstanceIds.current === null) {
      if (ids.length === 0) return; // wait for the first real load
      seenInstanceIds.current = new Set(ids);
      return;
    }
    const seen = seenInstanceIds.current;
    const fresh = ids.filter((id) => !seen.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => seen.add(id));
    if (!activeTabKey || !activeGroup || !activeId) return;
    for (const id of fresh) {
      if (!activeGroup.instanceIds.includes(id)) continue; // different tab — leave it
      // Append far-right + even the widths (2->halves, 3->thirds, ...).
      workspace.actions.appendRight(activeTabKey, id, activeId);
    }
    // Only react to instance-list changes; active-tab context is read fresh each run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances]);

  // Loader while a just-spawned instance boots on the Mac and appears in the
  // list. Cleared once it shows up (the #3 effect then tiles it in).
  const [pendingSpawnId, setPendingSpawnId] = useState<string | null>(null);
  useEffect(() => {
    if (pendingSpawnId && instances.some((i) => i.id === pendingSpawnId)) {
      setPendingSpawnId(null);
    }
  }, [pendingSpawnId, instances]);

  function handleSpawned(id: string) {
    // Don't hijack activeId here: keeping it on the current instance preserves
    // the tab's default seed so the #3 effect can append the new instance as a
    // rightmost pane. First-ever instance is picked up by the #2 effect.
    setPendingSpawnId(id);
    setSpawnOpen(false);
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Connection status is surfaced as a top-right toast at the Shell level
          (overlay, never pushes this content) — see ToastStack in Shell. */}

      {/* TabStrip + terminal body */}
      <TabStrip
        instances={instances}
        projects={projects}
        activeInstanceId={activeId}
        ackedIds={ackedIds}
        onSelectInstance={setActiveId}
        onNew={() => setSpawnOpen(true)}
      />

      {/* Terminal body — padded so the terminal panel floats off the tab strip
          and window edges, consistent with the glass surfaces around it. */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', padding: '10px 12px 12px', boxSizing: 'border-box' }}>
        {activeId && activeTabKey ? (
          <WorkspacePane
            key={activeTabKey}
            layout={workspace.getTabLayout(activeTabKey, activeGroup?.instanceIds ?? [activeId], activeId)}
            onFocusLeaf={(leafId, instanceId) => {
              workspace.actions.focus(activeTabKey, leafId, activeId);
              setActiveId(instanceId);
            }}
            onResize={(splitId, sizes) => workspace.actions.resize(activeTabKey, splitId, sizes, activeId)}
            onSplit={(leafId, dir, position, instanceId) =>
              workspace.actions.split(activeTabKey, leafId, dir, position, instanceId)}
            onClose={(leafId) => workspace.actions.close(activeTabKey, leafId, activeId)}
            onKill={(leafId, instanceId) => {
              // Terminate the session on the Mac AND drop the pane. removeInstance
              // kills the pty and removes the row, so it won't linger.
              void bridge.invoke('removeInstance', { instanceId }).catch(() => { /* surfaced via reconnect refetch */ });
              workspace.actions.close(activeTabKey, leafId, activeId);
            }}
            groupInstanceIds={activeGroup?.instanceIds ?? []}
            labelFor={instanceLabel}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: text.dim,
              fontSize: 15,
              fontWeight: 500,
              letterSpacing: 0.2,
            }}
          >
            Vyberte instanci
          </div>
        )}

        {/* Spawn loader — a just-created instance takes a moment to boot on the
            Mac; show a chip so it's clear something's happening. Top-center to
            clear the hardware-keyboard accessory bar at the bottom. */}
        {pendingSpawnId && (
          <div
            style={{
              position: 'absolute',
              top: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '8px 14px',
              borderRadius: 999,
              background: glassFillStrong,
              border: '1px solid rgba(255,255,255,0.14)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              color: text.secondary,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.25)',
                borderTopColor: accent,
                animation: 'wt-spin 0.8s linear infinite',
                display: 'inline-block',
              }}
            />
            Spouštím instanci…
          </div>
        )}
      </div>

      {/* Spawn modal */}
      <SpawnModal
        open={spawnOpen}
        projects={projects}
        nonLiveInstances={nonLiveInstances}
        onClose={() => setSpawnOpen(false)}
        onSpawned={handleSpawned}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell — rendered inside <ConnectionProvider>; owns module-selection state
// and the shared Rail. useAuthBlock() must be called inside the provider.
// ---------------------------------------------------------------------------

interface ShellProps {
  connection: Connection;
}

function Shell({ connection }: ShellProps) {
  const [activeModule, setActiveModule] = useState<RailModule>('dashboard');
  const [billingSection, setBillingSection] = useState<BillingSection>('earnings');
  const { activeId, setActiveId } = useActiveTerminal();
  const { items: attention, ackedIds, acknowledge } = useAttention();
  const [hubOpen, setHubOpen] = useState(false);
  const { blockedIds } = useAuthBlock();
  const { bridge, status, reconnect } = useConnection();

  // Once we've had a live connection, any later non-connected state is a
  // *reconnect* — keep the status toast steady (one message/colour) instead of
  // flickering connecting↔disconnected.
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => { if (status === 'connected') setEverConnected(true); }, [status]);

  // Track whether a connect attempt has actually failed. Lets the toast show a
  // steady "can't connect" (with retry) instead of a perpetual "connecting…"
  // when the Mac is unreachable — but still shows "connecting…" during the
  // genuine first attempt. Cleared on a live connect and on an explicit retry.
  const [everFailed, setEverFailed] = useState(false);
  useEffect(() => {
    if (status === 'disconnected') setEverFailed(true);
    else if (status === 'connected') setEverFailed(false);
  }, [status]);
  const retryConnect = useCallback(() => { setEverFailed(false); reconnect(); }, [reconnect]);

  // Immersive (fullscreen) mode for the Remote Mac view — hides the rail so the
  // remote screen fills the whole window. Only meaningful on the 'remote'
  // module; auto-reset when navigating away so the rail can't get stuck hidden.
  const [immersive, setImmersive] = useState(false);
  useEffect(() => { if (activeModule !== 'remote') setImmersive(false); }, [activeModule]);

  // Select (focus) an instance and mark it seen — clears its tab ⚠️ and drops
  // it from the bell count. Used by the hub, push taps, and tab taps.
  // Stable (setActiveId is a state setter, acknowledge is memoized) so the
  // push-tap listener below can close over it safely.
  const selectInstance = useCallback((id: string | null) => {
    setActiveId(id);
    if (id) acknowledge(id);
  }, [setActiveId, acknowledge]);

  // Rail child tap: switch to billing and route to the chosen sub-section.
  const selectBilling = useCallback((tab: BillingSection) => {
    setActiveModule('billing');
    setBillingSection(tab);
  }, []);

  // Register for push notifications once on mount (iOS only; no-op on web).
  useEffect(() => {
    let listenerHandle: ReturnType<typeof PushNotifications.addListener> | null = null;
    void registerForPush({
      requestPermission: async () =>
        (await PushNotifications.requestPermissions()).receive === 'granted',
      register: () => PushNotifications.register(),
      onToken: (cb) => {
        listenerHandle = PushNotifications.addListener('registration', (t) => cb(t.value));
      },
      sendToken: (t) => bridge.invoke('push:registerDevice', { token: t, platform: 'ios' }).then(() => undefined),
    });
    return () => { if (listenerHandle) void (listenerHandle as Promise<{ remove(): void }>).then((l) => l.remove()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle tap on a push notification: navigate to the instance directly.
  useEffect(() => {
    const h = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification?.data as { instanceId?: unknown } | undefined;
      const id = data?.instanceId;
      if (typeof id === 'string' && id) { setActiveModule('instances'); selectInstance(id); }
    });
    return () => { void h.then((l) => l.remove()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mac-connection status + auth-block surface as top-right toasts that OVERLAY
  // content (never push layout). Only the Instances module shows the connection
  // toast — the Remote Mac view renders its own VNC status banner (and wake), so
  // a second floating toast there would be redundant; billing has its own
  // (Supabase) status elsewhere.
  const macModule = activeModule === 'instances';
  const toasts: ToastItem[] = [];
  if (activeModule === 'instances' && blockedIds.size > 0) {
    toasts.push({
      id: 'auth',
      state: 'authBlock',
      title: 'Mac čeká na přihlášení',
      subtitle: 'otevřete obrazovku Macu a dokončete přihlášení',
      action: (
        <button
          onClick={() => setActiveModule('remote')}
          style={{
            padding: '6px 12px', borderRadius: 9, border: 'none',
            background: ctaGradient, color: '#fff', fontSize: 12, fontWeight: 600,
            boxShadow: ctaGlow, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}
        >
          Otevřít obrazovku Macu
        </button>
      ),
    });
  }
  if (macModule && status !== 'connected') {
    // Three cases: dropped after being live (reconnecting), never connected and
    // a first attempt already failed (can't connect), or the genuine initial
    // attempt still in progress (connecting).
    const reconnecting = everConnected;
    const cannotConnect = !everConnected && everFailed;
    toasts.push({
      id: 'conn',
      state: reconnecting || cannotConnect ? 'disconnected' : 'connecting',
      title: reconnecting ? 'Mac odpojen' : cannotConnect ? 'Nelze se připojit k Macu' : 'Připojuji k Macu…',
      subtitle: reconnecting ? 'obnovuji připojení…'
        : cannotConnect ? 'zkontrolujte, že na Macu běží Watchtower' : undefined,
      action: (reconnecting || cannotConnect) ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={retryConnect} style={toastRetryBtn}>Zkusit znovu</button>
          {connection.mac && <WakeButton connection={connection} />}
        </div>
      ) : undefined,
    });
  }

  return (
    <div
      style={{
        // A column: the rail + content row. Status banners are now top-right
        // toasts (overlay, never push), so there's no in-flow banner row.
        // The outer #root (index.css) already applies the safe-area insets, so this
        // fills #root's content box and never sits under the iOS status bar.
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        // Transparent so the ambient lit #root background (index.css) shows
        // through — the glass chrome floats over it. Token from theme/glass.ts.
        backgroundColor: 'transparent',
        fontFamily: 'system-ui, sans-serif',
        color: text.primary,
      }}
    >
      {/* Content row: shared left rail + module content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, position: 'relative' }}>
        {/* Shared left rail — active across all modules. Hidden while the
            Remote Mac view is in immersive (fullscreen) mode. */}
        {!immersive && (
          <Rail
            active={activeModule}
            billingSection={billingSection}
            onSelect={setActiveModule}
            onSelectBillingTab={selectBilling}
            notificationCount={attention.length}
            onOpenNotifications={() => setHubOpen(true)}
          />
        )}

        {/* Module content. Suspense covers the lazy modules (Remote Mac,
            Settings); the eager dashboard/instances views never suspend. */}
        <Suspense
          fallback={
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: text.dim, fontSize: 14 }}>
              Načítání…
            </div>
          }
        >
          {activeModule === 'instances' ? (
            <InstancesModule activeId={activeId} setActiveId={selectInstance} ackedIds={ackedIds} />
          ) : activeModule === 'dashboard' || activeModule === 'billing' ? (
            <BillingArea module={activeModule} section={billingSection} />
          ) : activeModule === 'settings' ? (
            <SettingsModule />
          ) : (
            <RemoteMacView
              connection={connection}
              immersive={immersive}
              onToggleImmersive={() => setImmersive((v) => !v)}
            />
          )}
        </Suspense>

        {/* Notification hub popover */}
        {hubOpen && (
          <NotificationHub
            items={attention}
            onClose={() => setHubOpen(false)}
            onSelect={(id) => { setActiveModule('instances'); selectInstance(id); setHubOpen(false); }}
          />
        )}

        {/* Floating status toasts — overlay, never push content */}
        <ToastStack items={toasts} />

        {/* Connected pill — bottom-right, only on Mac-dependent modules */}
        {macModule && status === 'connected' && (
          <div
            style={{
              ...statusGlass('connected').panel,
              position: 'absolute',
              bottom: 16,
              right: 16,
              zIndex: 40,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 13px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 500,
              color: '#9be7c0',
            }}
          >
            <span style={statusGlass('connected').dot} />
            Připojeno
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection form — shown until a valid Connection is loaded/entered
// ---------------------------------------------------------------------------

interface ConnectionFormProps {
  onConnected(c: Connection): void;
}

function ConnectionForm({ onConnected }: ConnectionFormProps) {
  const [form, setForm] = useState({ host: '', port: '7445', token: '', mac: '', lanIp: '', wanHost: '', wanPort: '' });
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Load a previously saved connection on mount.
  useEffect(() => {
    void loadConnection(store).then((c) => {
      if (c) {
        setForm({
          host: c.host, port: String(c.port), token: c.token,
          mac: c.mac ?? '', lanIp: c.lanIp ?? '', wanHost: c.wanHost ?? '', wanPort: c.wanPort ? String(c.wanPort) : '',
        });
        // Auto-connect if we have a saved connection.
        onConnected(c);
      }
    });
    // onConnected is stable (defined at the App level), no dep needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setError(null);
    const parsed = parseConnection(form);
    if (!parsed.ok) { setError(parsed.error); return; }
    setConnecting(true);
    try {
      await saveConnection(store, parsed.value);
      onConnected(parsed.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConnecting(false);
    }
  }

  const parsedForWake = parseConnection(form);
  const wakeConnection = parsedForWake.ok
    ? parsedForWake.value
    : { host: form.host, port: 0, token: form.token,
        mac: form.mac.trim() || undefined, lanIp: form.lanIp.trim() || undefined,
        wanHost: form.wanHost.trim() || undefined,
        wanPort: form.wanPort.trim() ? Number(form.wanPort) : undefined };

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
        // Transparent over the ambient lit #root (index.css); the form floats
        // as a glass card.
        background: 'transparent',
        color: text.primary,
        minHeight: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 18, color: '#c9bdff', letterSpacing: 0.2 }}>
        Watchtower
      </h1>
      <div style={{ ...glassPanel({ radius: 18 }), display: 'grid', gap: 10, width: '100%', maxWidth: 380, padding: 20 }}>
        <input
          placeholder="Mac LAN host"
          value={form.host}
          onChange={(e) => setForm({ ...form, host: e.target.value })}
          style={inputStyle}
        />
        <input
          placeholder="port"
          value={form.port}
          onChange={(e) => setForm({ ...form, port: e.target.value })}
          style={inputStyle}
        />
        <input
          placeholder="token"
          type="password"
          value={form.token}
          onChange={(e) => setForm({ ...form, token: e.target.value })}
          style={inputStyle}
        />
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', margin: '6px 0', paddingTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: text.muted, marginBottom: 8 }}>Probuzení (Wake-on-LAN)</div>
          <div style={{ display: 'grid', gap: 10 }}>
            <input placeholder="MAC adresa (AA:BB:CC:DD:EE:FF)" value={form.mac}
              onChange={(e) => setForm({ ...form, mac: e.target.value })} style={inputStyle} />
            <input placeholder="LAN IP Macu (doma)" value={form.lanIp}
              onChange={(e) => setForm({ ...form, lanIp: e.target.value })} style={inputStyle} />
            <input placeholder="DDNS host (mimo síť)" value={form.wanHost}
              onChange={(e) => setForm({ ...form, wanHost: e.target.value })} style={inputStyle} />
            <input placeholder="DDNS port (výchozí 9)" value={form.wanPort}
              onChange={(e) => setForm({ ...form, wanPort: e.target.value })} style={inputStyle} />
            <WakeButton connection={wakeConnection} />
          </div>
        </div>
        <button
          onClick={() => void handleConnect()}
          disabled={connecting}
          style={{
            padding: '10px 0',
            borderRadius: 12,
            border: 'none',
            background: connecting ? 'rgba(124,109,240,0.35)' : ctaGradient,
            boxShadow: connecting ? 'none' : ctaGlow,
            color: connecting ? text.muted : '#fff',
            fontSize: 15,
            fontWeight: 600,
            cursor: connecting ? 'not-allowed' : 'pointer',
          }}
        >
          {connecting ? 'Připojuji…' : 'Připojit'}
        </button>
        {error && (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              background: 'rgba(110,24,24,0.32)',
              border: '1px solid rgba(248,113,113,0.40)',
              color: '#fca5a5',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.13)',
  backgroundColor: 'rgba(255,255,255,0.07)',
  color: text.primary,
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
  outline: 'none',
};

// ---------------------------------------------------------------------------
// App — top-level gate: connection form → module layout
// ---------------------------------------------------------------------------

export function App() {
  const [connection, setConnection] = useState<Connection | null>(null);

  if (!connection) {
    return <ConnectionForm onConnected={setConnection} />;
  }

  return (
    <ConnectionProvider connection={connection}>
      <Shell connection={connection} />
    </ConnectionProvider>
  );
}
