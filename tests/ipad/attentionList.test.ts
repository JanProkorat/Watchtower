import { describe, it, expect } from 'vitest';
import { buildAttentionList } from '../../apps/ipad/src/state/attentionList.js';

const inst = (id: string, cwd: string, status: string) => ({ id, cwd, status, lastActivityAt: 0, kind: 'claude', taskId: null });

describe('buildAttentionList', () => {
  it('includes only attention statuses, with project label + reason', () => {
    const instances = [
      inst('a', '/Users/jan/Projects/api', 'waiting-permission'),
      inst('b', '/Users/jan/Projects/web', 'working'),       // excluded
      inst('c', '/Users/jan/x/fitness', 'waiting-input'),
      inst('d', '/tmp/z', 'crashed'),
    ];
    const projects = [{ id: 1, name: 'API', folderPath: '/Users/jan/Projects/api' }];
    expect(buildAttentionList(instances as never, projects as never)).toEqual([
      { instanceId: 'a', label: 'API', reason: 'waiting for permission' },     // project name
      { instanceId: 'c', label: 'fitness', reason: 'waiting for input' },      // cwd basename fallback
      { instanceId: 'd', label: 'z', reason: 'crashed' },
    ]);
  });
  it('returns empty when nothing needs attention', () => {
    expect(buildAttentionList([inst('a', '/x', 'working')] as never, [])).toEqual([]);
  });
});
