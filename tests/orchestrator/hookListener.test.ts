import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startHookListener, type HookListenerHandle } from '../../orchestrator/hookListener.js';

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
