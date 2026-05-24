import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

/**
 * Resolve the absolute path of a `settings.json` file for the given scope.
 *
 *   - `global` → `~/.claude/settings.json`
 *   - `project` → `<projectPath>/.claude/settings.json`
 *
 * `projectPath` is expanded for a leading `~/` (matches how spawnInstance
 * + the launch bridge handle paths elsewhere).
 */
export function resolveSettingsPath(
  scope: 'global' | 'project',
  projectPath?: string,
): string {
  if (scope === 'global') {
    return path.join(homedir(), '.claude', 'settings.json');
  }
  if (!projectPath) {
    throw new Error('project scope requires a projectPath');
  }
  const expanded = projectPath.startsWith('~/')
    ? path.join(homedir(), projectPath.slice(2))
    : projectPath === '~'
      ? homedir()
      : projectPath;
  return path.join(expanded, '.claude', 'settings.json');
}

export interface ReadResult {
  path: string;
  exists: boolean;
  content: string;
}

/**
 * Read the resolved settings file. Returns an empty content string when the
 * file does not exist (the caller distinguishes empty-and-missing from
 * empty-and-present via `exists`).
 */
export function readSettings(
  scope: 'global' | 'project',
  projectPath?: string,
): ReadResult {
  const p = resolveSettingsPath(scope, projectPath);
  if (!existsSync(p)) {
    return { path: p, exists: false, content: '' };
  }
  return { path: p, exists: true, content: readFileSync(p, 'utf8') };
}

export interface WriteResult {
  ok: boolean;
  backupPath?: string;
  error?: string;
}

/**
 * Write the given content to the resolved settings file.
 *
 *   1. Validate that `content` parses as JSON (refuse to write garbage).
 *   2. If the file already exists, copy it to `<path>.bak.<ISO timestamp>`.
 *      Backups accumulate — never deleted — so manual roll-back is always
 *      possible.
 *   3. Ensure the containing `.claude/` directory exists (creates it on
 *      first write for a project that doesn't have one yet).
 *   4. Write the new content. No atomic rename — settings.json is small
 *      enough that a partial write is recoverable via the backup.
 */
export function writeSettings(
  scope: 'global' | 'project',
  projectPath: string | undefined,
  content: string,
  now: () => Date = () => new Date(),
): WriteResult {
  const p = resolveSettingsPath(scope, projectPath);

  try {
    JSON.parse(content);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  let backupPath: string | undefined;
  if (existsSync(p)) {
    backupPath = `${p}.bak.${ts(now())}`;
    copyFileSync(p, backupPath);
  } else {
    mkdirSync(path.dirname(p), { recursive: true });
  }

  writeFileSync(p, content, 'utf8');
  return { ok: true, backupPath };
}

function ts(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}
