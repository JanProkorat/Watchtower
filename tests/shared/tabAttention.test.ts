import { describe, it, expect } from 'vitest';
import { tabsNeedingAttention, ACTION_NEEDED_STATUSES } from '@watchtower/shared/tabAttention.js';

describe('tabsNeedingAttention (shared)', () => {
  it('flags a tab with a waiting-permission member', () => {
    const tabs = [{ id: 't1', columnOrder: ['a'], hiddenInstanceIds: [] }];
    const status = new Map([['a', 'waiting-permission']]);
    expect(tabsNeedingAttention(tabs, status)).toEqual(new Set(['t1']));
  });
  it('ignores idle-notify (not action-needed)', () => {
    expect(ACTION_NEEDED_STATUSES.has('idle-notify')).toBe(false);
  });
});
