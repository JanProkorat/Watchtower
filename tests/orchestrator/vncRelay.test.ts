import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { relayVnc, type VncWsLike } from '../../orchestrator/vncRelay.js';

function fakeWs() {
  const msgCbs: Array<(d: Buffer) => void> = [];
  const closeCbs: Array<() => void> = [];
  const errorCbs: Array<(err: Error) => void> = [];
  const sent: Buffer[] = [];
  let closed = false;
  const ws: VncWsLike = {
    on(ev, cb) {
      if (ev === 'message') msgCbs.push(cb as (d: Buffer) => void);
      else if (ev === 'close') closeCbs.push(cb as () => void);
      else if (ev === 'error') errorCbs.push(cb as (err: Error) => void);
    },
    send(d) { sent.push(Buffer.from(d)); },
    close() { closed = true; closeCbs.forEach((c) => c()); },
  };
  return { ws, sent, emitMessage: (d: Buffer) => msgCbs.forEach((c) => c(d)), emitClose: () => closeCbs.forEach((c) => c()), emitError: (err: Error) => errorCbs.forEach((c) => c(err)), isClosed: () => closed };
}

describe('relayVnc', () => {
  it('pipes ws->tcp and tcp->ws, and closes tcp when ws closes', async () => {
    // Echo TCP server stands in for macOS Screen Sharing.
    const server = net.createServer((s) => s.on('data', (d) => s.write(d)));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    const tcp = net.connect(port, '127.0.0.1');
    await new Promise<void>((r) => tcp.once('connect', r));

    const { ws, sent, emitMessage, emitClose } = fakeWs();
    relayVnc(ws, tcp);

    emitMessage(Buffer.from('RFB 003.008\n'));
    await new Promise((r) => setTimeout(r, 50));
    expect(Buffer.concat(sent).toString()).toBe('RFB 003.008\n'); // echoed back

    emitClose();
    await new Promise((r) => setTimeout(r, 20));
    expect(tcp.destroyed).toBe(true);
    server.close();
  });

  it('closes tcp when ws emits error', async () => {
    const server = net.createServer((s) => s.on('data', (d) => s.write(d)));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    const tcp = net.connect(port, '127.0.0.1');
    await new Promise<void>((r) => tcp.once('connect', r));

    const { ws, emitError } = fakeWs();
    relayVnc(ws, tcp);

    emitError(new Error('boom'));
    await new Promise((r) => setTimeout(r, 20));
    expect(tcp.destroyed).toBe(true);
    server.close();
  });
});
