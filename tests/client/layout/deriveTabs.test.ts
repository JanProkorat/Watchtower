import { describe, expect, it } from 'vitest';
import { deriveTabs } from '../../../client/src/layout/deriveTabs.js';
import type { InstanceView } from '../../../client/src/state/useInstances.js';
import type { ProjectViewPayload } from '../../../shared/ipcContract.js';
import { DASHBOARD_TAB_ID } from '../../../shared/layout.js';

const inst = (id: string, cwd: string): InstanceView => ({
  id,
  cwd,
  status: 'working',
  lastActivityAt: 0,
});

const proj = (id: number, folderPath: string | null, color = '#0af'): ProjectViewPayload =>
  ({
    id,
    name: `P${id}`,
    color,
    archived: false,
    kind: 'work',
    isDefault: false,
    folderPath,
    jiraGlobs: [],
    jiraBoardUrl: null,
    taskUrlTemplate: null,
    description: null,
    createdAt: '',
    epicCount: 0,
  }) as unknown as ProjectViewPayload;

describe('deriveTabs', () => {
  it('always includes the dashboard tab first', () => {
    const tabs = deriveTabs([], [], new Set(), {});
    expect(tabs.map((t) => t.id)).toEqual([DASHBOARD_TAB_ID]);
  });

  it('groups instances by matching project folderPath', () => {
    const projects = [proj(1, '/a'), proj(2, '/b')];
    const instances = [inst('i1', '/a'), inst('i2', '/a'), inst('i3', '/b')];
    const tabs = deriveTabs(instances, projects, new Set(), {});
    expect(tabs.find((t) => t.id === 'project:1')?.columnOrder).toEqual(['i1', 'i2']);
    expect(tabs.find((t) => t.id === 'project:2')?.columnOrder).toEqual(['i3']);
  });

  it('puts unmatched instances in ad-hoc cwd tabs', () => {
    const tabs = deriveTabs([inst('i1', '/x'), inst('i2', '/x')], [], new Set(), {});
    expect(tabs.find((t) => t.id === 'cwd:/x')?.columnOrder).toEqual(['i1', 'i2']);
  });

  it('preserves ad-hoc tabs that the user opened even with no instances', () => {
    const tabs = deriveTabs([], [], new Set(['/empty']), {});
    expect(tabs.some((t) => t.id === 'cwd:/empty')).toBe(true);
  });

  it('applies tabFocus when provided', () => {
    const tabs = deriveTabs(
      [inst('i1', '/a'), inst('i2', '/a')],
      [proj(1, '/a')],
      new Set(),
      { 'project:1': 'i2' },
    );
    expect(tabs.find((t) => t.id === 'project:1')?.focusedInstanceId).toBe('i2');
  });

  it('filters hidden instance ids out of columnOrder and surfaces them in hiddenInstanceIds', () => {
    const tabs = deriveTabs(
      [inst('i1', '/a'), inst('i2', '/a'), inst('i3', '/a')],
      [proj(1, '/a')],
      new Set(),
      {},
      new Set(['i2']),
    );
    const t = tabs.find((x) => x.id === 'project:1')!;
    expect(t.columnOrder).toEqual(['i1', 'i3']);
    expect(t.hiddenInstanceIds).toEqual(['i2']);
  });

  it('keeps a tab in the strip even when every session is hidden', () => {
    const tabs = deriveTabs(
      [inst('i1', '/a')],
      [proj(1, '/a')],
      new Set(),
      {},
      new Set(['i1']),
    );
    const t = tabs.find((x) => x.id === 'project:1');
    expect(t).toBeDefined();
    expect(t?.columnOrder).toEqual([]);
    expect(t?.hiddenInstanceIds).toEqual(['i1']);
  });

  it('falls back focusedInstanceId to first visible (not hidden) column', () => {
    const tabs = deriveTabs(
      [inst('i1', '/a'), inst('i2', '/a')],
      [proj(1, '/a')],
      new Set(),
      { 'project:1': 'i1' }, // saved focus is on hidden i1 → should fall through
      new Set(['i1']),
    );
    expect(tabs.find((t) => t.id === 'project:1')?.focusedInstanceId).toBe('i2');
  });
});
