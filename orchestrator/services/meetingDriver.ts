// Drives a short-lived hidden `claude` instance to run a meeting slash command
// (/sync-meetings or /teams-refresh) and reports a deterministic result. See
// docs/superpowers/specs/2026-07-23-one-click-meeting-sync-design.md.
//
// The M365 MCP only exists inside a Claude session, and headless `claude -p`
// hangs on MCP init in this environment — so we drive an INTERACTIVE managed
// instance (which loads the MCP fine, spike-validated) and inject the command.

export interface MeetingResult {
  ok: boolean;
  count?: number;
  detail?: string;
  error?: string;
}

export interface MeetingJobSpec {
  /** Single-flight key; a second run with the same key is rejected while in-flight. */
  key: string;
  /** The slash command to inject (without trailing CR). */
  command: string;
  /** Max wait for the session to reach 'working' before injecting anyway. */
  startupTimeoutMs: number;
  /** Max wait, post-inject, for a result. */
  jobTimeoutMs: number;
}

export interface MeetingDriverDeps {
  /** Spawn a hidden background claude instance; returns its id. */
  spawn(cwd: string, extraArgs: string[]): string;
  getStatus(id: string): string | null;
  write(id: string, data: string): void;
  dispose(id: string): void;
  /** Parse the result file; null if absent/unparseable. */
  readResult(): MeetingResult | null;
  clearResult(): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export const MEETING_SYNC_CWD = '/Users/jan/Projects/Watchtower';
export const MEETING_ALLOWLIST_ARGS = ['--allowedTools', 'mcp__claude_ai_Microsoft_365', 'Write', 'Bash'];

const POLL_MS = 500;
const SETTLE_MS = 1500;
// Terminal / turn-complete statuses (from packages/shared/src/stateModel.ts).
const DONE_STATUSES = new Set(['waiting-input', 'idle-notify', 'finished', 'crashed']);
const EXITED_STATUSES = new Set(['finished', 'crashed']);

export class MeetingDriver {
  private inFlight = new Set<string>();
  constructor(private deps: MeetingDriverDeps) {}

  async run(spec: MeetingJobSpec): Promise<MeetingResult> {
    if (this.inFlight.has(spec.key)) {
      return { ok: false, error: 'A meeting sync is already running.' };
    }
    this.inFlight.add(spec.key);
    let id: string | null = null;
    try {
      this.deps.clearResult();
      id = this.deps.spawn(MEETING_SYNC_CWD, MEETING_ALLOWLIST_ARGS);

      // Phase 1 — wait for the session to come up, then inject. SessionStart
      // drives the row to 'working'; if it never leaves 'spawning' within the
      // startup budget we inject anyway (claude queues typed input until ready).
      const startAt = this.deps.now();
      while (this.deps.now() - startAt < spec.startupTimeoutMs) {
        const s = this.deps.getStatus(id);
        if (s == null) return { ok: false, error: 'The meeting session failed to start.' };
        if (EXITED_STATUSES.has(s)) return { ok: false, error: 'The meeting session exited during startup.' };
        if (s === 'working' || s === 'waiting-input' || s === 'idle-notify') break;
        await this.deps.sleep(POLL_MS);
      }
      await this.deps.sleep(SETTLE_MS);
      this.deps.write(id, spec.command + '\r');

      // Phase 2 — a result file appearing is success. A turn that ends with no
      // file (Stop → waiting-input, or process exit) is a failure. 'waiting-input'
      // cannot occur before our inject (no Stop hook fires without a turn), so
      // seeing it here reliably means the injected turn finished.
      const injectedAt = this.deps.now();
      while (this.deps.now() - injectedAt < spec.jobTimeoutMs) {
        const r = this.deps.readResult();
        if (r) return r;
        const s = this.deps.getStatus(id);
        if (s != null && DONE_STATUSES.has(s)) {
          const r2 = this.deps.readResult();
          return r2 ?? { ok: false, error: 'The meeting session finished without producing a result (possible Microsoft 365 authentication error).' };
        }
        await this.deps.sleep(POLL_MS);
      }
      return { ok: false, error: 'Meeting sync timed out — the Microsoft 365 MCP may not have initialized. Try again, or re-authenticate Microsoft 365.' };
    } finally {
      if (id) this.deps.dispose(id);
      this.inFlight.delete(spec.key);
    }
  }
}
