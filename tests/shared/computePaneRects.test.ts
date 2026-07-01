import { describe, it, expect } from 'vitest';
import { computePaneRects } from '@watchtower/shared/computePaneRects.js';
import { leaf, split } from '@watchtower/shared/workspaceTreeOps.js';
import type { WorkspaceNode } from '@watchtower/shared/layout.js';

const L = (id: string, v: string): WorkspaceNode<string> => leaf<string>(id, v);

describe('computePaneRects', () => {
  it('single leaf fills the whole box', () => {
    const rects = computePaneRects(L('a', 'i1'), 1000, 800, 6);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });

  it('row split 50/50 subtracts one gap and halves the remainder', () => {
    const root = split<string>('s', 'row', [L('a', 'i1'), L('b', 'i2')], [50, 50]);
    const rects = computePaneRects(root, 1006, 800, 6);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 500, h: 800 });
    expect(rects.get('b')).toEqual({ x: 506, y: 0, w: 500, h: 800 });
  });

  it('col split stacks vertically with a gap', () => {
    const root = split<string>('s', 'col', [L('a', 'i1'), L('b', 'i2')], [25, 75]);
    const rects = computePaneRects(root, 400, 806, 6);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 400, h: 200 });
    expect(rects.get('b')).toEqual({ x: 0, y: 206, w: 400, h: 600 });
  });

  it('nested split tiles without gaps or overlap', () => {
    const inner = split<string>('s2', 'col', [L('b', 'i2'), L('c', 'i3')], [50, 50]);
    const root = split<string>('s1', 'row', [L('a', 'i1'), inner], [50, 50]);
    const rects = computePaneRects(root, 206, 206, 6);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 206 });
    expect(rects.get('b')).toEqual({ x: 106, y: 0, w: 100, h: 100 });
    expect(rects.get('c')).toEqual({ x: 106, y: 106, w: 100, h: 100 });
  });

  it('normalizes sizes that do not sum to 100', () => {
    const root = split<string>('s', 'row', [L('a', 'i1'), L('b', 'i2')], [1, 3]);
    const rects = computePaneRects(root, 400, 100, 0);
    expect(rects.get('a')!.w).toBeCloseTo(100);
    expect(rects.get('b')!.w).toBeCloseTo(300);
  });
});
