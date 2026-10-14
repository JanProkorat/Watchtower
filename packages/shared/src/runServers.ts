// A repo's dev servers, started from the pane's Run tab. The repo lists them in
// `.watchtower/run.json`; the orchestrator runs them and keeps their logs.

export const RUN_CONFIG_PATH = '.watchtower/run.json';
export const RUN_LOG_LINES = 500;
const LINE_CHARS = 2000;

/** One server as `.watchtower/run.json` declares it. */
export interface RunServerSpec {
  id: string;
  label: string;
  /** Relative to the repo root; the root itself when absent. */
  cwd: string;
  /** argv, run without a shell. */
  command: string[];
  /** A server already listening here counts as "busy" and is not started twice. */
  port: number | null;
  /** Output matching this (a regex source) flips "starting" to "running"; without it the server is running once spawned. */
  ready: string | null;
  /** Shown as an "Open" button while the server runs. */
  url: string | null;
}

export type RunStatus = 'stopped' | 'starting' | 'running' | 'busy' | 'exited';

export interface RunServerState {
  id: string;
  label: string;
  port: number | null;
  url: string | null;
  status: RunStatus;
  /** How it ended, e.g. `exit 1` or `SIGTERM`; null while it runs or was stopped. */
  exit: string | null;
  log: string[];
}

/** Every server of one repo; `error` explains a run.json that could not be read. */
export interface RunState {
  root: string;
  servers: RunServerState[];
  error: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Validates a parsed run.json; the first problem comes back as `error`. */
export function parseRunConfig(raw: unknown): { servers: RunServerSpec[] } | { error: string } {
  if (!isObj(raw) || !Array.isArray(raw.servers)) return { error: 'run.json needs a "servers" array.' };
  const servers: RunServerSpec[] = [];
  for (const [i, s] of raw.servers.entries()) {
    const where = `servers[${i}]`;
    if (!isObj(s)) return { error: `${where} is not an object.` };
    const id = str(s.id);
    if (!id) return { error: `${where} needs an "id".` };
    if (servers.some((x) => x.id === id)) return { error: `${where}: id "${id}" is used twice.` };
    const command = s.command;
    if (!Array.isArray(command) || command.length === 0 || !command.every((a) => typeof a === 'string' && a !== '')) {
      return { error: `${where} needs a "command" array of strings, e.g. ["npm", "run", "dev"].` };
    }
    const port = s.port === undefined ? null : s.port;
    if (port !== null && !(Number.isInteger(port) && (port as number) > 0 && (port as number) < 65536)) {
      return { error: `${where}: "port" must be a TCP port number.` };
    }
    const ready = str(s.ready);
    if (ready) {
      try {
        new RegExp(ready);
      } catch {
        return { error: `${where}: "ready" is not a valid regular expression.` };
      }
    }
    const cwd = str(s.cwd) ?? '.';
    if (cwd.startsWith('/') || cwd.split('/').includes('..')) return { error: `${where}: "cwd" must stay inside the repo.` };
    servers.push({ id, label: str(s.label) ?? id, cwd, command: command as string[], port: port as number | null, ready, url: str(s.url) });
  }
  return { servers };
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

/** Appends an output chunk to a log: colors stripped, blank lines dropped, capped. */
export function appendLog(log: string[], chunk: string): string[] {
  const lines = chunk
    .replace(ANSI, '')
    .split(/\r?\n|\r/)
    .filter((l) => l.trim() !== '')
    .map((l) => (l.length > LINE_CHARS ? l.slice(0, LINE_CHARS) + '…' : l));
  return lines.length ? [...log, ...lines].slice(-RUN_LOG_LINES) : log;
}
