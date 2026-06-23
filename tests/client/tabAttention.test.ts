import { describe, expect, it } from 'vitest';
import { tabsNeedingAttention, ACTION_NEEDED_STATUSES } from '../../apps/desktop/src/util/tabAttention.js';

const tab = (id: string, columnOrder: string[], hiddenInstanceIds: string[] = []) => ({
  id,
  columnOrder,
  hiddenInstanceIds,
});

describe('tabsNeedingAttention', () => {
  it('flags a tab whose visible session is waiting on a permission decision', () => {
    const tabs = [tab('project:1', ['a'])];
    const status = new Map([['a', 'waiting-permission']]);
    expect(tabsNeedingAttention(tabs, status)).toEqual(new Set(['project:1']));
  });

  it('flags waiting-input and crashed (everything needing the user)', () => {
    const tabs = [tab('project:1', ['a']), tab('cwd:/x', ['b'])];
    const status = new Map([
      ['a', 'waiting-input'],
      ['b', 'crashed'],
    ]);
    expect(tabsNeedingAttention(tabs, status)).toEqual(new Set(['project:1', 'cwd:/x']));
  });

  it('does NOT flag idle-notify or other passive states', () => {
    const tabs = [tab('project:1', ['a', 'b', 'c'])];
    const status = new Map([
      ['a', 'idle-notify'],
      ['b', 'working'],
      ['c', 'finished'],
    ]);
    expect(tabsNeedingAttention(tabs, status)).toEqual(new Set());
  });

  it('flags a tab when ANY member (incl. hidden sessions) needs the user', () => {
    const tabs = [tab('project:1', ['a'], ['hidden-b'])];
    const status = new Map([
      ['a', 'working'],
      ['hidden-b', 'waiting-permission'],
    ]);
    expect(tabsNeedingAttention(tabs, status)).toEqual(new Set(['project:1']));
  });

  it('ignores members with no known status and returns empty for no tabs', () => {
    const tabs = [tab('project:1', ['ghost'])];
    expect(tabsNeedingAttention(tabs, new Map())).toEqual(new Set());
    expect(tabsNeedingAttention([], new Map())).toEqual(new Set());
  });

  it('exposes the action-needed status set (permission, input, crashed only)', () => {
    expect(ACTION_NEEDED_STATUSES.has('waiting-permission')).toBe(true);
    expect(ACTION_NEEDED_STATUSES.has('waiting-input')).toBe(true);
    expect(ACTION_NEEDED_STATUSES.has('crashed')).toBe(true);
    expect(ACTION_NEEDED_STATUSES.has('idle-notify')).toBe(false);
    expect(ACTION_NEEDED_STATUSES.has('working')).toBe(false);
  });
});
