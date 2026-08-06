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
/**
 * Spawn args for the hidden instance.
 *
 * `--permission-mode auto` is load-bearing, not a convenience: the cwd above is
 * a repo with its own `.claude/settings.json`, whose `permissions.defaultMode`
 * overrides the user-global one. When that resolves to `default` (manual), the
 * first tool outside the allowlist raises a prompt in a window nobody can see
 * and the session sits there until jobTimeoutMs. Pinning the mode on the
 * command line keeps a settings change from silently re-hanging the sync.
 *
 * The allowlist stays scoped (not `--dangerously-skip-permissions`) so the
 * deny rules that protect .env/secrets still apply.
 */
export const MEETING_SPAWN_ARGS = [
  '--permission-mode', 'auto',
  '--allowedTools', 'mcp__claude_ai_Microsoft_365', 'Write', 'Bash',
];

const POLL_MS = 500;
const SETTLE_MS = 1500;
/** Gap between typing the command and pressing Enter — see the inject site. */
const SUBMIT_GAP_MS = 500;
// Terminal / turn-complete statuses (from packages/shared/src/stateModel.ts).
const DONE_STATUSES = new Set(['waiting-input', 'idle-notify', 'finished', 'crashed']);
// A permission prompt in a hidden instance can never be answered — nothing
// renders its terminal. Treat it as terminal rather than spinning to timeout.
const BLOCKED_STATUS = 'waiting-permission';
const EXITED_STATUSES = new Set(['finished', 'crashed']);

export class MeetingDriver {
  private inFlight = new Set<string>();
  constructor(private deps: MeetingDriverDeps) {}

  async run(spec: MeetingJobSpec): Promise<MeetingResult> {
    if (this.inFlight.size > 0) {
      return { ok: false, error: 'A meeting sync is already running.' };
    }
    this.inFlight.add(spec.key);
    let id: string | null = null;
    try {
      this.deps.clearResult();
      id = this.deps.spawn(MEETING_SYNC_CWD, MEETING_SPAWN_ARGS);

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
      // Text and Enter MUST be two separate writes. `command` is a SLASH
      // command, so typing it opens the TUI's autocomplete popup; when the CR
      // arrives in the same read as the text, the popup consumes it (accept /
      // complete) instead of submitting. The line then just sits in the
      // composer, no turn ever starts, and we spin until jobTimeoutMs.
      // A short gap lets the popup settle so the CR reaches the composer.
      // (Plain-text injection is unaffected — verified — hence deliverReply's
      // single-chunk write is fine.)
      this.deps.write(id, spec.command);
      await this.deps.sleep(SUBMIT_GAP_MS);
      this.deps.write(id, '\r');

      // Phase 2 — a result file appearing is success. A turn that ends with no
      // file (Stop → waiting-input, or process exit) is a failure. 'waiting-input'
      // cannot occur before our inject (no Stop hook fires without a turn), so
      // seeing it here reliably means the injected turn finished.
      const injectedAt = this.deps.now();
      while (this.deps.now() - injectedAt < spec.jobTimeoutMs) {
        const r = this.deps.readResult();
        if (r) return r;
        const s = this.deps.getStatus(id);
        if (s === BLOCKED_STATUS) {
          return { ok: false, error: 'The meeting session stopped on a permission prompt it cannot show. Check that this project allows the tools the command needs (permission mode `auto`, no deny rule over them).' };
        }
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
