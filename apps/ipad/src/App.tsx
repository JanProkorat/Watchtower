import { useCallback, useEffect, useState } from 'react';
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
import { TerminalView } from './components/TerminalView.js';
import { SpawnModal } from './components/SpawnModal.js';
import { RemoteMacView } from './components/RemoteMacView.js';
import { BillingArea } from './components/billing/BillingArea.js';
import { NotificationHub } from './components/NotificationHub.js';
import { WakeButton } from './components/WakeButton.js';
import { ToastStack, type ToastItem } from './components/ToastStack.js';
import { text, glassPanel, glassFillStrong, statusGlass, ctaGradient, ctaGlow, accent } from './theme/glass.js';

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

// ---------------------------------------------------------------------------
// InstancesModule — the instances view content (Rail lives in Shell now)
// ---------------------------------------------------------------------------

function InstancesModule({ activeId, setActiveId, ackedIds }: { activeId: string | null; setActiveId: (id: string | null) => void; ackedIds: ReadonlySet<string> }) {
  const { instances } = useInstances();
  const { projects } = useProjects();
  const [spawnOpen, setSpawnOpen] = useState(false);

  const nonLiveInstances = instances.filter((i) => NON_LIVE_STATUSES.has(i.status));

  function handleSpawned(id: string) {
    setActiveId(id);
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

      {/* Terminal body */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {activeId ? (
          <TerminalView key={activeId} instanceId={activeId} />
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
  const { bridge, status } = useConnection();

  // Once we've had a live connection, any later non-connected state is a
  // *reconnect* — keep the status toast steady (one message/colour) instead of
  // flickering connecting↔disconnected.
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => { if (status === 'connected') setEverConnected(true); }, [status]);

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
  // content (never push layout). Only the Mac-dependent modules show the
  // connection toast/pill — billing has its own (Supabase) status elsewhere.
  const macModule = activeModule === 'instances' || activeModule === 'remote';
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
    toasts.push({
      id: 'conn',
      state: everConnected ? 'disconnected' : 'connecting',
      title: everConnected ? 'Mac odpojen' : 'Připojuji k Macu…',
      subtitle: everConnected ? 'obnovuji připojení…' : undefined,
      action: connection.mac ? <WakeButton connection={connection} /> : undefined,
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
        {/* Shared left rail — active across all modules */}
        <Rail
          active={activeModule}
          billingSection={billingSection}
          onSelect={setActiveModule}
          onSelectBillingTab={selectBilling}
          notificationCount={attention.length}
          onOpenNotifications={() => setHubOpen(true)}
        />

        {/* Module content */}
        {activeModule === 'instances' ? (
          <InstancesModule activeId={activeId} setActiveId={selectInstance} ackedIds={ackedIds} />
        ) : activeModule === 'dashboard' || activeModule === 'billing' ? (
          <BillingArea module={activeModule} section={billingSection} />
        ) : (
          <RemoteMacView connection={connection} />
        )}

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
