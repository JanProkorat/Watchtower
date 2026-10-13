import { describe, it, expect } from 'vitest';
import type { FileListResult, FileTreeGit } from '@watchtower/shared/fileTree.js';
import { buildRows, indexGit, rowStatus, branchLabel } from '../../../apps/desktop/src/components/instances/side/fileTreeModel';

const ls = (dir: string, names: [string, boolean][]): [string, FileListResult] => [
  dir,
  { dir, entries: names.map(([name, isDir]) => ({ name, isDir, size: 1, mtimeMs: 1 })), truncated: 0 },
];

describe('buildRows', () => {
  it('flattens only expanded folders, depth-first', () => {
    const listings = new Map([ls('', [['src', true], ['lib', true], ['a.ts', false]]), ls('src', [['b.ts', false]]), ls('lib', [['c.ts', false]])]);
    const rows = buildRows(listings, new Set(['src']));
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.path}`)).toEqual(['src', '  src/b.ts', 'lib', 'a.ts']);
    expect(rows[0]?.isOpen).toBe(true);
  });

  it('adds a "+N more" row after any capped folder', () => {
    const [, sub] = ls('src', [['b.ts', false]]);
    const listings = new Map([ls('', [['src', true]]), ['src', { ...sub, truncated: 7 }] as [string, FileListResult]]);
    const rows = buildRows(listings, new Set(['src']));
    expect(rows.at(-1)).toMatchObject({ name: '+7 more', depth: 1, isMore: true });
  });

  it('adds git-deleted files under their listed folder, only when it is expanded, never twice', () => {
    const listings = new Map([ls('', [['src', true], ['top.ts', false]]), ls('src', [['b.ts', false]])]);
    const deleted = new Set(['src/gone.ts', 'src/b.ts', 'src/deep/x.ts']);
    const open = buildRows(listings, new Set(['src']), deleted);
    expect(open.map((r) => r.path)).toEqual(['src', 'src/b.ts', 'src/gone.ts', 'top.ts']);
    expect(open[2]).toMatchObject({ name: 'gone.ts', depth: 1, isDir: false, size: 0, mtimeMs: 0 });
    expect(buildRows(listings, new Set(), deleted).map((r) => r.path)).toEqual(['src', 'top.ts']);
  });
});

const repo: FileTreeGit = {
  isRepo: true,
  branch: 'main',
  upstream: 'origin/main',
  ahead: 2,
  behind: 0,
  files: [
    { path: 'src/a.ts', status: 'modified', added: 3, deleted: 1 },
    { path: 'src/deep/b.ts', status: 'untracked', added: 0, deleted: 0 },
    { path: 'build', status: 'ignored', added: 0, deleted: 0 },
  ],
};

describe('indexGit / rowStatus', () => {
  it('sums changes into every ancestor folder; ignored files do not count', () => {
    const idx = indexGit(repo);
    expect(idx.dirTotals.get('src')).toEqual({ added: 3, deleted: 1, changed: 2 });
    expect(idx.dirTotals.get('src/deep')).toEqual({ added: 0, deleted: 0, changed: 1 });
    expect(idx.dirTotals.has('build')).toBe(false);
  });

  it('a file under an ignored folder reads as ignored', () => {
    const idx = indexGit(repo);
    expect(rowStatus('src/a.ts', idx)).toBe('modified');
    expect(rowStatus('build/out/x.js', idx)).toBe('ignored');
    expect(rowStatus('README.md', idx)).toBeNull();
  });

  it('no repo: empty index', () => {
    expect(indexGit({ isRepo: false }).files.size).toBe(0);
  });
});

describe('branchLabel', () => {
  it('branch, ahead/behind and totals; a plain note outside a repo', () => {
    expect(branchLabel(repo)).toBe('main ↑2 ↓0 · +3 −1 M:1');
    expect(branchLabel({ isRepo: false })).toBe('Not a git repository');
    expect(branchLabel(null)).toBe('');
  });
});
