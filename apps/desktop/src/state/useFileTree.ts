import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileListResult, FileTreeGit } from '@watchtower/shared/fileTree.js';
import { invoke } from './ipc';

export interface FileTreeState {
  listings: ReadonlyMap<string, FileListResult>;
  expanded: ReadonlySet<string>;
  git: FileTreeGit | null;
  /** Inline message when the root can't be listed. */
  error: string | null;
  toggle(dir: string): void;
  reveal(filePath: string): void;
  search(query: string): Promise<string[]>;
}

const ancestorsOf = (p: string): string[] => {
  const parts = p.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
};

/** One pane's file tree: folder listings, git status and live refresh while `enabled`. */
export function useFileTree(instanceId: string, enabled: boolean): FileTreeState {
  const [listings, setListings] = useState<Map<string, FileListResult>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [git, setGit] = useState<FileTreeGit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const lastInstance = useRef<string | null>(null);

  const load = useCallback(
    async (dir: string, silent: boolean) => {
      try {
        const res = await invoke('fileTree:list', { instanceId, dir }, { silent });
        setListings((prev) => new Map(prev).set(dir, res));
        if (dir === '') setError(null);
      } catch (err) {
        if (dir === '') setError(/ENOENT/.test(String(err)) ? 'Folder not found' : String((err as Error).message ?? err));
      }
    },
    [instanceId],
  );
  const loadGit = useCallback(() => {
    invoke('fileTree:git', { instanceId }).then(setGit, () => setGit({ isRepo: false }));
  }, [instanceId]);

  useEffect(() => {
    if (!enabled) return;
    // Expanded folders survive a tab switch; only another instance starts over.
    if (lastInstance.current !== instanceId) {
      lastInstance.current = instanceId;
      setListings(new Map());
      setExpanded(new Set());
      setGit(null);
    }
    setError(null);
    void invoke('fileTree:watch', { instanceId }).catch(() => {});
    // Silent: a root failure shows as the tab's inline note, so no toast too.
    for (const dir of ['', ...expandedRef.current]) void load(dir, true);
    loadGit();
    const off = window.watchtower.on('fileTreeChanged', (p) => {
      if (p.instanceId !== instanceId) return;
      for (const dir of ['', ...expandedRef.current]) void load(dir, true);
      loadGit();
    });
    return () => {
      off();
      void invoke('fileTree:unwatch', { instanceId }).catch(() => {});
    };
  }, [instanceId, enabled, load, loadGit]);

  const toggle = (dir: string) => {
    const isOpen = expanded.has(dir);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(dir);
      else next.add(dir);
      return next;
    });
    // A user-initiated expand may toast on failure.
    if (!isOpen) void load(dir, false);
  };

  const reveal = (filePath: string) => {
    const dirs = ancestorsOf(filePath);
    setExpanded((prev) => new Set([...prev, ...dirs]));
    for (const d of dirs) if (!listings.has(d)) void load(d, true);
  };

  const search = (query: string) => invoke('fileTree:search', { instanceId, query });

  return { listings, expanded, git, error, toggle, reveal, search };
}
