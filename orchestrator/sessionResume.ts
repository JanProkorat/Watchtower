import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

// A Watchtower-managed `claude` is launched with WATCHTOWER_INSTANCE_ID in its
// environment, and that variable is inherited by ANY child `claude` the managed
// session spawns — the global memory/handoff summarizer, skills, sub-agents,
// `deep-research`, etc., which typically run from /private/tmp or a temp dir.
// Those nested sessions fire the same global SessionStart/Stop/Notification/…
// hooks, and the bundled watchtower-hook helper tags every POST with the
// inherited WATCHTOWER_INSTANCE_ID. Routed naively, a nested session's
// SessionStart overwrites the managed instance's claude_session_id with an id
// that lives under a DIFFERENT project directory, so a later
// `claude --resume <id>` fails with "No session found with ID …".
//
// The discriminator is the working directory: the managed session always runs
// in the instance's own cwd; every nested contaminator runs somewhere else.

/** Canonicalize a path for comparison, resolving symlinks (/tmp → /private/tmp
 *  on macOS). Falls back to a trailing-slash-stripped string for paths that
 *  don't exist on disk (e.g. in unit tests). */
function canonicalize(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p.replace(/\/+$/, '');
  }
}

/**
 * True when a hook event's payload cwd belongs to the managed instance, i.e. the
 * event came from the managed `claude` and not a nested child running elsewhere.
 * A missing/empty hook cwd can't discriminate, so it is allowed through
 * (back-compat — every real Claude Code hook payload carries a cwd).
 */
export function hookCwdMatches(instanceCwd: string | undefined, hookCwd: unknown): boolean {
  if (!instanceCwd) return false;
  if (typeof hookCwd !== 'string' || hookCwd === '') return true;
  return canonicalize(instanceCwd) === canonicalize(hookCwd);
}

/** Claude Code's per-project session directory: ~/.claude/projects/<slug>, where
 *  <slug> is the cwd with every non-alphanumeric character replaced by '-'. */
export function projectSessionDir(cwd: string): string {
  const slug = cwd.replace(/[^A-Za-z0-9]/g, '-');
  return path.join(homedir(), '.claude', 'projects', slug);
}

/** Whether Claude has a resumable transcript for `sessionId` under `cwd`'s project. */
export function sessionFileExists(cwd: string, sessionId: string): boolean {
  if (!sessionId) return false;
  return fs.existsSync(path.join(projectSessionDir(cwd), `${sessionId}.jsonl`));
}

/**
 * Decide what to hand `claude --resume` for a row being respawned on boot.
 *
 * The stored claude_session_id is preferred, but a row contaminated before the
 * cwd gate landed may hold a foreign session id with no transcript under this
 * project — resuming it hard-fails. Fall back to the row id (the original
 * `--session-id <rowId>` session) when its transcript exists, else null to
 * signal a fresh spawn.
 */
export function resolveResumeTarget(
  row: { id: string; cwd: string; claudeSessionId: string | null },
  exists: (cwd: string, sessionId: string) => boolean = sessionFileExists,
): string | null {
  if (row.claudeSessionId && exists(row.cwd, row.claudeSessionId)) return row.claudeSessionId;
  if (exists(row.cwd, row.id)) return row.id;
  return null;
}
