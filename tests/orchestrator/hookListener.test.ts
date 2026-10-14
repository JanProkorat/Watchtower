import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { startHookListener, type HookListenerHandle } from '../../orchestrator/hookListener.js';

// Binds a real HTTP listener on a real port and makes real round-trips. Under
// heavy parallel-suite CPU contention this can exceed vitest's default 5s
// timeout; give it headroom so transient slowness isn't a false failure.
vi.setConfig({ testTimeout: 30_000 });

describe('hookListener', () => {
  let handle: HookListenerHandle;
  const received: Array<{ event: string; body: unknown; instanceId: string }> = [];

  beforeEach(async () => {
    received.length = 0;
    handle = await startHookListener({
      token: 'test-token',
      portRange: [17421, 17430],
      onEvent: async (event, body, instanceId) => {
        received.push({ event, body, instanceId });
      },
    });
  });

  afterEach(async () => {
    await handle.stop();
  });

  it('binds to a port in range and reports it', () => {
    expect(handle.port).toBeGreaterThanOrEqual(17421);
    expect(handle.port).toBeLessThanOrEqual(17430);
  });

  it('accepts a Notification hook with valid token + instance header', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/Notification`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
        'x-watchtower-instance': 'inst-1',
      },
      body: JSON.stringify({ session_id: 'abc', cwd: '/tmp', hook_event_name: 'Notification' }),
    });
    expect(res.status).toBe(204);
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe('Notification');
    expect(received[0]?.instanceId).toBe('inst-1');
    expect((received[0]?.body as { session_id: string }).session_id).toBe('abc');
  });

  it('accepts all 5 known events', async () => {
    for (const e of ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']) {
      const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/${e}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token',
          'x-watchtower-instance': 'inst-x',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(204);
    }
    expect(received.map((r) => r.event)).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'Notification',
      'Stop',
      'SessionEnd',
    ]);
  });

  it('rejects requests with bad auth (401)', async () => {
    // Use node:http instead of fetch — Node 25's undici has a known quirk
    // where fetch sees ECONNRESET when the server responds with a small
    // payload then closes the connection. http.request handles this case
    // correctly. Production clients (the watchtower-hook helper) use
    // http.request too, so this matches real-world behavior.
    const http = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: handle.port,
          method: 'POST',
          path: '/hooks/Notification',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer wrong-token',
            'x-watchtower-instance': 'inst-1',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({}));
      req.end();
    });
    expect(status).toBe(401);
    expect(received).toHaveLength(0);
  });

  it('rejects unknown event names (400)', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/Whatever`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
        'x-watchtower-instance': 'inst-1',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects requests without instance header (400)', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/Notification`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects payloads larger than 32 KB (413)', async () => {
    const big = 'x'.repeat(33 * 1024);
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/Notification`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
        'x-watchtower-instance': 'inst-1',
      },
      body: JSON.stringify({ blob: big }),
    });
    expect(res.status).toBe(413);
  });
});

describe('hookListener /mods/:plugin', () => {
  let handle: HookListenerHandle;
  const mods: Array<{ plugin: string; body: unknown; instanceId: string }> = [];

  // One listener for the block: restarting it per test on the same port leaves
  // fetch's keep-alive sockets pointing at a closed server.
  beforeAll(async () => {
    handle = await startHookListener({
      token: 'test-token',
      portRange: [17431, 17440],
      onEvent: async () => {},
      onModState: (plugin, body, instanceId) => {
        mods.push({ plugin, body, instanceId });
      },
    });
  });

  afterAll(async () => {
    await handle.stop();
  });

  beforeEach(() => {
    mods.length = 0;
  });

  const post = (plugin: string, headers: Record<string, string>, body: unknown) =>
    fetch(`http://127.0.0.1:${handle.port}/mods/${plugin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const auth = { authorization: 'Bearer test-token', 'x-watchtower-instance': 'inst-1' };

  it('delivers a savvy-progress snapshot with its instance id', async () => {
    const res = await post('savvy-progress', auth, { version: 1, agents: [] });
    expect(res.status).toBe(204);
    expect(mods).toEqual([{ plugin: 'savvy-progress', body: { version: 1, agents: [] }, instanceId: 'inst-1' }]);
  });

  it('delivers a filetree snapshot with its instance id', async () => {
    const res = await post('filetree', auth, { version: 1, activity: [] });
    expect(res.status).toBe(204);
    expect(mods).toEqual([{ plugin: 'filetree', body: { version: 1, activity: [] }, instanceId: 'inst-1' }]);
  });

  it('accepts the Mods-tab band mods', async () => {
    for (const plugin of ['cache-tax', 'collision-guard', 'reflect-mod']) {
      expect((await post(plugin, auth, { version: 1 })).status).toBe(204);
    }
    expect(mods.map((m) => m.plugin)).toEqual(['cache-tax', 'collision-guard', 'reflect-mod']);
  });

  it('rejects a bad token, an unknown mod and a missing instance id', async () => {
    expect((await post('savvy-progress', { ...auth, authorization: 'Bearer nope' }, {})).status).toBe(401);
    expect((await post('other-mod', auth, {})).status).toBe(404);
    expect((await post('savvy-progress', { authorization: 'Bearer test-token' }, {})).status).toBe(400);
    expect(mods).toHaveLength(0);
  });

  it('takes snapshots larger than the 32 KB hook-payload limit', async () => {
    const agents = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, description: 'x'.repeat(300) }));
    const res = await post('savvy-progress', auth, { version: 1, agents });
    expect(res.status).toBe(204);
    expect(mods).toHaveLength(1);
  });
});

describe('GET /mods/:plugin/decision', () => {
  let handle: HookListenerHandle;
  const asked: { plugin: string; id: string; instanceId: string }[] = [];
  beforeAll(async () => {
    handle = await startHookListener({
      token: 'test-token',
      portRange: [17441, 17450],
      onEvent: async () => {},
      onModDecision: (plugin, id, instanceId) => {
        asked.push({ plugin, id, instanceId });
        return id === 'h1' ? 'proceed' : id === 'h2' ? null : undefined;
      },
    });
  });
  afterAll(async () => {
    await handle.stop();
  });

  const get = (path: string, headers: Record<string, string>) => fetch(`http://127.0.0.1:${handle.port}${path}`, { headers });
  const auth = { authorization: 'Bearer test-token', 'x-watchtower-instance': 'inst-1' };

  it('returns the recorded decision, null while waiting, 404 for an unknown hold', async () => {
    const a = await get('/mods/blast-radius/decision?id=h1', auth);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ decision: 'proceed' });
    expect(await (await get('/mods/blast-radius/decision?id=h2', auth)).json()).toEqual({ decision: null });
    expect((await get('/mods/blast-radius/decision?id=nope', auth)).status).toBe(404);
    expect(asked[0]).toEqual({ plugin: 'blast-radius', id: 'h1', instanceId: 'inst-1' });
  });

  it('needs the token, a known mod and the instance header', async () => {
    expect((await get('/mods/blast-radius/decision?id=h1', { 'x-watchtower-instance': 'inst-1' })).status).toBe(401);
    expect((await get('/mods/other/decision?id=h1', auth)).status).toBe(404);
    expect((await get('/mods/blast-radius/decision?id=h1', { authorization: 'Bearer test-token' })).status).toBe(400);
  });
});
