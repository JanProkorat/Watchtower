// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { FileListResult } from '@watchtower/shared/fileTree.js';

const calls: { kind: string; payload: unknown }[] = [];
let pushes: ((p: { instanceId: string }) => void)[] = [];
const listings: Record<string, FileListResult> = {
  '': { dir: '', entries: [{ name: 'src', isDir: true, size: 0, mtimeMs: 1 }, { name: 'a.ts', isDir: false, size: 1, mtimeMs: 1 }], truncated: 0 },
  src: { dir: 'src', entries: [{ name: 'deep', isDir: true, size: 0, mtimeMs: 1 }], truncated: 0 },
  'src/deep': { dir: 'src/deep', entries: [{ name: 'x.ts', isDir: false, size: 1, mtimeMs: 1 }], truncated: 0 },
};
vi.mock('../../apps/desktop/src/state/ipc', () => ({
  invoke: vi.fn(async (kind: string, payload: { dir?: string }) => {
    calls.push({ kind, payload });
    if (kind === 'fileTree:list') {
      const l = listings[payload.dir ?? ''];
      if (!l) throw new Error('ENOENT: no such file or directory');
      return l;
    }
    if (kind === 'fileTree:git') return { isRepo: false };
    if (kind === 'fileTree:search') return ['src/deep/x.ts'];
    return { ok: true };
  }),
}));

import { useFileTree } from '../../apps/desktop/src/state/useFileTree';

beforeEach(() => {
  calls.length = 0;
  pushes = [];
  (window as unknown as { watchtower: unknown }).watchtower = {
    on: (kind: string, cb: (p: { instanceId: string }) => void) => {
      if (kind === 'fileTreeChanged') pushes.push(cb);
      return () => {};
    },
  };
});

describe('useFileTree', () => {
  it('watches, lists the root and reads git when enabled; unwatches on unmount', async () => {
    const { result, unmount } = renderHook(() => useFileTree('i1', true));
    await waitFor(() => expect(result.current.listings.get('')).toBeDefined());
    expect(result.current.git).toEqual({ isRepo: false });
    expect(calls.map((c) => c.kind)).toEqual(expect.arrayContaining(['fileTree:watch', 'fileTree:list', 'fileTree:git']));
    unmount();
    expect(calls.at(-1)?.kind).toBe('fileTree:unwatch');
  });

  it('does nothing while disabled', () => {
    renderHook(() => useFileTree('i1', false));
    expect(calls).toEqual([]);
  });

  it('toggle expands and lists a folder, then collapses it', async () => {
    const { result } = renderHook(() => useFileTree('i1', true));
    await waitFor(() => expect(result.current.listings.get('')).toBeDefined());
    act(() => result.current.toggle('src'));
    await waitFor(() => expect(result.current.listings.get('src')).toBeDefined());
    expect(result.current.expanded.has('src')).toBe(true);
    act(() => result.current.toggle('src'));
    expect(result.current.expanded.has('src')).toBe(false);
  });

  it('reveal expands every ancestor of a file', async () => {
    const { result } = renderHook(() => useFileTree('i1', true));
    await waitFor(() => expect(result.current.listings.get('')).toBeDefined());
    act(() => result.current.reveal('src/deep/x.ts'));
    await waitFor(() => expect(result.current.listings.get('src/deep')).toBeDefined());
    expect([...result.current.expanded].sort()).toEqual(['src', 'src/deep']);
  });

  it('a change push re-lists open folders and git, silently', async () => {
    const { result } = renderHook(() => useFileTree('i1', true));
    await waitFor(() => expect(result.current.listings.get('')).toBeDefined());
    calls.length = 0;
    act(() => pushes.forEach((p) => p({ instanceId: 'i1' })));
    await waitFor(() => expect(calls.some((c) => c.kind === 'fileTree:git')).toBe(true));
    expect(calls.filter((c) => c.kind === 'fileTree:list').map((c) => (c.payload as { dir: string }).dir)).toEqual(['']);
  });

  it('a missing folder becomes an inline error, not a retry loop', async () => {
    listings[''] = undefined as unknown as FileListResult;
    const { result } = renderHook(() => useFileTree('i1', true));
    await waitFor(() => expect(result.current.error).toBe('Folder not found'));
    listings[''] = { dir: '', entries: [], truncated: 0 };
  });
});
