import { describe, expect, it } from 'vitest';
import { leafToCollapseOnHide } from '../../../client/src/layout/hiddenPaneCollapse.js';
import { leaf, split } from '../../../client/src/layout/workspaceTreeOps.js';

describe('leafToCollapseOnHide', () => {
  it('returns the leaf id when the pane is part of a split', () => {
    const root = split('r', 'row', [
      leaf('a', 'project:1'),
      leaf('b', 'project:2'),
    ]);
    expect(leafToCollapseOnHide(root, 'project:2')).toBe('b');
  });

  it('returns null for a sole pane (keeps the all-hidden placeholder)', () => {
    const root = leaf('a', 'project:1');
    expect(leafToCollapseOnHide(root, 'project:1')).toBeNull();
  });

  it('returns null when the tab is not mounted in the tree', () => {
    const root = split('r', 'row', [
      leaf('a', 'project:1'),
      leaf('b', 'project:2'),
    ]);
    expect(leafToCollapseOnHide(root, 'project:99')).toBeNull();
  });

  it('finds the leaf in a nested split', () => {
    const inner = split('s', 'col', [
      leaf('b', 'project:2'),
      leaf('c', 'project:3'),
    ]);
    const root = split('r', 'row', [leaf('a', 'project:1'), inner]);
    expect(leafToCollapseOnHide(root, 'project:3')).toBe('c');
  });
});
