import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

/**
 * Pre-accept Claude Code's workspace-trust dialog for a directory *Watchtower
 * itself created* (today: a PR-implement worktree under `~/.watchtower/`).
 *
 * Trust is per exact directory path and lives in `~/.claude.json` under
 * `projects["<path>"].hasTrustDialogAccepted`. A freshly-created worktree has no
 * entry, so the spawned session opens on a modal the user has to answer before
 * the seeded prompt runs at all — which reads as "the agent did nothing".
 *
 * Only ever call this for a path Watchtower created from a repo the user already
 * has checked out locally; it is not a general-purpose trust bypass.
 *
 * Concurrency caveat: every running Claude session rewrites this file from its
 * own in-memory copy (session metrics, cost), so a concurrent write can drop the
 * entry we just added. That degrades to the trust prompt appearing again — never
 * to a corrupt config — so it is not worth locking for.
 */

export interface TrustDeps {
  configPath: string;
  exists(p: string): boolean;
  read(p: string): string;
  write(p: string, content: string): void;
  backup(p: string): void;
}

/**
 * The updated `~/.claude.json` text with `dirPath` marked trusted, or null when
 * no write should happen: already trusted, unparseable, or a shape we don't
 * recognise. Refusing to write beats rewriting a live 100 KB+ config we failed
 * to understand.
 */
export function withTrustedProject(raw: string, dirPath: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const config = parsed as Record<string, unknown>;

  const projectsRaw = config.projects;
  if (projectsRaw !== undefined
    && (typeof projectsRaw !== 'object' || projectsRaw === null || Array.isArray(projectsRaw))) {
    return null;
  }
  const projects = (projectsRaw ?? {}) as Record<string, unknown>;

  const entryRaw = projects[dirPath];
  const entry = (typeof entryRaw === 'object' && entryRaw !== null && !Array.isArray(entryRaw))
    ? entryRaw as Record<string, unknown>
    : {};
  if (entry.hasTrustDialogAccepted === true) return null;

  config.projects = { ...projects, [dirPath]: { ...entry, hasTrustDialogAccepted: true } };
  // 2-space matches how Claude Code writes the file, keeping our diff minimal.
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Mark `dirPath` trusted in the Claude config. Returns whether a write happened.
 * Never throws — a failure here only means the user sees the trust prompt, which
 * must not take the launch down with it.
 */
export function ensureProjectTrusted(dirPath: string, deps: TrustDeps): boolean {
  try {
    if (!deps.exists(deps.configPath)) return false;
    const next = withTrustedProject(deps.read(deps.configPath), dirPath);
    if (next === null) return false;
    deps.backup(deps.configPath);
    deps.write(deps.configPath, next);
    return true;
  } catch {
    return false;
  }
}

/** Production deps: the real `~/.claude.json` plus the repo's backup convention. */
export function defaultTrustDeps(now: () => Date = () => new Date()): TrustDeps {
  const configPath = path.join(homedir(), '.claude.json');
  return {
    configPath,
    exists: (p) => existsSync(p),
    read: (p) => readFileSync(p, 'utf8'),
    write: (p, content) => writeFileSync(p, content, 'utf8'),
    backup: (p) => { copyFileSync(p, `${p}.bak.${stamp(now())}`); },
  };
}

function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
