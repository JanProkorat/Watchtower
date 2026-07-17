import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startHookListener } from '../../orchestrator/hookListener.js';

describe('POST /statusline', () => {
  let stop: (() => Promise<void>) | null = null;
  let port = 0;
  const TOKEN = 'test-token';
  let received: unknown = undefined;

  beforeEach(async () => {
    received = undefined;
    const listener = await startHookListener({
      token: TOKEN,
      portRange: [7451, 7460],
      onEvent: async () => {},
      onStatusline: async (body) => {
        received = body;
      },
    });
    port = listener.port;
    stop = listener.stop;
  });

  afterEach(async () => {
    await stop?.();
    stop = null;
  });

  const post = (headers: Record<string, string>, body: string) =>
    fetch(`http://127.0.0.1:${port}/statusline`, { method: 'POST', headers, body });

  it('rejects a missing/wrong bearer token with 401', async () => {
    const res = await post({ 'content-type': 'application/json' }, '{}');
    expect(res.status).toBe(401);
    expect(received).toBeUndefined();
  });

  it('accepts an authorized body and forwards the parsed JSON', async () => {
    const body = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 33, resets_at: 5 } } });
    const res = await post(
      { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body,
    );
    expect(res.status).toBe(204);
    expect(received).toEqual({ rate_limits: { five_hour: { used_percentage: 33, resets_at: 5 } } });
  });
});
