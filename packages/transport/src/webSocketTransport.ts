import type { WatchtowerBridge } from '@watchtower/shared/ipcContract.js';
import { encodeFrame, decodeFrame, isPushFrame, type WsRequestFrame } from '@watchtower/shared/wsProtocol.js';

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

type AnyBridge = {
  invoke(kind: string, payload: unknown): Promise<unknown>;
  on(kind: string, handler: (p: unknown) => void): () => void;
  close(): void;
};

export function createWebSocketTransport(opts: {
  url: string;
  token: string;
  WebSocketImpl?: typeof WebSocket;
  onClose?: () => void;
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
  ws.onclose = () => { opts.onClose?.(); };
  ws.onmessage = (e: MessageEvent) => {
    const raw = typeof e.data === 'string' ? e.data : String(e.data);
    let msg;
    try {
      msg = decodeFrame(raw);
    } catch {
      return;
    }
    if (isPushFrame(msg)) {
      handlers.get(msg.kind)?.forEach((h) => h(msg.payload));
      return;
    }
    // Response frame: must have an id to match a pending request.
    if (!('id' in msg) || !msg.id) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if ('error' in msg && msg.error) p.reject(new Error(msg.error));
    else p.resolve('payload' in msg ? msg.payload : undefined);
  };

  function send(frame: WsRequestFrame) {
    const raw = encodeFrame(frame);
    if (open) ws.send(raw); else outbox.push(raw);
  }

  const bridge: AnyBridge = {
    invoke(kind: string, payload: unknown): Promise<unknown> {
      const id = `c${++counter}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ id, kind, payload } as WsRequestFrame);
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

  // TS2719 duplicate-identity drift (same as browserStub.ts); AnyBridge is structurally compatible
  return bridge as unknown as WatchtowerBridge & { close(): void };
}
