// Shapes for the native Files tab (orchestrator/services/fileTree.ts) and the
// filetree mod's activity bridge (plugins/filetree → POST /mods/filetree).

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

/** One folder's listing; `dir` is relative to the instance cwd ('' = the cwd). */
export interface FileListResult {
  dir: string;
  entries: FileEntry[];
  /** Entries left out past the cap. */
  truncated: number;
}

export type GitFileStatus = 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed' | 'ignored';

/** `path` is relative to the cwd; an ignored folder has no trailing slash. */
export interface GitFile {
  path: string;
  status: GitFileStatus;
  added: number;
  deleted: number;
}

export type FileTreeGit =
  | { isRepo: false }
  | { isRepo: true; branch: string; upstream: string | null; ahead: number; behind: number; files: GitFile[] };

/** One file Claude touched, as the filetree mod reports it (absolute path). */
export interface FileActivity {
  path: string;
  kind: 'read' | 'write';
  at: number;
}

/** What the filetree mod (plugins/filetree) POSTs to `/mods/filetree`. */
export interface FileTreeActivitySnapshot {
  activity: FileActivity[];
  /** Bumped by each `/filetree` run; a rise toggles the Files tab. */
  panelToggles: number;
  sentAt: number;
}

export interface FileTreeActivityState {
  instanceId: string;
  snapshot: FileTreeActivitySnapshot;
  receivedAt: number;
}

const MAX_ACTIVITY = 50;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Validates a POSTed body; lenient per field, strict on the shape. */
export function parseFileTreeActivity(body: unknown): FileTreeActivitySnapshot | null {
  if (!isObj(body) || body.version !== 1 || !Array.isArray(body.activity)) return null;
  const activity = body.activity
    .filter((a): a is Record<string, unknown> => isObj(a) && typeof a.path === 'string' && (a.kind === 'read' || a.kind === 'write'))
    .map((a) => ({ path: a.path as string, kind: a.kind as 'read' | 'write', at: num(a.at) }))
    .slice(-MAX_ACTIVITY);
  return { activity, panelToggles: num(body.panelToggles), sentAt: num(body.sentAt) };
}

/** cwd-relative paths touched within `windowMs` of the snapshot; the latest touch per path wins. */
export function flashMap(
  snapshot: FileTreeActivitySnapshot | null,
  cwd: string,
  windowMs = 4_000,
): Map<string, { kind: 'read' | 'write'; at: number }> {
  const res = new Map<string, { kind: 'read' | 'write'; at: number }>();
  if (!snapshot) return res;
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
  for (const a of snapshot.activity) {
    if (!a.path.startsWith(prefix) || snapshot.sentAt - a.at > windowMs) continue;
    const rel = a.path.slice(prefix.length);
    const prev = res.get(rel);
    if (!prev || a.at >= prev.at) res.set(rel, { kind: a.kind, at: a.at });
  }
  return res;
}
