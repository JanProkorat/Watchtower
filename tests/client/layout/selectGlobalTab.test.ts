import { describe, expect, it, vi } from 'vitest';
import { selectGlobalTab } from '../../../client/src/layout/selectGlobalTab.js';
import { DASHBOARD_TAB_ID } from '../../../shared/layout.js';

function makeDeps(focused: Record<string, string | null> = {}) {
  return {
    setActiveModule: vi.fn(),
    ensureMounted: vi.fn(),
    setActive: vi.fn(),
    focusedInstanceIdForTab: vi.fn((id: string) => focused[id] ?? null),
  };
}

describe('selectGlobalTab', () => {
  it('always switches to the Instances module first', () => {
    const deps = makeDeps();
    selectGlobalTab('project:1', deps);
    expect(deps.setActiveModule).toHaveBeenCalledWith('instances');
  });

  it('mounts and focuses the selected tab', () => {
    const deps = makeDeps();
    selectGlobalTab('project:1', deps);
    expect(deps.ensureMounted).toHaveBeenCalledWith('project:1');
  });

  it('activates the tab\'s focused instance', () => {
    const deps = makeDeps({ 'project:1': 'inst-7' });
    selectGlobalTab('project:1', deps);
    expect(deps.setActive).toHaveBeenCalledWith('inst-7');
  });

  it('does not activate any instance when the tab has none', () => {
    const deps = makeDeps({ 'project:1': null });
    selectGlobalTab('project:1', deps);
    expect(deps.setActive).not.toHaveBeenCalled();
  });

  it('clears the active instance for the Dashboard tab', () => {
    const deps = makeDeps();
    selectGlobalTab(DASHBOARD_TAB_ID, deps);
    expect(deps.setActive).toHaveBeenCalledWith(null);
    expect(deps.focusedInstanceIdForTab).not.toHaveBeenCalled();
  });
});
