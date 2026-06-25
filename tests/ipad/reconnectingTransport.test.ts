// tests/ipad/reconnectingTransport.test.ts
import { describe, it, expect } from 'vitest';
import { createReconnectingTransport } from '../../apps/ipad/src/lib/reconnectingTransport.js';

// Fake inner transport factory we can drive open/close on.
function makeFactory() {
  const created: Array<{
    close(): void; fail(): void; open(): void; handlers: Map<string, Set<(p: unknown)=>void>>;
  }> = [];
  const factory = (opts: { url: string; token: string; onOpen?: () => void; onClose?: () => void }) => {
    const handlers = new Map<string, Set<(p: unknown)=>void>>();
    const t = {
      invoke: async () => ({ ok: true }),
      on: (k: string, h: (p: unknown)=>void) => {
        let s = handlers.get(k); if (!s) { s = new Set(); handlers.set(k, s); } s.add(h);
        return () => s!.delete(h);
      },
      close: () => {},
    };
    created.push({
      close: t.close,
      fail: () => opts.onClose?.(),
      open: () => opts.onOpen?.(),
      handlers,
    });
    return t;
  };
  return { factory, created };
}

describe('createReconnectingTransport', () => {
  it('re-subscribes registered handlers against a new socket after reconnect', async () => {
    const { factory, created } = makeFactory();
    const rt = createReconnectingTransport(
      { url: 'ws://x/ws', token: 't' },
      { factory, backoffMs: () => 0 },
    );
    const received: unknown[] = [];
    rt.on('stateChanged', (p) => received.push(p));

    // First socket delivers a push.
    created[0].handlers.get('stateChanged')?.forEach((h) => h({ instanceId: 'a', status: 'working' }));
    expect(received).toHaveLength(1);

    // Socket drops → wrapper builds a new one and re-binds the handler.
    created[0].fail();
    await Promise.resolve();
    expect(created.length).toBeGreaterThanOrEqual(2);
    created[1].handlers.get('stateChanged')?.forEach((h) => h({ instanceId: 'a', status: 'idle' }));
    expect(received).toHaveLength(2);
    rt.close();
  });

  it('reports connected only on a real open, never optimistically (no flicker)', async () => {
    const { factory, created } = makeFactory();
    const statuses: string[] = [];
    const rt = createReconnectingTransport(
      { url: 'ws://x/ws', token: 't' },
      { factory, backoffMs: () => 0 },
    );
    rt.onStatus((s) => statuses.push(s));

    // Created but not yet open → must be 'connecting', NOT 'connected'.
    expect(statuses).toEqual(['connecting']);
    created[0].open();
    expect(statuses).toEqual(['connecting', 'connected']);

    // Drop, then the retried socket fails again before opening: status must go
    // disconnected→connecting and never blink back to 'connected'.
    created[0].fail();
    await Promise.resolve();
    created[1].fail();
    await Promise.resolve();
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected', 'connecting', 'disconnected', 'connecting']);
    expect(statuses.slice(2)).not.toContain('connected');
    rt.close();
  });
});
