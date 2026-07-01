import { describe, it, expect, vi } from 'vitest';
import { createWebSocketTransport } from '@watchtower/transport';

// Minimal fake WebSocket that lets the test drive open/messages.
class FakeWS {
  static OPEN = 1;
  readyState = 0;
  OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {}
  send(d: string) { this.sent.push(d); }
  close() {}
  _open() { this.readyState = 1; this.onopen?.(); }
  _recv(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  _error() { this.onerror?.(); }
  _close() { this.readyState = 3; this.onclose?.(); }
}

describe('WebSocketTransport', () => {
  it('resolves invoke with the matching response payload', async () => {
    let ws!: FakeWS;
    const t = createWebSocketTransport({
      url: 'ws://x', token: 't',
      WebSocketImpl: class extends FakeWS { constructor(u: string) { super(u); ws = this; } } as never,
    });
    ws._open();
    const p = t.invoke('projects:list', {} as never);
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.kind).toBe('projects:list');
    ws._recv({ id: sent.id, kind: 'projects:list', payload: { projects: [] } });
    await expect(p).resolves.toEqual({ projects: [] });
  });

  it('rejects invoke when the response carries an error', async () => {
    let ws!: FakeWS;
    const t = createWebSocketTransport({
      url: 'ws://x', token: 't',
      WebSocketImpl: class extends FakeWS { constructor(u: string) { super(u); ws = this; } } as never,
    });
    ws._open();
    const p = t.invoke('openInVSCode', { path: '/x' } as never);
    const sent = JSON.parse(ws.sent[0]);
    ws._recv({ id: sent.id, kind: 'openInVSCode', error: 'not available' });
    await expect(p).rejects.toThrow(/not available/);
  });

  it('queues invoke frames before open, then flushes on _open()', async () => {
    let ws!: FakeWS;
    const t = createWebSocketTransport({
      url: 'ws://x', token: 't',
      WebSocketImpl: class extends FakeWS { constructor(u: string) { super(u); ws = this; } } as never,
    });
    // socket NOT yet open — invoke must be queued, not sent
    const p = t.invoke('projects:list', {} as never);
    expect(ws.sent).toHaveLength(0);   // nothing sent yet
    // now open the socket — the queued frame should flush
    ws._open();
    expect(ws.sent).toHaveLength(1);   // frame was flushed
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.kind).toBe('projects:list');
    // deliver the matching response and confirm the promise resolves
    ws._recv({ id: sent.id, kind: 'projects:list', payload: { projects: [] } });
    await expect(p).resolves.toEqual({ projects: [] });
  });

  it('dispatches push frames to on() handlers', async () => {
    let ws!: FakeWS;
    const t = createWebSocketTransport({
      url: 'ws://x', token: 't',
      WebSocketImpl: class extends FakeWS { constructor(u: string) { super(u); ws = this; } } as never,
    });
    ws._open();
    const handler = vi.fn();
    t.on('ptyData', handler);
    ws._recv({ push: true, kind: 'ptyData', payload: { instanceId: 'i', chunk: 'hi' } });
    expect(handler).toHaveBeenCalledWith({ instanceId: 'i', chunk: 'hi' });
  });

  it('treats onerror as a close so a failed connect signals the reconnect loop (once)', () => {
    let ws!: FakeWS;
    const onClose = vi.fn();
    createWebSocketTransport({
      url: 'ws://x', token: 't', onClose,
      WebSocketImpl: class extends FakeWS { constructor(u: string) { super(u); ws = this; } } as never,
    });
    // iOS WKWebView commonly reports a failed WS connect via onerror (sometimes
    // with no following onclose). onClose must fire on the error…
    ws._error();
    expect(onClose).toHaveBeenCalledTimes(1);
    // …and must NOT fire a second time if onclose also arrives afterwards.
    ws._close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a spurious error AFTER open (relies on close for real drops)', () => {
    let ws!: FakeWS;
    const onClose = vi.fn();
    createWebSocketTransport({
      url: 'ws://x', token: 't', onClose,
      WebSocketImpl: class extends FakeWS { constructor(u: string) { super(u); ws = this; } } as never,
    });
    ws._open();
    ws._error();                       // iOS can fire this on a healthy socket
    expect(onClose).not.toHaveBeenCalled();
    ws._close();                       // an actual drop still signals
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
