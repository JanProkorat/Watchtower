import { describe, it, expect, vi } from 'vitest';
import { focusLaunchedSession } from '../../../apps/desktop/src/state/spawnIntoTab.js';
import { leaf } from '@watchtower/shared/workspaceTreeOps.js';
import { DASHBOARD_TAB_ID, type PersistedLayout, type TabId } from '@watchtower/shared/layout.js';

const layoutWith = (tabId: TabId): PersistedLayout => ({
  root: leaf('leaf-1', tabId),
  focusedLeafId: 'leaf-1',
  tabFocus: {},
});

const makeActions = () => ({
  focusLeaf: vi.fn(),
  replaceLeafTab: vi.fn(),
  focusColumnInTab: vi.fn(),
});

const makeEffects = () => ({
  addAdHocCwd: vi.fn(),
  showInstances: vi.fn(),
  activateInstance: vi.fn(),
});

const WORKTREE = '/Users/jan/.watchtower/worktrees/gh-a-b-pr5';
const WORKTREE_TAB = `cwd:${WORKTREE}`;

describe('focusLaunchedSession', () => {
  it('mounts the launched session tab, focuses its column and activates it', () => {
    const actions = makeActions();
    const effects = makeEffects();
    focusLaunchedSession(
      { layout: layoutWith(DASHBOARD_TAB_ID), actions: actions as never },
      { instanceId: 'inst-1', cwd: WORKTREE, projects: [] },
      effects,
    );
    // No leaf owns the tab yet → it takes over the focused leaf.
    expect(actions.replaceLeafTab).toHaveBeenCalledWith('leaf-1', WORKTREE_TAB);
    expect(actions.focusColumnInTab).toHaveBeenCalledWith(WORKTREE_TAB, 'inst-1');
    expect(effects.showInstances).toHaveBeenCalled();
    expect(effects.activateInstance).toHaveBeenCalledWith('inst-1');
  });

  it('registers the ad-hoc cwd so the tab survives until the instance row arrives', () => {
    const effects = makeEffects();
    focusLaunchedSession(
      { layout: layoutWith(DASHBOARD_TAB_ID), actions: makeActions() as never },
      { instanceId: 'inst-1', cwd: WORKTREE, projects: [] },
      effects,
    );
    expect(effects.addAdHocCwd).toHaveBeenCalledWith(WORKTREE);
  });

  it('does not register an ad-hoc cwd when the cwd is a known project folder', () => {
    const actions = makeActions();
    const effects = makeEffects();
    focusLaunchedSession(
      { layout: layoutWith(DASHBOARD_TAB_ID), actions: actions as never },
      { instanceId: 'inst-1', cwd: '/repo', projects: [{ id: 3, folderPath: '/repo' }] },
      effects,
    );
    expect(effects.addAdHocCwd).not.toHaveBeenCalled();
    expect(actions.replaceLeafTab).toHaveBeenCalledWith('leaf-1', 'project:3');
    expect(effects.activateInstance).toHaveBeenCalledWith('inst-1');
  });

  it('reuses an already-mounted leaf instead of replacing the focused one', () => {
    const actions = makeActions();
    focusLaunchedSession(
      { layout: layoutWith(WORKTREE_TAB as TabId), actions: actions as never },
      { instanceId: 'inst-1', cwd: WORKTREE, projects: [] },
      makeEffects(),
    );
    expect(actions.focusLeaf).toHaveBeenCalledWith('leaf-1');
    expect(actions.replaceLeafTab).not.toHaveBeenCalled();
  });

  it('still activates the instance when there is no focusable leaf to mount into', () => {
    const effects = makeEffects();
    focusLaunchedSession(
      { layout: { ...layoutWith(DASHBOARD_TAB_ID), focusedLeafId: null }, actions: makeActions() as never },
      { instanceId: 'inst-1', cwd: WORKTREE, projects: [] },
      effects,
    );
    expect(effects.showInstances).toHaveBeenCalled();
    expect(effects.activateInstance).toHaveBeenCalledWith('inst-1');
  });
});
