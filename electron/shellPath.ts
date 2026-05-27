import { execFileSync } from 'node:child_process';

// macOS launchd hands GUI-launched apps a stripped PATH
// (`/usr/bin:/bin:/usr/sbin:/sbin`), missing every user-installed bin dir.
// The orchestrator spawns `claude` by relative name via node-pty, so a
// packaged build can't find the binary and every new instance exits with
// code 1 in <10ms — the user sees "Session is crashed" right away.
//
// We work around this the same way most Electron apps do: invoke the user's
// login+interactive shell at startup, capture its PATH, and prepend it onto
// process.env.PATH so the orchestrator utilityProcess (and any exec'd
// helpers like `code`) inherit the same lookup paths the user has in
// Terminal.app. No-op in dev — `npm run dev` already has the right PATH.

const DELIM = '__WT_PATH_DELIM__';
const SHELL_TIMEOUT_MS = 5_000;

/** Inject a fake shell runner (tests) or omit to spawn the real $SHELL. */
export type ShellRunner = (shell: string, script: string) => string | null;

const realRunner: ShellRunner = (shell, script) => {
  try {
    return execFileSync(shell, ['-ilc', script], {
      encoding: 'utf8',
      timeout: SHELL_TIMEOUT_MS,
      // Discard stderr — interactive shells often print greetings / motd
      // we don't care about and that would pollute the delimited stdout.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

/**
 * Merge `shellPath` in front of `currentPath`, dropping duplicate entries
 * while preserving the order shellPath defined them. Empty segments (from
 * trailing colons or empty inputs) are skipped.
 */
export function mergePaths(shellPath: string, currentPath: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...shellPath.split(':'), ...currentPath.split(':')]) {
    if (!dir) continue;
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(':');
}

/**
 * Ask the given shell for its PATH and return it. Returns null if the shell
 * fails to launch, times out, or doesn't print the expected delimited
 * payload (in which case the caller leaves the existing PATH alone).
 */
export function readShellPath(shell: string, runner: ShellRunner = realRunner): string | null {
  // printf is built into every POSIX shell and avoids the `echo -n` portability
  // mess between bash/zsh/dash. The delimiters let us pull out PATH cleanly
  // even when .zshrc prints banners or a slow MOTD.
  const script = `printf "%s%s%s" "${DELIM}" "$PATH" "${DELIM}"`;
  const stdout = runner(shell, script);
  if (!stdout) return null;
  const start = stdout.indexOf(DELIM);
  if (start === -1) return null;
  const end = stdout.indexOf(DELIM, start + DELIM.length);
  if (end === -1) return null;
  const path = stdout.slice(start + DELIM.length, end);
  return path.length > 0 ? path : null;
}

/**
 * Apply the user's shell PATH onto process.env.PATH. Returns true if PATH
 * was actually modified. Safe to call multiple times; safe to ignore the
 * return value.
 */
export function applyUserShellPath(runner: ShellRunner = realRunner): boolean {
  const shell = process.env.SHELL || '/bin/zsh';
  const shellPath = readShellPath(shell, runner);
  if (!shellPath) return false;
  const merged = mergePaths(shellPath, process.env.PATH ?? '');
  if (merged === process.env.PATH) return false;
  process.env.PATH = merged;
  return true;
}
