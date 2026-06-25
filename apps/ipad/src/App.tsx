import { useEffect, useState } from 'react';
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
import { usePings } from './state/usePings.js';
import { registerForPush } from './state/pushRegistration.js';
import { Rail, type RailModule } from './components/Rail.js';
import { TabStrip } from './components/TabStrip.js';
import { TerminalView } from './components/TerminalView.js';
import { SpawnModal } from './components/SpawnModal.js';
import { RemoteMacView } from './components/RemoteMacView.js';
import { AuthBlockBanner } from './components/AuthBlockBanner.js';
import { PingReply } from './components/PingReply.js';

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

function InstancesModule() {
  const { status } = useConnection();
  const { instances } = useInstances();
  const { projects } = useProjects();
  const { activeId, setActiveId } = useActiveTerminal();
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
        </div>
      )}

      {/* TabStrip + terminal body */}
      <TabStrip
        instances={instances}
        projects={projects}
        activeInstanceId={activeId}
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
  const [activeModule, setActiveModule] = useState<RailModule>('instances');
  const { blockedIds } = useAuthBlock();
  const { bridge } = useConnection();
  const { ping, clear: clearPing, seedPing } = usePings();

  // Register for push notifications once on mount (iOS only; no-op on web).
  useEffect(() => {
    void registerForPush({
      requestPermission: async () =>
        (await PushNotifications.requestPermissions()).receive === 'granted',
      register: () => PushNotifications.register(),
      onToken: (cb) => {
        void PushNotifications.addListener('registration', (t) => cb(t.value));
      },
      sendToken: (t) => bridge.invoke('push:registerDevice', { token: t, platform: 'ios' }).then(() => undefined),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle tap on an attentionPing push notification: fetch the ping from the
  // orchestrator and seed it into the store so the reply box appears immediately
  // when the app opens from background.
  useEffect(() => {
    void PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification.data as Record<string, unknown> | undefined;
      const pingId = data?.pingId;
      if (typeof pingId !== 'number') return;
      void bridge.invoke('messaging:getPing', { pingId }).then((res) => {
        const r = res as { ok: boolean; ping?: { instanceId: string; pingId: number; kind: string; title: string; body: string } };
        if (r.ok && r.ping) {
          seedPing(r.ping);
        }
      });
    });
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
        backgroundColor: '#0e0f12',
        fontFamily: 'system-ui, sans-serif',
        color: '#e5e7eb',
      }}
    >
      {/* Ping reply banner — visible on any tab when an instance sends an
          attentionPing (or user taps a push notification). */}
      {ping && <PingReply ping={ping} onClear={clearPing} />}

      {/* Auth-block banner — only visible when instances view is active and
          at least one instance is blocked waiting for browser auth. */}
      {activeModule === 'instances' && (
        <AuthBlockBanner
          blockedIds={blockedIds}
          onOpen={() => setActiveModule('remote')}
        />
      )}

      {/* Content row: shared left rail + module content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
        {/* Shared left rail — active across all modules */}
        <Rail active={activeModule} onSelect={setActiveModule} />

        {/* Module content */}
        {activeModule === 'instances' ? (
          <InstancesModule />
        ) : (
          <RemoteMacView connection={connection} />
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
  const [form, setForm] = useState({ host: '', port: '7445', token: '' });
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Load a previously saved connection on mount.
  useEffect(() => {
    void loadConnection(store).then((c) => {
      if (c) {
        setForm({ host: c.host, port: String(c.port), token: c.token });
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
