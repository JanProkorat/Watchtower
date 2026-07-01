// apps/ipad/src/lib/reconnectingTransport.ts
import { createWebSocketTransport } from '@watchtower/transport';

type Inner = { invoke(k: string, p: unknown): Promise<unknown>; on(k: string, h: (p: unknown) => void): () => void; close(): void };
type Factory = (opts: { url: string; token: string; onOpen?: () => void; onClose?: () => void }) => Inner;
export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

export function createReconnectingTransport(
  conn: { url: string; token: string },
  cfg?: { factory?: Factory; backoffMs?: (attempt: number) => number; connectTimeoutMs?: number },
) {
  const factory = cfg?.factory ?? (createWebSocketTransport as unknown as Factory);
  const backoff = cfg?.backoffMs ?? ((n) => Math.min(1000 * 2 ** n, 15000));
  // A connect attempt that neither opens nor closes must not wedge the loop.
  // Reaching an unreachable/off Mac leaves the socket in CONNECTING with no
  // event for the OS TCP timeout (tens of seconds), so without this watchdog
  // the iPad never retries and never notices the desktop coming back up.
  const connectTimeout = cfg?.connectTimeoutMs ?? 8000;
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const statusCbs = new Set<(s: ConnStatus) => void>();
  let inner: Inner | null = null;
  let attempt = 0;
  let closed = false;
  let currentStatus: ConnStatus = 'connecting';
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };

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
    // Per-attempt flags: `opened` disarms the watchdog on a real open; `settled`
    // ensures exactly one reconnect is scheduled per attempt (watchdog and
    // onClose can otherwise both fire for the same dead socket).
    let opened = false;
    let settled = false;

    const scheduleReconnect = () => {
      if (closed || settled) return;
      settled = true;
      clearWatchdog();
      setStatus('disconnected');
      const wait = backoff(attempt++);
      if (wait <= 0) queueMicrotask(connect);
      else setTimeout(connect, wait);
    };

    const current = factory({
      url: conn.url, token: conn.token,
      // 'connected' only when the socket actually opens — not the instant the
      // WS is created. Reporting connected optimistically made the status bounce
      // connected→disconnected→connecting on every failed retry, flickering the
      // reconnect banner. Backoff also resets only on a confirmed open.
      onOpen: () => {
        if (closed) return;
        opened = true;
        clearWatchdog();
        setStatus('connected');
        attempt = 0;
      },
      // Fires both on a failed connect and on a live-connection drop; either way
      // we schedule the next attempt.
      onClose: scheduleReconnect,
    });
    inner = current;
    bindAll(inner);

    clearWatchdog();
    watchdog = setTimeout(() => {
      if (opened || settled) return;
      // Never opened in time — abandon this dead socket and retry. close() may
      // fire onClose, but scheduleReconnect dedupes via `settled`.
      try { current.close(); } catch { /* ignore */ }
      scheduleReconnect();
    }, connectTimeout);
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
    close: () => { closed = true; clearWatchdog(); inner?.close(); },
  };
}
