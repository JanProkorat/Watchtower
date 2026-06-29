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
import { AuthBlockBanner } from './components/AuthBlockBanner.js';
import { NotificationHub } from './components/NotificationHub.js';
import { WakeButton } from './components/WakeButton.js';
import { text } from './theme/glass.js';

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

function InstancesModule({ activeId, setActiveId, ackedIds, connection }: { activeId: string | null; setActiveId: (id: string | null) => void; ackedIds: ReadonlySet<string>; connection: Connection }) {
  const { status } = useConnection();
  const { instances } = useInstances();
  const { projects } = useProjects();
  const [spawnOpen, setSpawnOpen] = useState(false);

  // Once we've had a live connection, any later non-connected state is a
  // *reconnect*. Tracking this lets the banner stay steady (one message, one
  // colour) for the whole reconnect instead of flipping connecting↔disconnected.
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => { if (status === 'connected') setEverConnected(true); }, [status]);
  const disconnected = status !== 'connected';

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
      {/* Connection banner — stays visible for the whole reconnect (shown for
          both 'connecting' and 'disconnected'), so it doesn't blink. One steady
          message/colour once a live connection has been lost. */}
      {disconnected && (
        <div
          role="status"
          aria-live="polite"
          style={{
            flexShrink: 0,
            backgroundColor: everConnected ? '#3b1f1f' : '#1e3a5f',
            borderBottom: `1px solid ${everConnected ? '#7f1d1d' : '#2563eb'}`,
            color: everConnected ? '#fca5a5' : '#93c5fd',
            fontSize: 13,
            fontWeight: 500,
            padding: '6px 16px',
            textAlign: 'center',
            letterSpacing: 0.2,
          }}
        >
          {everConnected ? 'Mac odpojen – obnovuji připojení…' : 'Připojuji k Macu…'}
          {connection.mac && (
            <div style={{ marginTop: 8 }}>
              <WakeButton connection={connection} />
            </div>
          )}
        </div>
      )}

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
              color: '#4b5563',
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
  const { bridge } = useConnection();

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

  return (
    <div
      style={{
        // Column: optional auth-block banner on top, then the rail + content row.
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
      {/* Auth-block banner — only visible when instances view is active and
          at least one instance is blocked waiting for browser auth. */}
      {activeModule === 'instances' && (
        <AuthBlockBanner
          blockedIds={blockedIds}
          onOpen={() => setActiveModule('remote')}
        />
      )}

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
          <InstancesModule activeId={activeId} setActiveId={selectInstance} ackedIds={ackedIds} connection={connection} />
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
        backgroundColor: '#0e0f12',
        color: '#e5e7eb',
        minHeight: '100%',
        boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: '#c4b8ff' }}>
        Watchtower
      </h1>
      <div style={{ display: 'grid', gap: 10, maxWidth: 360 }}>
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
        <div style={{ borderTop: '1px solid #2e3038', margin: '6px 0', paddingTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 8 }}>Probuzení (Wake-on-LAN)</div>
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
            borderRadius: 8,
            border: 'none',
            backgroundColor: connecting ? '#4b4a72' : '#7c6df0',
            color: connecting ? '#9ca3af' : '#fff',
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
              borderRadius: 8,
              backgroundColor: '#2d1515',
              border: '1px solid #7f1d1d',
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
  borderRadius: 8,
  border: '1px solid #2e3038',
  backgroundColor: '#1a1b1f',
  color: '#e5e7eb',
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
