// Bundled by helper/build.mjs into dist-helper/watchtower-hook.mjs.
// Installed into ~/.claude/settings.json via the first-run wizard (Phase 9).
// Reads Claude Code's hook payload from stdin, looks up the orchestrator
// listener's port+token from listener.json, and POSTs the payload.
// Never blocks Claude — every error path exits 0 fast.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';

function supportDir(): string {
  return (
    process.env.WATCHTOWER_SUPPORT_DIR ??
    path.join(homedir(), 'Library', 'Application Support', 'Watchtower')
  );
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      data += c;
    });
    process.stdin.on('end', () => resolve(data));
    // Hard cap: 150 ms reading stdin. We must never block Claude.
    setTimeout(() => resolve(data), 150);
  });
}

async function main(): Promise<void> {
  const event = process.argv[2];
  if (!event) process.exit(0);

  let token = '';
  let port = 0;
  try {
    token = readFileSync(path.join(supportDir(), 'hook-token'), 'utf8').trim();
    const sidecar = JSON.parse(readFileSync(path.join(supportDir(), 'listener.json'), 'utf8')) as {
      port?: number;
      token?: string;
    };
    port = Number(sidecar.port);
  } catch {
    process.exit(0);
  }
  if (!token || !port) process.exit(0);

  const instanceId = process.env.WATCHTOWER_INSTANCE_ID ?? '';
  const body = await readStdin();

  await new Promise<void>((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/hooks/${event}`,
        timeout: 200,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-watchtower-instance': instanceId,
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      },
    );
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.write(body);
    req.end();
  });

  process.exit(0);
}

void main();
