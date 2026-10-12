import type { InstanceKind, InstanceRow } from '@watchtower/shared/stateModel.js';

export type { InstanceKind };

/** Fallback shell when $SHELL is unset/blank (macOS default). */
const SHELL_FALLBACK = '/bin/zsh';

/** Locale used when the inherited environment has no UTF-8 one. */
const UTF8_LOCALE = 'en_US.UTF-8';

/**
 * Force a UTF-8 character locale on a pty environment.
 *
 * A Finder-launched Electron app inherits no LANG/LC_* at all, so anything the
 * session shells out to falls back to the Mac's legacy system encoding — on a
 * Czech-region Mac that is MacCentralEurRoman, which turns Claude's UTF-8 into
 * mojibake (the `pbcopy` behind Claude Code's copy was mangling the clipboard).
 * xterm.js only decodes UTF-8 anyway, so a non-UTF-8 pty locale is never right.
 */
function forceUtf8Locale(env: Record<string, string>): void {
  const effective = env.LC_ALL || env.LC_CTYPE || env.LANG;
  if (effective && /utf-?8/i.test(effective)) return;
  // LC_ALL outranks LC_CTYPE, so a non-UTF-8 LC_ALL has to be replaced outright.
  if (env.LC_ALL) env.LC_ALL = UTF8_LOCALE;
  else env.LC_CTYPE = UTF8_LOCALE;
  if (!env.LANG) env.LANG = UTF8_LOCALE;
}

/**
 * Advertise 24-bit colour, which xterm.js renders.
 *
 * Terminal apps detect truecolor from COLORTERM, and a Finder-launched Electron
 * app inherits none — so Claude Code (and anything else in the pane) fell back
 * to the 256-colour palette, quantizing its themed RGB colours.
 */
function advertiseTruecolor(env: Record<string, string>): void {
  if (!env.COLORTERM) env.COLORTERM = 'truecolor';
}

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
  forceUtf8Locale(baseEnv);
  advertiseTruecolor(baseEnv);

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
