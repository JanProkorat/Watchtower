import type { InstanceKind, InstanceRow } from '@watchtower/shared/stateModel.js';

export type { InstanceKind };

/** Fallback shell when $SHELL is unset/blank (macOS default). */
const SHELL_FALLBACK = '/bin/zsh';

export interface PtySpawnConfigInput {
  kind: InstanceKind;
  id: string;
  extraArgs: string[];
  /** Claude only: spawn via `claude --resume <id>` instead of `--session-id <id>`. */
  resumeSessionId?: string;
  /** Defaults to process.env; injectable for tests. */
  env?: Record<string, string | undefined>;
}

export interface PtySpawnConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Decide the command/args/env for a pty given the instance kind.
 *
 * Shells run `$SHELL -l` (interactive login) and deliberately DO NOT receive
 * WATCHTOWER_INSTANCE_ID — a shell posts no hooks, and a nested `claude` typed
 * into it must not inherit a managed id and clobber a row (the
 * nested-claude-hook-contamination hazard).
 */
export function buildPtySpawnConfig(input: PtySpawnConfigInput): PtySpawnConfig {
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.env ?? process.env)) {
    if (typeof v === 'string') baseEnv[k] = v;
  }

  if (input.kind === 'shell') {
    const shell = baseEnv.SHELL && baseEnv.SHELL.trim() ? baseEnv.SHELL : SHELL_FALLBACK;
    delete baseEnv.WATCHTOWER_INSTANCE_ID; // never leak a managed id into a shell
    return { command: shell, args: ['-l'], env: baseEnv };
  }

  const args = input.resumeSessionId
    ? ['--resume', input.resumeSessionId, ...input.extraArgs]
    : ['--session-id', input.id, ...input.extraArgs];
  return { command: 'claude', args, env: { ...baseEnv, WATCHTOWER_INSTANCE_ID: input.id } };
}

export type BootAction = 'leave' | 'crash' | 'resume' | 'respawn-shell';

/**
 * Decide what to do with a persisted instance row when the orchestrator boots.
 *   - shell, was live      → respawn a FRESH shell (dead pty can't resume)
 *   - shell, crashed       → leave (keep the lingering crashed tab + restart button)
 *   - claude, finished     → leave (exited cleanly)
 *   - claude, user-killed  → leave
 *   - claude, no session   → crash (unrecoverable)
 *   - claude, has session  → resume via `claude --resume`
 */
export function planBootAction(
  row: Pick<InstanceRow, 'kind' | 'status' | 'terminationReason' | 'claudeSessionId'>,
): BootAction {
  if (row.kind === 'shell') return row.status === 'crashed' ? 'leave' : 'respawn-shell';
  if (row.status === 'finished') return 'leave';
  if (row.terminationReason === 'user-kill') return 'leave';
  if (!row.claudeSessionId) return 'crash';
  return 'resume';
}
