import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { postStatusline, runInner } from '../../helper/watchtower-statusline.js';

describe('postStatusline', () => {
  let server: http.Server;
  let port = 0;
  let seen: { auth?: string; body?: string } = {};

  beforeEach(async () => {
    seen = {};
    server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        seen = { auth: req.headers.authorization, body: data };
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('POSTs the body with a bearer token', async () => {
    await postStatusline('{"rate_limits":{}}', { port, token: 'tok', instanceId: 'i1' });
    expect(seen.auth).toBe('Bearer tok');
    expect(seen.body).toBe('{"rate_limits":{}}');
  });

  it('resolves without throwing when the listener is down', async () => {
    await expect(
      postStatusline('{}', { port: 1, token: 'tok', instanceId: '' }),
    ).resolves.toBeUndefined();
  });
});

describe('runInner', () => {
  it('pipes stdin through to the inner command and returns its stdout+code', async () => {
    const { stdout, code } = await runInner('cat', '{"hello":1}');
    expect(stdout).toBe('{"hello":1}');
    expect(code).toBe(0);
  });

  it('is a no-op (empty output, code 0) when the inner command is empty', async () => {
    const { stdout, code } = await runInner('', 'ignored');
    expect(stdout).toBe('');
    expect(code).toBe(0);
  });
});
