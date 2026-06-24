import { describe, expect, it } from 'vitest';
import { routeSpawnToTab } from '../../../apps/desktop/src/layout/routeSpawnToTab.js';

describe('routeSpawnToTab', () => {
  const projects = [
    { id: 1, folderPath: '/Users/me/foo' },
    { id: 2, folderPath: '/Users/me/bar' },
    { id: 3, folderPath: null },
  ];

  it('returns project tab id when cwd matches a project folderPath', () => {
    expect(routeSpawnToTab('/Users/me/foo', projects)).toBe('project:1');
    expect(routeSpawnToTab('/Users/me/bar', projects)).toBe('project:2');
  });

  it('returns cwd tab id when no project matches', () => {
    expect(routeSpawnToTab('/Users/me/orphan', projects)).toBe('cwd:/Users/me/orphan');
  });

  it('ignores projects with null folderPath', () => {
    expect(routeSpawnToTab('/x', [{ id: 3, folderPath: null }])).toBe('cwd:/x');
  });
});
