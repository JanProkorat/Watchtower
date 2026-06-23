import { describe, expect, it } from 'vitest';
import { pruneLayout } from '../../../client/src/layout/pruneLayout.js';
import { leaf, split } from '../../../client/src/layout/workspaceTreeOps.js';
import { DASHBOARD_TAB_ID } from '@watchtower/shared/layout.js';

describe('pruneLayout', () => {
  it('keeps the tree intact when all tabIds are valid', () => {
    const root = split('r', 'row', [leaf('a', 'project:1'), leaf('b', 'project:2')]);
    const validTabs = new Set(['project:1', 'project:2']);
    expect(pruneLayout(root, validTabs)).toEqual(root);
  });

  it('removes leaves whose tabId is missing', () => {
    const root = split('r', 'row', [leaf('a', 'project:1'), leaf('b', 'project:99')]);
    const out = pruneLayout(root, new Set(['project:1']));
    expect(out.kind).toBe('leaf');
    if (out.kind === 'leaf') expect(out.tabId).toBe('project:1');
  });

  it('falls back to dashboard when everything is invalid', () => {
    const root = split('r', 'row', [leaf('a', 'project:1'), leaf('b', 'project:2')]);
    const out = pruneLayout(root, new Set());
    expect(out.kind).toBe('leaf');
    if (out.kind === 'leaf') expect(out.tabId).toBe(DASHBOARD_TAB_ID);
  });

  it('flattens single-child splits', () => {
    const inner = split('s', 'col', [leaf('b', 'project:1'), leaf('c', 'project:99')]);
    const root = split('r', 'row', [leaf('a', 'project:99'), inner]);
    const out = pruneLayout(root, new Set(['project:1']));
    expect(out.kind).toBe('leaf');
    if (out.kind === 'leaf') expect(out.tabId).toBe('project:1');
  });
});
