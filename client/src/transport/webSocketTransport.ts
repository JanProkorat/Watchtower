import type { IpcRequest, IpcResponse, IpcPush, WatchtowerBridge } from '../../../shared/ipcContract.js';

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBridge = {
  invoke(kind: string, payload: unknown): Promise<unknown>;
  on(kind: string, handler: (p: unknown) => void): () => void;
  close(): void;
};

export function createWebSocketTransport(opts: {
  url: string;
  token: string;
  WebSocketImpl?: typeof WebSocket;
}): WatchtowerBridge & { close(): void } {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  const sep = opts.url.includes('?') ? '&' : '?';
  const ws = new Impl(`${opts.url}${sep}token=${encodeURIComponent(opts.token)}`);

  const pending = new Map<string, Pending>();
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const outbox: string[] = [];
  let open = false;
  let counter = 0;

  ws.onopen = () => { open = true; outbox.splice(0).forEach((m) => ws.send(m)); };
  ws.onmessage = (e: MessageEvent) => {
    const msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data)) as {
      push?: boolean; kind: string; id?: string; payload?: unknown; error?: string;
    };
    if (msg.push === true) {
      handlers.get(msg.kind)?.forEach((h) => h(msg.payload));
      return;
    }
    if (!msg.id) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.payload);
  };

  function send(frame: object) {
    const raw = JSON.stringify(frame);
    if (open) ws.send(raw); else outbox.push(raw);
  }

  const bridge: AnyBridge = {
    invoke(kind: string, payload: unknown): Promise<unknown> {
      const id = `c${++counter}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ id, kind, payload });
      });
    },
    on(kind: string, handler: (p: unknown) => void): () => void {
      let set = handlers.get(kind);
      if (!set) { set = new Set(); handlers.set(kind, set); }
      set.add(handler);
      return () => { set!.delete(handler); };
    },
    close() { ws.close(); },
  };

  return bridge as unknown as WatchtowerBridge & { close(): void };
}
