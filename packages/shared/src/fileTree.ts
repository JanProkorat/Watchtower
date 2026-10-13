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
