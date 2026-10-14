import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import {
  RUN_CONFIG_PATH,
  RUN_LOG_LINES,
  appendLog,
  parseRunConfig,
  type RunServerSpec,
  type RunServerState,
  type RunState,
} from '@watchtower/shared/runServers.js';

const STOP_GRACE_MS = 5_000;

interface Server {
  spec: RunServerSpec;
  state: RunServerState;
  child: ChildProcess | null;
  /** Set by stop(), so the exit reads as "stopped" rather than "exited". */
  isStopping: boolean;
}

interface Repo {
  root: string;
  servers: Map<string, Server>;
  error: string | null;
  emitTimer: ReturnType<typeof setTimeout> | null;
}

/** The nearest folder at or above `cwd` holding `.watchtower/run.json`, or null. */
export function findRunRoot(cwd: string): string | null {
  if (!cwd) return null;
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, RUN_CONFIG_PATH))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** True when something accepts connections on localhost:`port` (IPv4 or IPv6). */
export async function isPortBusy(port: number): Promise<boolean> {
  const probe = (host: string) =>
    new Promise<boolean>((done) => {
      const socket = connect({ port, host });
      const end = (busy: boolean) => {
        socket.destroy();
        done(busy);
      };
      socket.setTimeout(500, () => end(false));
      socket.once('connect', () => end(true));
      socket.once('error', () => end(false));
    });
  const [v4, v6] = await Promise.all([probe('127.0.0.1'), probe('::1')]);
  return v4 || v6;
}

/**
 * Dev servers per repo, shared by every pane in it. Each runs in its own
 * process group, so stopping it also stops the children it forked.
 */
export class RunServers {
  private repos = new Map<string, Repo>();

  constructor(
    private readonly emit: (state: RunState) => void,
    private readonly emitDelayMs = 100,
  ) {}

  /** The repo's servers as run.json lists them now; null when no run.json is found. */
  state(cwd: string): RunState | null {
    const root = findRunRoot(cwd);
    return root ? this.snapshot(this.load(root)) : null;
  }

  async start(cwd: string, serverId?: string): Promise<RunState | null> {
    const repo = this.repoFor(cwd);
    if (!repo) return null;
    await Promise.all(this.pick(repo, serverId).map((s) => this.startOne(repo, s)));
    return this.snapshot(repo);
  }

  async stop(cwd: string, serverId?: string): Promise<RunState | null> {
    const repo = this.repoFor(cwd);
    if (!repo) return null;
    await Promise.all(this.pick(repo, serverId).map((s) => this.stopOne(repo, s)));
    return this.snapshot(repo);
  }

  /** Kills every server now; for the orchestrator's exit, which can't wait. */
  stopAll(): void {
    for (const repo of this.repos.values()) {
      for (const s of repo.servers.values()) if (s.child?.pid) killGroup(s.child.pid, 'SIGTERM');
    }
  }

  private repoFor(cwd: string): Repo | null {
    const root = findRunRoot(cwd);
    return root ? this.load(root) : null;
  }

  private pick(repo: Repo, serverId?: string): Server[] {
    const all = [...repo.servers.values()];
    return serverId === undefined ? all : all.filter((s) => s.spec.id === serverId);
  }

  /** Re-reads run.json; servers still running keep their state even if the file dropped them. */
  private load(root: string): Repo {
    const repo = this.repos.get(root) ?? { root, servers: new Map(), error: null, emitTimer: null };
    this.repos.set(root, repo);
    let parsed: ReturnType<typeof parseRunConfig>;
    try {
      parsed = parseRunConfig(JSON.parse(readFileSync(join(root, RUN_CONFIG_PATH), 'utf8')));
    } catch (err) {
      parsed = { error: `Can't read ${RUN_CONFIG_PATH}: ${(err as Error).message}` };
    }
    if ('error' in parsed) {
      repo.error = parsed.error;
      return repo;
    }
    repo.error = null;
    const next = new Map<string, Server>();
    for (const spec of parsed.servers) {
      const prev = repo.servers.get(spec.id);
      const state: RunServerState = prev
        ? { ...prev.state, label: spec.label, port: spec.port, url: spec.url }
        : { id: spec.id, label: spec.label, port: spec.port, url: spec.url, status: 'stopped', exit: null, log: [] };
      next.set(spec.id, prev ? Object.assign(prev, { spec, state }) : { spec, state, child: null, isStopping: false });
    }
    for (const [id, s] of repo.servers) if (!next.has(id) && s.child) next.set(id, s);
    repo.servers = next;
    return repo;
  }

  private async startOne(repo: Repo, s: Server): Promise<void> {
    if (s.child) return;
    if (s.spec.port !== null && (await isPortBusy(s.spec.port))) {
      this.patch(repo, s, { status: 'busy', exit: null });
      return;
    }
    const [cmd, ...args] = s.spec.command;
    const child = spawn(cmd!, args, {
      cwd: join(repo.root, s.spec.cwd),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    s.child = child;
    s.isStopping = false;
    const ready = s.spec.ready ? new RegExp(s.spec.ready) : null;
    this.patch(repo, s, { status: ready ? 'starting' : 'running', exit: null, log: [] });

    const onData = (buf: Buffer) => {
      const lines = appendLog([], buf.toString('utf8'));
      const isReady = s.state.status === 'starting' && ready !== null && lines.some((l) => ready.test(l));
      this.patch(repo, s, { log: [...s.state.log, ...lines].slice(-RUN_LOG_LINES), status: isReady ? 'running' : s.state.status });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    // A missing command fails here, before any 'exit'.
    child.once('error', (err) => this.ended(repo, s, child, err.message));
    child.once('exit', (code, signal) => this.ended(repo, s, child, signal ?? `exit ${code}`));
  }

  private ended(repo: Repo, s: Server, child: ChildProcess, how: string): void {
    if (s.child !== child) return;
    s.child = null;
    this.patch(repo, s, s.isStopping ? { status: 'stopped', exit: null } : { status: 'exited', exit: how });
  }

  private async stopOne(repo: Repo, s: Server): Promise<void> {
    const child = s.child;
    if (!child?.pid) {
      if (s.state.status === 'busy' || s.state.status === 'exited') this.patch(repo, s, { status: 'stopped', exit: null });
      return;
    }
    s.isStopping = true;
    const exited = new Promise<void>((done) => child.once('exit', () => done()));
    killGroup(child.pid, 'SIGTERM');
    const timer = setTimeout(() => child.pid && killGroup(child.pid, 'SIGKILL'), STOP_GRACE_MS);
    await exited;
    clearTimeout(timer);
  }

  private patch(repo: Repo, s: Server, change: Partial<RunServerState>): void {
    s.state = { ...s.state, ...change };
    if (repo.emitTimer) return;
    repo.emitTimer = setTimeout(() => {
      repo.emitTimer = null;
      this.emit(this.snapshot(repo));
    }, this.emitDelayMs);
  }

  private snapshot(repo: Repo): RunState {
    return { root: repo.root, servers: [...repo.servers.values()].map((s) => s.state), error: repo.error };
  }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}
