import { execFile } from 'node:child_process';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, FileListResult, FileTreeGit, GitFile, GitFileStatus } from '@watchtower/shared/fileTree.js';

export const OUTSIDE_ROOT = 'Path is outside the instance folder';
const LIST_LIMIT = 5_000;

/** Absolute real path of `rel` under `root`; throws when it resolves outside `root`. */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const realRoot = await realpath(root);
  const lexical = path.resolve(realRoot, rel);
  // Refuse before touching the filesystem so outside paths can't be probed for existence.
  if (lexical !== realRoot && !lexical.startsWith(realRoot + path.sep)) throw new Error(OUTSIDE_ROOT);
  const target = await realpath(lexical);
  if (target !== realRoot && !target.startsWith(realRoot + path.sep)) throw new Error(OUTSIDE_ROOT);
  return target;
}

/** One folder's entries: folders first, then files, by name; capped at `limit`. */
export async function listDir(root: string, dir: string, limit = LIST_LIMIT): Promise<FileListResult> {
  const realRoot = await realpath(root);
  const abs = await resolveInside(realRoot, dir);
  const dirents = await readdir(abs, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const d of dirents) {
    const full = path.join(abs, d.name);
    try {
      const l = await lstat(full);
      let isDir = l.isDirectory();
      let s = l;
      if (l.isSymbolicLink()) {
        // A link is expandable only when it stays inside the cwd.
        const inside = await resolveInside(realRoot, path.relative(realRoot, full)).then(() => true, () => false);
        s = inside ? await stat(full) : l;
        isDir = inside && s.isDirectory();
      }
      entries.push({ name: d.name, isDir, size: isDir ? 0 : s.size, mtimeMs: s.mtimeMs });
    } catch {
      // Vanished between readdir and lstat; skip it.
    }
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) : a.isDir ? -1 : 1));
  return { dir, entries: entries.slice(0, limit), truncated: Math.max(0, entries.length - limit) };
}

const GIT_TIMEOUT = 5_000;

export interface StatusV2 {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: Map<string, GitFileStatus>;
}

/** Parses `git status --porcelain=v2 --branch -z --ignored=matching`. */
export function parseStatusV2(out: string): StatusV2 {
  const s: StatusV2 = { branch: '', upstream: null, ahead: 0, behind: 0, files: new Map() };
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] ?? '';
    if (f.startsWith('# branch.head ')) s.branch = f.slice(14);
    else if (f.startsWith('# branch.upstream ')) s.upstream = f.slice(18);
    else if (f.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(f);
      s.ahead = Number(m?.[1] ?? 0);
      s.behind = Number(m?.[2] ?? 0);
    } else if (f.startsWith('1 ')) {
      const parts = f.split(' ');
      s.files.set(parts.slice(8).join(' '), statusOf(parts[1] ?? '..'));
    } else if (f.startsWith('2 ')) {
      // A rename: the new path ends this field, the original path is the next one.
      s.files.set(f.split(' ').slice(9).join(' '), 'renamed');
      i++;
    } else if (f.startsWith('? ')) s.files.set(f.slice(2), 'untracked');
    else if (f.startsWith('! ')) s.files.set(f.slice(2).replace(/\/$/, ''), 'ignored');
  }
  return s;
}

function statusOf(xy: string): GitFileStatus {
  if (xy.includes('D')) return 'deleted';
  if (xy[0] === 'A') return 'added';
  if (xy.includes('R')) return 'renamed';
  return 'modified';
}

/** Parses `git diff --numstat -z`; renames are keyed by their new path, binary counts as 0. */
export function parseNumstat(out: string): Map<string, { added: number; deleted: number }> {
  const res = new Map<string, { added: number; deleted: number }>();
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(fields[i] ?? '');
    if (!m) continue;
    const counts = { added: m[1] === '-' ? 0 : Number(m[1]), deleted: m[2] === '-' ? 0 : Number(m[2]) };
    if (m[3]) res.set(m[3], counts);
    else {
      // Rename: the old and the new path follow as their own fields.
      res.set(fields[i + 2] ?? '', counts);
      i += 2;
    }
  }
  return res;
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-optional-locks', ...args], { cwd, timeout: GIT_TIMEOUT, maxBuffer: 32 * 1024 * 1024 }, (err, out) =>
      err ? reject(err) : resolve(out),
    );
  });
}

/** Branch, upstream and per-file status with line counts; `{ isRepo: false }` outside a repo or without git. */
export async function readGit(root: string): Promise<FileTreeGit> {
  let status: StatusV2;
  try {
    status = parseStatusV2(await runGit(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignored=matching']));
  } catch {
    return { isRepo: false };
  }
  // No commits yet: there is no HEAD to diff against.
  const numstat = parseNumstat(await runGit(root, ['diff', '--numstat', '-z', 'HEAD']).catch(() => ''));
  // Git prints repo-root-relative paths; keep only those under the cwd and make them cwd-relative.
  const prefix = (await runGit(root, ['rev-parse', '--show-prefix']).catch(() => '')).trim();
  const files: GitFile[] = [];
  for (const [p, st] of status.files) {
    if (!p.startsWith(prefix) || p === prefix.replace(/\/$/, '')) continue;
    files.push({ path: p.slice(prefix.length), status: st, ...(numstat.get(p) ?? { added: 0, deleted: 0 }) });
  }
  return { isRepo: true, branch: status.branch, upstream: status.upstream, ahead: status.ahead, behind: status.behind, files };
}

const SEARCH_LIMIT = 200;
const WALK_LIMIT = 20_000;
const WALK_SKIP = new Set(['.git', 'node_modules']);

/** Case-insensitive name match: basename hits first, then shorter paths, then by name. */
export function rankMatches(paths: readonly string[], query: string, limit = SEARCH_LIMIT): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { p: string; rank: number }[] = [];
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (!lower.includes(q)) continue;
    scored.push({ p, rank: path.posix.basename(lower).includes(q) ? 0 : 1 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.p.length - b.p.length || a.p.localeCompare(b.p));
  return scored.slice(0, limit).map((s) => s.p);
}

/** File paths under `root` matching `query`; git's file list in a repo, a capped walk elsewhere. */
export async function searchFiles(root: string, query: string, limit = SEARCH_LIMIT): Promise<string[]> {
  let paths: string[];
  try {
    const out = await runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    paths = out.split('\0').filter(Boolean);
  } catch {
    paths = await walk(root);
  }
  return rankMatches(paths, query, limit);
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [''];
  while (queue.length && out.length < WALK_LIMIT) {
    const rel = queue.shift() ?? '';
    const dirents = await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const d of dirents) {
      const p = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (!WALK_SKIP.has(d.name)) queue.push(p);
      } else out.push(p);
      if (out.length >= WALK_LIMIT) break;
    }
  }
  return out;
}
