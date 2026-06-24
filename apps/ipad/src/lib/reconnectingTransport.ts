// apps/ipad/src/lib/reconnectingTransport.ts
import { createWebSocketTransport } from '@watchtower/transport';

type Inner = { invoke(k: string, p: unknown): Promise<unknown>; on(k: string, h: (p: unknown) => void): () => void; close(): void };
type Factory = (opts: { url: string; token: string; onClose?: () => void }) => Inner;
export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

export function createReconnectingTransport(
  conn: { url: string; token: string },
  cfg?: { factory?: Factory; backoffMs?: (attempt: number) => number },
) {
  const factory = cfg?.factory ?? (createWebSocketTransport as unknown as Factory);
  const backoff = cfg?.backoffMs ?? ((n) => Math.min(1000 * 2 ** n, 15000));
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const statusCbs = new Set<(s: ConnStatus) => void>();
  let inner: Inner | null = null;
  let attempt = 0;
  let closed = false;
  let currentStatus: ConnStatus = 'connecting';

  const setStatus = (s: ConnStatus) => {
    currentStatus = s;
    statusCbs.forEach((cb) => cb(s));
  };

  const bindAll = (t: Inner) => {
    for (const [kind, set] of handlers) for (const h of set) t.on(kind, h);
  };

  const connect = () => {
    if (closed) return;
    setStatus('connecting');
    inner = factory({
      url: conn.url, token: conn.token,
      onClose: () => {
        if (closed) return;
        setStatus('disconnected');
        const wait = backoff(attempt++);
        if (wait <= 0) queueMicrotask(connect);
        else setTimeout(connect, wait);
      },
    });
    bindAll(inner);
    setStatus('connected');
    attempt = 0;
  };
  connect();

  return {
    invoke: (k: string, p: unknown) => inner ? inner.invoke(k, p) : Promise.reject(new Error('not connected')),
    on: (kind: string, h: (p: unknown) => void) => {
      let set = handlers.get(kind); if (!set) { set = new Set(); handlers.set(kind, set); } set.add(h);
      const offInner = inner?.on(kind, h);
      return () => { set!.delete(h); offInner?.(); };
    },
    onStatus: (cb: (s: ConnStatus) => void) => {
      // Replay the latest status immediately — the initial connect() runs during
      // construction (before React's connectionContext subscribes via useEffect),
      // so without this replay a late subscriber would miss 'connected' and stay
      // stuck on its initial value.
      cb(currentStatus);
      statusCbs.add(cb);
      return () => statusCbs.delete(cb);
    },
    close: () => { closed = true; inner?.close(); },
  };
}
