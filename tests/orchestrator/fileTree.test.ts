import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { listDir, resolveInside, OUTSIDE_ROOT, parseStatusV2, parseNumstat, readGit } from '../../orchestrator/services/fileTree.js';

let root: string;
let outside: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wt-ft-')));
  outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'wt-out-')));
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'a dir'));
  writeFileSync(path.join(root, 'b.txt'), 'hello');
  writeFileSync(path.join(root, 'A.md'), '#');
  writeFileSync(path.join(root, 'src', 'žluťoučký.ts'), 'x');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('listDir', () => {
  it('lists folders first, then files, by name, with size and mtime', async () => {
    const res = await listDir(root, '');
    expect(res.dir).toBe('');
    expect(res.entries.map((e) => e.name)).toEqual(['a dir', 'src', 'A.md', 'b.txt']);
    const b = res.entries.find((e) => e.name === 'b.txt');
    expect(b).toMatchObject({ isDir: false, size: 5 });
    expect(b?.mtimeMs).toBeGreaterThan(0);
    expect(res.truncated).toBe(0);
  });

  it('lists a subfolder by its relative path, unicode names included', async () => {
    const res = await listDir(root, 'src');
    expect(res.entries.map((e) => e.name)).toEqual(['žluťoučký.ts']);
  });

  it('caps the listing and reports the rest', async () => {
    for (let i = 0; i < 5; i++) writeFileSync(path.join(root, `f${i}`), '');
    const res = await listDir(root, '', 3);
    expect(res.entries).toHaveLength(3);
    expect(res.truncated).toBe(6);
  });

  it('shows a symlink that leaves the folder as a plain file (not expandable)', async () => {
    symlinkSync(outside, path.join(root, 'escape'));
    const res = await listDir(root, '');
    expect(res.entries.find((e) => e.name === 'escape')).toMatchObject({ isDir: false });
  });
});

describe('resolveInside', () => {
  it('refuses ../ and symlink escapes', async () => {
    symlinkSync(outside, path.join(root, 'escape'));
    await expect(resolveInside(root, '../')).rejects.toThrow(OUTSIDE_ROOT);
    await expect(resolveInside(root, 'escape')).rejects.toThrow(OUTSIDE_ROOT);
    await expect(listDir(root, 'escape')).rejects.toThrow(OUTSIDE_ROOT);
  });

  it('accepts the root and folders inside it', async () => {
    expect(await resolveInside(root, '')).toBe(root);
    expect(await resolveInside(root, 'src')).toBe(path.join(root, 'src'));
  });

  it('refuses an absolute path and a missing outside path the same way', async () => {
    await expect(resolveInside(root, '/etc')).rejects.toThrow(OUTSIDE_ROOT);
    await expect(resolveInside(root, '../definitely-missing-xyz')).rejects.toThrow(OUTSIDE_ROOT);
  });

  it('a symlink to a folder inside the cwd is listed as an expandable folder', async () => {
    symlinkSync(path.join(root, 'src'), path.join(root, 'src-link'));
    const res = await listDir(root, '');
    expect(res.entries.find((e) => e.name === 'src-link')).toMatchObject({ isDir: true });
    expect((await listDir(root, 'src-link')).entries.map((e) => e.name)).toEqual(['žluťoučký.ts']);
  });

  it('rejects a root that no longer exists', async () => {
    rmSync(root, { recursive: true, force: true });
    await expect(listDir(root, '')).rejects.toThrow(/ENOENT/);
  });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

describe('parseStatusV2', () => {
  it('reads branch headers and every entry kind, renames and spaces included', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a a src/app.ts',
      '1 A. N... 000000 100644 100644 0 a new file.ts',
      '1 .D N... 100644 100644 000000 a a gone.ts',
      '2 R. N... 100644 100644 100644 a a R100 renamed.ts',
      'old name.ts',
      '? notes.md',
      '! node_modules/',
      '',
    ].join('\0');
    const s = parseStatusV2(out);
    expect(s).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 });
    expect(Object.fromEntries(s.files)).toEqual({
      'src/app.ts': 'modified',
      'new file.ts': 'added',
      'gone.ts': 'deleted',
      'renamed.ts': 'renamed',
      'notes.md': 'untracked',
      node_modules: 'ignored',
    });
  });

  it('a detached head and no upstream', () => {
    const s = parseStatusV2(['# branch.head (detached)', ''].join('\0'));
    expect(s).toMatchObject({ branch: '(detached)', upstream: null, ahead: 0, behind: 0 });
  });
});

describe('parseNumstat', () => {
  it('reads counts, treats binary as 0, and keys renames by the new path', () => {
    const out = ['3\t1\tsrc/app.ts', '-\t-\timg.png', '2\t2\t', 'old name.ts', 'renamed.ts', ''].join('\0');
    expect(Object.fromEntries(parseNumstat(out))).toEqual({
      'src/app.ts': { added: 3, deleted: 1 },
      'img.png': { added: 0, deleted: 0 },
      'renamed.ts': { added: 2, deleted: 2 },
    });
  });
});

describe('readGit', () => {
  it('outside a repo: isRepo false', async () => {
    expect(await readGit(root)).toEqual({ isRepo: false });
  });

  it('a repo with no commits yet: untracked files and the branch name', async () => {
    git(root, 'init', '-q', '-b', 'main');
    const g = await readGit(root);
    expect(g.isRepo).toBe(true);
    if (!g.isRepo) return;
    expect(g.branch).toBe('main');
    expect(g.files.find((f) => f.path === 'b.txt')).toMatchObject({ status: 'untracked', added: 0, deleted: 0 });
  });

  it('a committed repo: modified with line counts, ignored folders', async () => {
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(root, '.gitignore'), 'build/\n');
    mkdirSync(path.join(root, 'build'));
    writeFileSync(path.join(root, 'build', 'out.js'), '');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'init');
    writeFileSync(path.join(root, 'b.txt'), 'hello\nworld\n');
    const g = await readGit(root);
    if (!g.isRepo) throw new Error('expected a repo');
    expect(g.files.find((f) => f.path === 'b.txt')).toMatchObject({ status: 'modified', added: 2, deleted: 1 });
    expect(g.files.find((f) => f.path === 'build')).toMatchObject({ status: 'ignored' });
  });

  it('a cwd inside a repo: paths are relative to the cwd and outside entries are dropped', async () => {
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(root, 'top.txt'), 'a\n');
    writeFileSync(path.join(root, 'src', 'x.ts'), 'a\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'init');
    writeFileSync(path.join(root, 'top.txt'), 'b\n');
    writeFileSync(path.join(root, 'src', 'x.ts'), 'b\nc\n');
    writeFileSync(path.join(root, 'src', 'new.ts'), 'n');
    const g = await readGit(path.join(root, 'src'));
    if (!g.isRepo) throw new Error('expected a repo');
    expect(g.files.find((f) => f.path === 'x.ts')).toMatchObject({ status: 'modified', added: 2, deleted: 1 });
    expect(g.files.find((f) => f.path === 'new.ts')).toMatchObject({ status: 'untracked' });
    expect(g.files.some((f) => f.path === 'top.txt' || f.path.startsWith('src/'))).toBe(false);
  });
});
