import { useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { createWebSocketTransport } from '@watchtower/transport';
import {
  parseConnection, connectionToWsUrl, loadConnection, saveConnection, type Connection,
} from './connection.js';
import { probeInstances, watchState } from './probe.js';

const store = {
  get: async (k: string) => (await Preferences.get({ key: k })).value,
  set: async (k: string, v: string) => { await Preferences.set({ key: k, value: v }); },
};

export function App() {
  const [form, setForm] = useState({ host: '', port: '7445', token: '' });
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [instances, setInstances] = useState<unknown[]>([]);
  const [pushes, setPushes] = useState(0);

  useEffect(() => {
    void loadConnection(store).then((c) => {
      if (c) setForm({ host: c.host, port: String(c.port), token: c.token });
    });
  }, []);

  async function connect() {
    setError(null);
    const parsed = parseConnection(form);
    if (!parsed.ok) { setError(parsed.error); return; }
    const c: Connection = parsed.value;
    await saveConnection(store, c);
    setStatus('connecting');
    try {
      const bridge = createWebSocketTransport({ url: connectionToWsUrl(c), token: c.token });
      const list = await probeInstances(bridge);
      setInstances(list);
      watchState(bridge, () => setPushes((n) => n + 1));
      setStatus('connected');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Watchtower iPad — skeleton</h1>
      <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
        <input placeholder="Mac LAN host" value={form.host}
          onChange={(e) => setForm({ ...form, host: e.target.value })} />
        <input placeholder="port" value={form.port}
          onChange={(e) => setForm({ ...form, port: e.target.value })} />
        <input placeholder="token" value={form.token}
          onChange={(e) => setForm({ ...form, token: e.target.value })} />
        <button onClick={() => void connect()}>Connect</button>
      </div>
      <p>status: <b>{status}</b>{error ? ` — ${error}` : ''}</p>
      <p>pushes received: {pushes}</p>
      <ul>{instances.map((i, n) => <li key={n}>{JSON.stringify(i)}</li>)}</ul>
    </main>
  );
}
