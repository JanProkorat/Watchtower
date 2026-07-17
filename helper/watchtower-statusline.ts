// Bundled by helper/build.mjs into dist-helper/watchtower-statusline.mjs.
// Wraps the user's original statusLine command: reads Claude Code's
// statusline JSON from stdin, fires a best-effort POST of it to the
// orchestrator's localhost listener, then execs the inner command with the
// same stdin and prints its output verbatim. Never blocks Claude — every
// POST error path resolves quickly instead of throwing/stalling.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

function supportDir(): string {
  return (
    process.env.WATCHTOWER_SUPPORT_DIR ??
    path.join(homedir(), 'Library', 'Application Support', 'Watchtower')
  );
}

interface ListenerCfg {
  port: number;
  token: string;
  instanceId: string;
}

function discover(): ListenerCfg | null {
  try {
    const sidecar = JSON.parse(readFileSync(path.join(supportDir(), 'listener.json'), 'utf8')) as {
      port?: number;
      token?: string;
    };
    const port = Number(sidecar.port);
    const token = String(sidecar.token ?? '');
    if (!port || !token) return null;
    return { port, token, instanceId: process.env.WATCHTOWER_INSTANCE_ID ?? '' };
  } catch {
    return null;
  }
}

/** Fire-and-forget POST of the statusline body. Always resolves within ~250ms. */
export function postStatusline(body: string, cfg: ListenerCfg): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: cfg.port,
        method: 'POST',
        path: '/statusline',
        timeout: 250,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.token}`,
          'x-watchtower-instance': cfg.instanceId,
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
}

/** Run the user's original statusline command with `stdin`, capturing stdout. */
export function runInner(innerCmd: string, stdin: string): Promise<{ stdout: string; code: number }> {
  if (!innerCmd.trim()) return Promise.resolve({ stdout: '', code: 0 });
  return new Promise((resolve) => {
    const child = spawn(innerCmd, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.on('error', () => resolve({ stdout: '', code: 0 }));
    child.on('close', (code) => resolve({ stdout, code: code ?? 0 }));
    // Guard: an inner command that ignores/closes stdin early (e.g. reads no
    // input) can make this write emit EPIPE. Uncaught, that throws and kills
    // the helper — which violates "never break the statusline".
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(data);
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    // Guard: never hang if stdin never closes.
    setTimeout(finish, 500).unref?.();
  });
}

async function main(): Promise<void> {
  // The inner command is everything after argv[1], re-joined (installer sets it).
  const innerCmd = process.argv.slice(2).join(' ');
  const body = await readStdin();

  const cfg = discover();
  const post = cfg ? postStatusline(body, cfg) : Promise.resolve();
  const [{ stdout, code }] = await Promise.all([runInner(innerCmd, body), post]);

  // Flush stdout before exiting: process.stdout.write() to a pipe is
  // non-blocking, so an immediate process.exit() can clip output that
  // hasn't drained yet. Exit only once the write's callback confirms flush.
  process.stdout.write(stdout, () => process.exit(code));
}

// Only run main() when executed directly, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('watchtower-statusline.mjs')) {
  void main();
}
