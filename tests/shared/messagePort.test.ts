import { describe, it, expect } from 'vitest';
import { PortApi } from '@watchtower/shared/messagePort.js';

// Build a linked pair of in-memory ports that forward postMessage to the
// other side's 'message' listeners — a minimal stand-in for the real
// MessageChannel that wires electron-main to the orchestrator.
function makePortPair() {
  const aHandlers: ((msg: { data: unknown }) => void)[] = [];
  const bHandlers: ((msg: { data: unknown }) => void)[] = [];
  const portA = {
    postMessage: (data: unknown) => {
      for (const h of bHandlers) h({ data });
    },
    on: (_e: 'message', h: (msg: { data: unknown }) => void) => {
      aHandlers.push(h);
    },
  };
  const portB = {
    postMessage: (data: unknown) => {
      for (const h of aHandlers) h({ data });
    },
    on: (_e: 'message', h: (msg: { data: unknown }) => void) => {
      bHandlers.push(h);
    },
  };
  return { portA, portB };
}

describe('PortApi RPC error channel', () => {
  it('resolves invoke with the handler payload on success', async () => {
    const { portA, portB } = makePortPair();
    const client = new PortApi(portA);
    const server = new PortApi(portB);
    server.onRequest(async () => ({ now: 1, orch: 42 }));

    const res = await client.invoke('ping', { now: 1 });
    expect(res).toEqual({ now: 1, orch: 42 });
  });

  it('rejects invoke when the request handler throws — never hangs', async () => {
    const { portA, portB } = makePortPair();
    const client = new PortApi(portA);
    const server = new PortApi(portB);
    server.onRequest(async () => {
      throw new Error('task FIE1933-1 is marked Done and is locked.');
    });

    await expect(client.invoke('ping', { now: 1 })).rejects.toThrow(
      'task FIE1933-1 is marked Done and is locked.',
    );
  });

  it('does not leave a stale pending entry after a rejected request', async () => {
    const { portA, portB } = makePortPair();
    const client = new PortApi(portA);
    const server = new PortApi(portB);
    let calls = 0;
    server.onRequest(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return { now: 2, orch: 7 };
    });

    await expect(client.invoke('ping', { now: 1 })).rejects.toThrow('boom');
    // A subsequent request on the same channel still works.
    await expect(client.invoke('ping', { now: 2 })).resolves.toEqual({ now: 2, orch: 7 });
  });
});
