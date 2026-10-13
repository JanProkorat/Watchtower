import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, FileListResult } from '@watchtower/shared/fileTree.js';

export const OUTSIDE_ROOT = 'Path is outside the instance folder';
const LIST_LIMIT = 5_000;

/** Absolute real path of `rel` under `root`; throws when it resolves outside `root`. */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const realRoot = await realpath(root);
  const target = await realpath(path.resolve(realRoot, rel));
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
