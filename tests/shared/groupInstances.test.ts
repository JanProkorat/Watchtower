import { describe, it, expect } from 'vitest';
import { groupInstancesByProject } from '@watchtower/shared/groupInstances.js';

const projects = [
  { id: 1, name: 'watchtower', folderPath: '/Users/jan/Projects/Watchtower' },
  { id: 2, name: 'pps', folderPath: '/Users/jan/Projects/pps' },
];

describe('groupInstancesByProject', () => {
  it('groups instances under the project whose folderPath matches cwd', () => {
    const instances = [
      { id: 'a', cwd: '/Users/jan/Projects/Watchtower', status: 'working' },
      { id: 'b', cwd: '/Users/jan/Projects/pps', status: 'idle' },
    ];
    const groups = groupInstancesByProject(instances, projects);
    expect(groups.map((g) => [g.projectId, g.instanceIds])).toEqual([
      [1, ['a']],
      [2, ['b']],
    ]);
  });

  it('puts unmatched instances in a trailing Other group', () => {
    const instances = [{ id: 'x', cwd: '/tmp/scratch', status: 'idle' }];
    const groups = groupInstancesByProject(instances, projects);
    const other = groups[groups.length - 1];
    expect(other.projectId).toBeNull();
    expect(other.label).toBe('Other');
    expect(other.instanceIds).toEqual(['x']);
  });

  it('omits empty project groups', () => {
    const instances = [{ id: 'a', cwd: '/Users/jan/Projects/Watchtower', status: 'working' }];
    const groups = groupInstancesByProject(instances, projects);
    expect(groups.find((g) => g.projectId === 2)).toBeUndefined();
  });
});
