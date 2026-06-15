import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';

// Each case cold-starts `npx tsx <helper>` (npx resolution + tsx/esbuild
// compile). Under heavy CPU contention (the full suite runs 55 files in
// parallel) that cold start can exceed vitest's default 5s timeout, producing
// a rare false failure. Give these process-spawn tests generous headroom — a
// genuine hang still fails, just slower.
vi.setConfig({ testTimeout: 30_000 });
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_SCRIPT = path.resolve(__dirname, '../../helper/watchtower-hook.ts');

interface Received {
  url: string;
  method: string;
  auth: string | undefined;
  instanceId: string | undefined;
  body: string;
}

function runHook(args: string[], stdinJson: unknown, env: NodeJS.ProcessEnv): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', HOOK_SCRIPT, ...args], {
      env: { ...process.env, ...env },
    });
    proc.stdin.write(JSON.stringify(stdinJson));
    proc.stdin.end();
    proc.on('exit', (code) => resolve({ code }));
  });
}

describe('watchtower-hook helper', () => {
  let dir: string;
  let server: http.Server;
  let port = 0;
  const received: Received[] = [];

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'wt-'));
    received.length = 0;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString();
      });
      req.on('end', () => {
        received.push({
          url: req.url ?? '',
          method: req.method ?? '',
          auth: req.headers.authorization as string | undefined,
          instanceId: req.headers['x-watchtower-instance'] as string | undefined,
          body,
        });
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (!addr || typeof addr !== 'object') throw new Error('no address');
    port = addr.port;
    writeFileSync(
      path.join(dir, 'listener.json'),
      JSON.stringify({ port, token: 'tok', writtenAt: Date.now() }),
      { mode: 0o600 },
    );
    writeFileSync(path.join(dir, 'hook-token'), 'tok', { mode: 0o600 });
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('forwards payload to /hooks/<event> with bearer auth + instance header', async () => {
    const { code } = await runHook(['Notification'], { session_id: 'abc' }, {
      WATCHTOWER_SUPPORT_DIR: dir,
      WATCHTOWER_INSTANCE_ID: 'inst-1',
    });
    expect(code).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0]?.url).toBe('/hooks/Notification');
    expect(received[0]?.method).toBe('POST');
    expect(received[0]?.auth).toBe('Bearer tok');
    expect(received[0]?.instanceId).toBe('inst-1');
    expect(JSON.parse(received[0]?.body ?? '{}').session_id).toBe('abc');
  });

  it('exits 0 even when the server is unreachable (helper never blocks Claude)', async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const { code } = await runHook(['Notification'], {}, {
      WATCHTOWER_SUPPORT_DIR: dir,
      WATCHTOWER_INSTANCE_ID: 'inst-1',
    });
    expect(code).toBe(0);
  });

  it('exits 0 when listener.json is missing', async () => {
    require('node:fs').unlinkSync(path.join(dir, 'listener.json'));
    const { code } = await runHook(['Notification'], {}, {
      WATCHTOWER_SUPPORT_DIR: dir,
      WATCHTOWER_INSTANCE_ID: 'inst-1',
    });
    expect(code).toBe(0);
    expect(received).toHaveLength(0);
  });

  it('exits 0 when the token file is missing', async () => {
    require('node:fs').unlinkSync(path.join(dir, 'hook-token'));
    const { code } = await runHook(['Notification'], {}, {
      WATCHTOWER_SUPPORT_DIR: dir,
      WATCHTOWER_INSTANCE_ID: 'inst-1',
    });
    expect(code).toBe(0);
    expect(received).toHaveLength(0);
  });

  it('exits 0 when called with no event argument', async () => {
    const { code } = await runHook([], {}, {
      WATCHTOWER_SUPPORT_DIR: dir,
      WATCHTOWER_INSTANCE_ID: 'inst-1',
    });
    expect(code).toBe(0);
    expect(received).toHaveLength(0);
  });
});
