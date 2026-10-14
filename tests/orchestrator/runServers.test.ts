import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunState } from '@watchtower/shared/runServers.js';
import { RunServers, findRunRoot } from '../../orchestrator/services/runServers';

const NODE = process.execPath;

let root: string;
let pushes: RunState[];
let servers: RunServers;

function writeConfig(list: unknown[]): void {
  mkdirSync(join(root, '.watchtower'), { recursive: true });
  writeFileSync(join(root, '.watchtower/run.json'), JSON.stringify({ servers: list }));
}

async function until<T>(read: () => T | undefined | null | false, ms = 5_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = read();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const statusOf = (id: string) => servers.state(root)?.servers.find((s) => s.id === id)?.status;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wt-run-'));
  pushes = [];
  servers = new RunServers((s) => pushes.push(s), 0);
});

afterEach(() => {
  servers.stopAll();
  rmSync(root, { recursive: true, force: true });
});

describe('findRunRoot', () => {
  it('walks up from a subfolder to the run.json, and is null without one', () => {
    expect(findRunRoot(root)).toBeNull();
    writeConfig([]);
    mkdirSync(join(root, 'web/src'), { recursive: true });
    expect(findRunRoot(join(root, 'web/src'))).toBe(root);
  });
});

describe('RunServers', () => {
  it('lists the servers stopped, and reports a broken run.json', () => {
    expect(servers.state(root)).toBeNull();
    writeConfig([{ id: 'web', label: 'Web', command: [NODE, '-v'], port: 5173, url: 'http://localhost:5173' }]);
    expect(servers.state(root)).toEqual({
      root,
      error: null,
      servers: [{ id: 'web', label: 'Web', port: 5173, url: 'http://localhost:5173', status: 'stopped', exit: null, log: [] }],
    });
    writeFileSync(join(root, '.watchtower/run.json'), '{ nope');
    expect(servers.state(root)?.error).toMatch(/Can't read/);
  });

  it('turns running on the ready line, keeps the log, pushes, and stops on request', async () => {
    const script = "console.log('building'); setTimeout(() => console.log('Now listening on'), 100); setInterval(() => {}, 1000)";
    writeConfig([{ id: 'api', command: [NODE, '-e', script], ready: 'Now listening on' }]);
    await servers.start(root, 'api');
    expect(statusOf('api')).toBe('starting');
    await until(() => statusOf('api') === 'running');
    expect(servers.state(root)?.servers[0]?.log).toEqual(['building', 'Now listening on']);
    await until(() => pushes.some((p) => p.servers[0]?.status === 'running'));

    await servers.stop(root, 'api');
    await until(() => statusOf('api') === 'stopped');
    expect(servers.state(root)?.servers[0]?.exit).toBeNull();
  });

  it('stop also kills the children the server forked', async () => {
    const pidFile = join(root, 'child.pid');
    const script = `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000)`;
    writeConfig([{ id: 'api', command: [NODE, '-e', script] }]);
    await servers.start(root);
    const childPid = Number(await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8')));
    expect(alive(childPid)).toBe(true);
    await servers.stop(root);
    await until(() => !alive(childPid));
  });

  it('reports a server that ends by itself, and a command that does not exist', async () => {
    writeConfig([
      { id: 'dies', command: [NODE, '-e', 'process.exit(3)'] },
      { id: 'missing', command: ['wt-no-such-command-xyz'] },
    ]);
    await servers.start(root);
    await until(() => statusOf('dies') === 'exited');
    expect(servers.state(root)?.servers.find((s) => s.id === 'dies')?.exit).toBe('exit 3');
    await until(() => statusOf('missing') === 'exited');
    expect(servers.state(root)?.servers.find((s) => s.id === 'missing')?.exit).toMatch(/ENOENT/);
  });

  it('marks a taken port busy instead of starting a second copy', async () => {
    const taken: Server = createServer();
    await new Promise<void>((r) => taken.listen(0, '127.0.0.1', r));
    const port = (taken.address() as { port: number }).port;
    try {
      writeConfig([{ id: 'web', command: [NODE, '-e', 'setInterval(() => {}, 1000)'], port }]);
      await servers.start(root);
      expect(statusOf('web')).toBe('busy');
      await servers.stop(root);
      expect(statusOf('web')).toBe('stopped');
    } finally {
      taken.close();
    }
  });
});
