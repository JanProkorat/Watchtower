import type { Socket } from 'node:net';

export interface VncWsLike {
  on(ev: 'message', cb: (data: Buffer) => void): void;
  on(ev: 'close', cb: () => void): void;
  on(ev: 'error', cb: (err: Error) => void): void;
  send(data: Buffer): void;
  close(): void;
}

// Protocol-agnostic byte pipe between a WebSocket and a TCP socket. TCP `data`
// chunks (kernel-bounded, typically <64 KB) are forwarded as individual WS
// frames, so per-frame size stays well under the WS maxPayload — no buffering.
export function relayVnc(ws: VncWsLike, tcp: Socket): void {
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    try { tcp.destroy(); } catch { /* ignore */ }
    try { ws.close(); } catch { /* ignore */ }
  };
  ws.on('message', (data) => { if (!tcp.destroyed) tcp.write(data); });
  tcp.on('data', (chunk: Buffer) => ws.send(chunk));
  ws.on('close', cleanup);
  ws.on('error', cleanup);
  tcp.on('close', cleanup);
  tcp.on('error', cleanup);
}
