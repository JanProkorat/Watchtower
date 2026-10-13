import { describe, it, expect } from 'vitest';
import { parseFileTreeActivity, flashMap } from '@watchtower/shared/fileTree.js';

describe('parseFileTreeActivity', () => {
  it('accepts a v1 body, dropping junk entries and capping at 50', () => {
    const activity = [
      ...Array.from({ length: 60 }, (_, i) => ({ path: `/r/f${i}`, kind: 'read', at: i })),
      { path: 7, kind: 'read', at: 1 },
      { path: '/r/x', kind: 'erase', at: 1 },
    ];
    const s = parseFileTreeActivity({ version: 1, panelToggles: 2, sentAt: 9, activity });
    expect(s?.activity).toHaveLength(50);
    expect(s?.activity.at(-1)?.path).toBe('/r/f59');
    expect(s).toMatchObject({ panelToggles: 2, sentAt: 9 });
  });

  it('rejects non-v1 bodies; missing numbers read as 0', () => {
    expect(parseFileTreeActivity({ version: 2, activity: [] })).toBeNull();
    expect(parseFileTreeActivity(null)).toBeNull();
    expect(parseFileTreeActivity({ version: 1, activity: [] })).toEqual({ activity: [], panelToggles: 0, sentAt: 0 });
  });
});

describe('flashMap', () => {
  it('keeps recent entries inside the cwd, relative, latest touch winning', () => {
    const snap = {
      panelToggles: 0,
      sentAt: 10_000,
      activity: [
        { path: '/repo/src/a.ts', kind: 'read' as const, at: 9_000 },
        { path: '/repo/src/a.ts', kind: 'write' as const, at: 9_500 },
        { path: '/repo/old.ts', kind: 'read' as const, at: 1_000 },
        { path: '/elsewhere/b.ts', kind: 'read' as const, at: 9_900 },
      ],
    };
    expect(Object.fromEntries(flashMap(snap, '/repo'))).toEqual({ 'src/a.ts': { kind: 'write', at: 9_500 } });
    expect(flashMap(null, '/repo').size).toBe(0);
  });
});
