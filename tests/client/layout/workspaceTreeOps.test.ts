import { describe, expect, it } from 'vitest';
import {
  leaf,
  split,
  findLeafById,
  findLeafByTabId,
  firstLeafInPreOrder,
  splitLeaf,
  replaceLeafTab,
  unmountLeaf,
  setSizes,
  collectTabIds,
} from '../../../client/src/layout/workspaceTreeOps.js';
import type { WorkspaceNode } from '../../../shared/layout.js';

const L = (id: string, tabId: string): WorkspaceNode =>
  ({ kind: 'leaf', id, tabId: tabId as never });

describe('workspaceTreeOps', () => {
  it('findLeafById finds nested', () => {
    const root: WorkspaceNode = split('r', 'row', [L('a', 'project:1'), split('s', 'col', [L('b', 'project:2'), L('c', 'project:3')])]);
    expect(findLeafById(root, 'b')?.tabId).toBe('project:2');
    expect(findLeafById(root, 'missing')).toBeNull();
  });

  it('findLeafByTabId returns first match in pre-order', () => {
    const root = split('r', 'row', [L('a', 'project:1'), L('b', 'project:1')]);
    expect(findLeafByTabId(root, 'project:1' as never)?.id).toBe('a');
  });

  it('firstLeafInPreOrder returns leftmost', () => {
    const root = split('r', 'row', [split('s', 'col', [L('a', 'project:1'), L('b', 'project:2')]), L('c', 'project:3')]);
    expect(firstLeafInPreOrder(root)?.id).toBe('a');
  });

  it('splitLeaf wraps target leaf in a split', () => {
    const root = L('a', 'project:1');
    const next = splitLeaf(root, 'a', 'row', 'after', 'project:2');
    expect(next.kind).toBe('split');
    if (next.kind !== 'split') return;
    expect(next.dir).toBe('row');
    expect(next.children.map((c) => (c.kind === 'leaf' ? c.tabId : 'split'))).toEqual(['project:1', 'project:2']);
    expect(next.sizes).toEqual([50, 50]);
  });

  it('splitLeaf inserts before target when position=before', () => {
    const root = L('a', 'project:1');
    const next = splitLeaf(root, 'a', 'row', 'before', 'project:9');
    if (next.kind !== 'split') return;
    expect(next.children.map((c) => (c.kind === 'leaf' ? c.tabId : 'x'))).toEqual(['project:9', 'project:1']);
  });

  it('replaceLeafTab swaps tabId without restructuring', () => {
    const root = split('r', 'row', [L('a', 'project:1'), L('b', 'project:2')]);
    const next = replaceLeafTab(root, 'a', 'project:9' as never);
    expect(findLeafById(next, 'a')?.tabId).toBe('project:9');
  });

  it('unmountLeaf removes leaf and flattens single-child splits', () => {
    const root = split('r', 'row', [L('a', 'project:1'), L('b', 'project:2')]);
    const next = unmountLeaf(root, 'a');
    expect(next?.kind).toBe('leaf');
    if (next?.kind === 'leaf') expect(next.id).toBe('b');
  });

  it('unmountLeaf returns null when removing the only leaf', () => {
    const root = L('a', 'project:1');
    expect(unmountLeaf(root, 'a')).toBeNull();
  });

  it('unmountLeaf prunes deeply nested', () => {
    const root = split('r', 'row', [L('a', 'project:1'), split('s', 'col', [L('b', 'project:2'), L('c', 'project:3')])]);
    const next = unmountLeaf(root, 'b');
    // s now has 1 child → flattens to just 'c'; root becomes [a, c]
    if (next?.kind !== 'split') throw new Error('expected split');
    expect(next.children.map((c) => (c.kind === 'leaf' ? c.id : 'split'))).toEqual(['a', 'c']);
  });

  it('setSizes updates sizes on a split by id', () => {
    const root = split('r', 'row', [L('a', 'project:1'), L('b', 'project:2')]);
    const next = setSizes(root, 'r', [30, 70]);
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.sizes).toEqual([30, 70]);
  });

  it('collectTabIds returns all referenced tabs', () => {
    const root = split('r', 'row', [L('a', 'project:1'), split('s', 'col', [L('b', 'project:2'), L('c', 'project:1')])]);
    expect(new Set(collectTabIds(root))).toEqual(new Set(['project:1', 'project:2']));
  });
});
