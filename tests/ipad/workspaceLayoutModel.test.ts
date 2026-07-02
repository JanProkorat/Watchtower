import { describe, it, expect } from 'vitest';
import {
  defaultTabLayout, splitPane, closePane, resizeSplitSizes, replacePane,
  focusPane, mountedInstanceIds, serializeWorkspace, deserializeWorkspace,
  appendPaneRight,
  type TabLayout,
} from '../../apps/ipad/src/state/workspaceLayoutModel.js';

function twoPane(): TabLayout {
  const base = defaultTabLayout('i1');
  return splitPane(base, rootLeafId(base), 'row', 'after', 'i2');
}
function rootLeafId(l: TabLayout): string {
  if (l.root.kind !== 'leaf') throw new Error('expected leaf root');
  return l.root.id;
}

describe('workspaceLayoutModel', () => {
  it('defaultTabLayout is a single focused leaf holding the instance', () => {
    const l = defaultTabLayout('i1');
    expect(l.root.kind).toBe('leaf');
    expect(mountedInstanceIds(l)).toEqual(['i1']);
    expect(l.focusedLeafId).toBe(rootLeafId(l));
  });

  it('splitPane adds a second pane holding the new instance', () => {
    const base = defaultTabLayout('i1');
    const l = splitPane(base, rootLeafId(base), 'row', 'after', 'i2');
    expect(l.root.kind).toBe('split');
    expect(mountedInstanceIds(l).sort()).toEqual(['i1', 'i2']);
  });

  it('splitPane refuses to mount an instance already in the tab', () => {
    const base = defaultTabLayout('i1');
    const l = splitPane(base, rootLeafId(base), 'row', 'after', 'i1');
    expect(l.root).toBe(base.root); // unchanged
  });

  it('closePane collapses back to the surviving pane', () => {
    const base = defaultTabLayout('i1');
    const two = splitPane(base, rootLeafId(base), 'row', 'after', 'i2');
    const survivorLeafId = two.root.kind === 'split' && two.root.children[0].kind === 'leaf'
      ? two.root.children[0].id : '';
    const closed = closePane(two, otherLeafId(two, survivorLeafId), 'i1');
    expect(closed.root.kind).toBe('leaf');
    expect(mountedInstanceIds(closed)).toEqual(['i1']);
  });

  it('closing the last pane falls back to a default single leaf', () => {
    const base = defaultTabLayout('i1');
    const closed = closePane(base, rootLeafId(base), 'i9');
    expect(closed.root.kind).toBe('leaf');
    expect(mountedInstanceIds(closed)).toEqual(['i9']);
  });

  it('closePane moves focus off a closed focused pane', () => {
    const base = defaultTabLayout('i1');
    const two = splitPane(base, rootLeafId(base), 'row', 'after', 'i2');
    const firstId = (two.root.kind === 'split' && two.root.children[0].kind === 'leaf') ? two.root.children[0].id : '';
    const focused = focusPane(two, firstId);
    const closed = closePane(focused, firstId, 'i1');
    expect(closed.focusedLeafId).not.toBe(firstId);
    expect(closed.focusedLeafId).not.toBeNull();
  });

  it('replacePane swaps the instance in a leaf', () => {
    const base = defaultTabLayout('i1');
    const l = replacePane(base, rootLeafId(base), 'i5');
    expect(mountedInstanceIds(l)).toEqual(['i5']);
  });

  it('resizeSplitSizes updates the split sizes', () => {
    const base = defaultTabLayout('i1');
    const two = splitPane(base, rootLeafId(base), 'row', 'after', 'i2');
    const splitId = two.root.id;
    const l = resizeSplitSizes(two, splitId, [70, 30]);
    expect(l.root.kind === 'split' && l.root.sizes).toEqual([70, 30]);
  });

  it('serialize/deserialize round-trips the whole state', () => {
    const state = { 'project:1': twoPane(), other: defaultTabLayout('i9') };
    const back = deserializeWorkspace(serializeWorkspace(state));
    expect(back).toEqual(state);
  });

  it('deserializeWorkspace returns {} on null or garbage', () => {
    expect(deserializeWorkspace(null)).toEqual({});
    expect(deserializeWorkspace('not json')).toEqual({});
  });

  it('appendPaneRight wraps a single leaf into a 50/50 row split, new pane rightmost + focused', () => {
    const l = appendPaneRight(defaultTabLayout('i1'), 'i2');
    expect(l.root.kind).toBe('split');
    if (l.root.kind !== 'split') throw new Error('expected split');
    expect(l.root.dir).toBe('row');
    // new pane is the last child (far right) and holds i2
    const last = l.root.children[l.root.children.length - 1];
    expect(last.kind === 'leaf' && last.tabId).toBe('i2');
    expect(l.focusedLeafId).toBe(last.kind === 'leaf' ? last.id : null);
    expect(l.root.sizes).toEqual([50, 50]);
  });

  it('appendPaneRight appends to an existing row split and evens the widths (thirds)', () => {
    const two = appendPaneRight(defaultTabLayout('i1'), 'i2');
    const three = appendPaneRight(two, 'i3');
    expect(three.root.kind).toBe('split');
    if (three.root.kind !== 'split') throw new Error('expected split');
    expect(three.root.children).toHaveLength(3);
    expect(mountedInstanceIds(three)).toEqual(['i1', 'i2', 'i3']); // order preserved, i3 rightmost
    three.root.sizes.forEach((s) => expect(s).toBeCloseTo(100 / 3));
  });

  it('appendPaneRight refuses an already-mounted instance', () => {
    const two = appendPaneRight(defaultTabLayout('i1'), 'i2');
    expect(appendPaneRight(two, 'i1')).toBe(two);
  });
});

function otherLeafId(l: TabLayout, notThis: string): string {
  const ids: string[] = [];
  const walk = (n: any) => n.kind === 'leaf' ? ids.push(n.id) : n.children.forEach(walk);
  walk(l.root);
  return ids.find((id) => id !== notThis) ?? notThis;
}
