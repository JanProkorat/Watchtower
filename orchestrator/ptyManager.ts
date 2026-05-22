import { createRequire } from 'node:module';

// node-pty is a native module; importing it lazily via createRequire keeps it
// out of any tooling (like vite) that might fail to resolve native deps.
const nodeRequire = createRequire(import.meta.url);

interface NodePtyApi {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): NodePtyProcess;
}

interface NodePtyProcess {
  onData(handler: (data: string) => void): void;
  onExit(handler: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols?: number;
  rows?: number;
  onData: (chunk: string) => void;
  onExit: (code: number) => void;
}

export interface PtyHandle {
  id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export class PtyManager {
  private handles = new Map<string, PtyHandle>();
  private pty: NodePtyApi;

  constructor(ptyImpl?: NodePtyApi) {
    this.pty = ptyImpl ?? (nodeRequire('node-pty') as NodePtyApi);
  }

  spawn(opts: PtySpawnOptions): PtyHandle {
    const proc = this.pty.spawn(opts.command, opts.args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd: opts.cwd,
      env: opts.env,
    });

    proc.onData((d) => opts.onData(d));
    proc.onExit(({ exitCode }) => {
      this.handles.delete(opts.id);
      opts.onExit(exitCode);
    });

    const handle: PtyHandle = {
      id: opts.id,
      write: (d) => proc.write(d),
      resize: (cols, rows) => proc.resize(cols, rows),
      kill: (signal) => proc.kill(signal),
    };
    this.handles.set(opts.id, handle);
    return handle;
  }

  get(id: string): PtyHandle | undefined {
    return this.handles.get(id);
  }

  all(): PtyHandle[] {
    return Array.from(this.handles.values());
  }
}
