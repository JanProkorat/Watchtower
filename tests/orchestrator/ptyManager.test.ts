import { describe, it, expect, vi } from 'vitest';
import { PtyManager, type PtySpawnOptions } from '../../orchestrator/ptyManager.js';

// node-pty is a native module compiled against Electron's Node ABI, so it
// won't load in vitest's plain Node. We inject a fake node-pty implementation
// to test PtyManager's wrapper logic (lifecycle, handle map, data/exit
// callbacks) in isolation. Integration testing happens via the running app.

interface FakeProc {
  written: string[];
  resized: Array<[number, number]>;
  killed: string | null;
  dataHandlers: Array<(d: string) => void>;
  exitHandlers: Array<(e: { exitCode: number }) => void>;
  emitData(chunk: string): void;
  emitExit(code: number): void;
}

function makeFakePty(): { api: { spawn: (...args: unknown[]) => FakeProc }; procs: FakeProc[] } {
  const procs: FakeProc[] = [];
  const api = {
    spawn: () => {
      const proc: FakeProc = {
        written: [],
        resized: [],
        killed: null,
        dataHandlers: [],
        exitHandlers: [],
        emitData(chunk) {
          this.dataHandlers.forEach((h) => h(chunk));
        },
        emitExit(code) {
          this.exitHandlers.forEach((h) => h({ exitCode: code }));
        },
        // The PtyHandle methods below — but pretending to be a node-pty IPty:
      } as FakeProc;
      // Attach the IPty surface inline so PtyManager's spawn can call them.
      const ipty = {
        onData: (h: (d: string) => void) => {
          proc.dataHandlers.push(h);
        },
        onExit: (h: (e: { exitCode: number }) => void) => {
          proc.exitHandlers.push(h);
        },
        write: (d: string) => {
          proc.written.push(d);
        },
        resize: (cols: number, rows: number) => {
          proc.resized.push([cols, rows]);
        },
        kill: (signal?: string) => {
          proc.killed = signal ?? 'SIGTERM';
        },
      };
      // Copy onto proc so the manager can use both — Object.assign is the cleanest.
      Object.assign(proc, ipty);
      procs.push(proc);
      return proc;
    },
  };
  return { api, procs };
}

function defaultOpts(): PtySpawnOptions {
  return {
    id: 'inst-1',
    command: '/usr/bin/env',
    args: [],
    cwd: '/tmp',
    env: { PATH: '/usr/bin' },
    onData: () => undefined,
    onExit: () => undefined,
  };
}

describe('PtyManager', () => {
  it('spawns + routes data + exit through callbacks', () => {
    const { api, procs } = makeFakePty();
    const mgr = new PtyManager(api as unknown as ConstructorParameters<typeof PtyManager>[0]);
    const onData = vi.fn();
    const onExit = vi.fn();
    mgr.spawn({ ...defaultOpts(), onData, onExit });
    procs[0]?.emitData('hello\n');
    procs[0]?.emitExit(0);
    expect(onData).toHaveBeenCalledWith('hello\n');
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it('write/resize/kill forward to the underlying process', () => {
    const { api, procs } = makeFakePty();
    const mgr = new PtyManager(api as unknown as ConstructorParameters<typeof PtyManager>[0]);
    const handle = mgr.spawn(defaultOpts());
    handle.write('input');
    handle.resize(80, 24);
    handle.kill('SIGINT');
    expect(procs[0]?.written).toEqual(['input']);
    expect(procs[0]?.resized).toEqual([[80, 24]]);
    expect(procs[0]?.killed).toBe('SIGINT');
  });

  it('get(id) returns the handle while live, undefined after exit', () => {
    const { api, procs } = makeFakePty();
    const mgr = new PtyManager(api as unknown as ConstructorParameters<typeof PtyManager>[0]);
    const handle = mgr.spawn({ ...defaultOpts(), id: 'abc' });
    expect(mgr.get('abc')).toBe(handle);
    procs[0]?.emitExit(0);
    expect(mgr.get('abc')).toBeUndefined();
  });

  it('all() returns all live handles, scoped to the manager instance', () => {
    const { api } = makeFakePty();
    const mgr = new PtyManager(api as unknown as ConstructorParameters<typeof PtyManager>[0]);
    mgr.spawn({ ...defaultOpts(), id: 'a' });
    mgr.spawn({ ...defaultOpts(), id: 'b' });
    expect(mgr.all().map((h) => h.id).sort()).toEqual(['a', 'b']);
  });
});
