import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listDir, resolveInside, OUTSIDE_ROOT } from '../../orchestrator/services/fileTree.js';

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

  it('rejects a root that no longer exists', async () => {
    rmSync(root, { recursive: true, force: true });
    await expect(listDir(root, '')).rejects.toThrow(/ENOENT/);
  });
});
