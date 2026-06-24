// tests/orchestrator/wsBridge.vnc.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import net from 'node:net';
import WebSocket from 'ws';
import { startWsBridge, type WsBridgeHandle } from '../../orchestrator/wsBridge.js';

vi.setConfig({ testTimeout: 30_000 });

let handle: WsBridgeHandle | null = null;
let echo: net.Server | null = null;
afterEach(async () => { await handle?.stop(); handle = null; echo?.close(); echo = null; });

async function startEcho(): Promise<number> {
  echo = net.createServer((s) => s.on('data', (d) => s.write(d)));
  await new Promise<void>((r) => echo!.listen(0, '127.0.0.1', r));
  return (echo!.address() as net.AddressInfo).port;
}

describe('wsBridge /vnc', () => {
  it('relays bytes to the injected tcp target over an authed ws', async () => {
    const echoPort = await startEcho();
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async () => ({}),
      vncConnect: () => net.connect(echoPort, '127.0.0.1'),
    });
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/vnc?token=secret`);
    await new Promise<void>((r) => ws.once('open', r));
    const got = new Promise<string>((r) => ws.once('message', (d) => r(d.toString())));
    ws.send(Buffer.from('hello'));
    expect(await got).toBe('hello');
    ws.close();
  });

  it('rejects /vnc without a valid token', async () => {
    await startEcho();
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async () => ({}),
      vncConnect: () => net.connect(1, '127.0.0.1'),
    });
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/vnc?token=wrong`);
    const closed = await new Promise<boolean>((r) => {
      ws.once('open', () => r(false));
      ws.once('error', () => r(true));
      ws.once('unexpected-response', () => r(true));
    });
    expect(closed).toBe(true);
  });
});
