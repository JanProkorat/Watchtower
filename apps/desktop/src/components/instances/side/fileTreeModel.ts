import type { FileListResult, FileTreeGit, GitFile, GitFileStatus } from '@watchtower/shared/fileTree.js';

export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  size: number;
  mtimeMs: number;
  isOpen: boolean;
  /** A "+N more" note after a capped folder. */
  isMore?: boolean;
}

/** Visible rows: the root listing plus every expanded folder's, depth-first. */
export function buildRows(listings: ReadonlyMap<string, FileListResult>, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const add = (dir: string, depth: number) => {
    for (const e of listings.get(dir)?.entries ?? []) {
      const p = dir ? `${dir}/${e.name}` : e.name;
      const isOpen = e.isDir && expanded.has(p);
      rows.push({ path: p, name: e.name, depth, isDir: e.isDir, size: e.size, mtimeMs: e.mtimeMs, isOpen });
      if (isOpen) add(p, depth + 1);
    }
    const more = listings.get(dir)?.truncated ?? 0;
    if (more > 0) rows.push({ path: `${dir}/+more`, name: `+${more} more`, depth, isDir: false, size: 0, mtimeMs: 0, isOpen: false, isMore: true });
  };
  add('', 0);
  return rows;
}

export interface GitIndex {
  files: Map<string, GitFile>;
  dirTotals: Map<string, { added: number; deleted: number; changed: number }>;
  ignored: Set<string>;
}

export function indexGit(git: FileTreeGit | null): GitIndex {
  const idx: GitIndex = { files: new Map(), dirTotals: new Map(), ignored: new Set() };
  if (!git?.isRepo) return idx;
  for (const f of git.files) {
    if (f.status === 'ignored') {
      idx.ignored.add(f.path);
      continue;
    }
    idx.files.set(f.path, f);
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      const t = idx.dirTotals.get(dir) ?? { added: 0, deleted: 0, changed: 0 };
      idx.dirTotals.set(dir, { added: t.added + f.added, deleted: t.deleted + f.deleted, changed: t.changed + 1 });
    }
  }
  return idx;
}

/** A row's status: its own, or `ignored` when it or an ancestor is ignored. */
export function rowStatus(path: string, idx: GitIndex): GitFileStatus | null {
  const own = idx.files.get(path);
  if (own) return own.status;
  const parts = path.split('/');
  for (let i = parts.length; i > 0; i--) if (idx.ignored.has(parts.slice(0, i).join('/'))) return 'ignored';
  return null;
}

export function branchLabel(git: FileTreeGit | null): string {
  if (!git) return '';
  if (!git.isRepo) return 'Not a git repository';
  let added = 0;
  let deleted = 0;
  let modified = 0;
  for (const f of git.files) {
    added += f.added;
    deleted += f.deleted;
    if (f.status === 'modified') modified++;
  }
  return `${git.branch} ↑${git.ahead} ↓${git.behind} · +${added} −${deleted} M:${modified}`;
}
