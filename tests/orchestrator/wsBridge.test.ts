// tests/orchestrator/wsBridge.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startWsBridge, type WsBridgeHandle } from '../../orchestrator/wsBridge.js';

let handle: WsBridgeHandle | null = null;
afterEach(async () => { await handle?.stop(); handle = null; });

function connect(port: number, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  return new Promise((res, rej) => {
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}

describe('wsBridge', () => {
  it('rejects connections without the token', async () => {
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async () => ({ ok: true }),
    });
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?token=wrong`);
    const closed = await new Promise<boolean>((res) => {
      ws.on('close', () => res(true));
      ws.on('open', () => res(false));
      ws.on('error', () => {}); // suppress unhandled error; close still fires after error
    });
    expect(closed).toBe(true);
  });

  it('routes a request through handleRequest and replies with the id', async () => {
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async (req) => ({ echoed: req.kind }),
    });
    const ws = await connect(handle.port, 'secret');
    const reply = await new Promise<any>((res) => {
      ws.on('message', (d) => res(JSON.parse(d.toString())));
      ws.send(JSON.stringify({ id: 'r1', kind: 'projects:list', payload: {} }));
    });
    expect(reply).toEqual({ id: 'r1', kind: 'projects:list', payload: { echoed: 'projects:list' } });
    ws.close();
  });

  it('rejects electron-only kinds with an error frame', async () => {
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async () => ({ ok: true }),
    });
    const ws = await connect(handle.port, 'secret');
    const reply = await new Promise<any>((res) => {
      ws.on('message', (d) => res(JSON.parse(d.toString())));
      ws.send(JSON.stringify({ id: 'r2', kind: 'openInVSCode', payload: { path: '/x' } }));
    });
    expect(reply.id).toBe('r2');
    expect(reply.error).toMatch(/not available/i);
    ws.close();
  });

  it('broadcasts pushes to connected clients', async () => {
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async () => ({ ok: true }),
    });
    const ws = await connect(handle.port, 'secret');
    const got = new Promise<any>((res) => ws.on('message', (d) => res(JSON.parse(d.toString()))));
    handle.broadcast({ kind: 'badge', payload: { count: 7 } });
    expect(await got).toEqual({ push: true, kind: 'badge', payload: { count: 7 } });
    ws.close();
  });
});
