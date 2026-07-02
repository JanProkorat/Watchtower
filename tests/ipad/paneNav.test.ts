import { describe, it, expect } from 'vitest';
import { adjacentLeaf } from '../../apps/ipad/src/lib/paneNav.js';
import type { Rect } from '@watchtower/shared/computePaneRects.js';

const rects = new Map<string, Rect>([
  ['a', { x: 0, y: 0, w: 100, h: 100 }],
  ['b', { x: 100, y: 0, w: 100, h: 100 }],
  ['c', { x: 0, y: 100, w: 100, h: 100 }],
]);

describe('adjacentLeaf', () => {
  it('finds the pane to the right', () => expect(adjacentLeaf(rects, 'a', 'right')).toBe('b'));
  it('finds the pane below', () => expect(adjacentLeaf(rects, 'a', 'down')).toBe('c'));
  it('returns null when there is no neighbour that way', () => {
    expect(adjacentLeaf(rects, 'a', 'left')).toBeNull();
    expect(adjacentLeaf(rects, 'b', 'right')).toBeNull();
  });
  it('returns null for an unknown focused id', () => expect(adjacentLeaf(rects, 'zzz', 'right')).toBeNull());
});
