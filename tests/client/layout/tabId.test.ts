import { describe, expect, it } from 'vitest';
import {
  projectTabId,
  cwdTabId,
  isProjectTabId,
  isCwdTabId,
  isDashboardTabId,
  parseTabId,
} from '../../../apps/desktop/src/layout/tabId.js';
import { DASHBOARD_TAB_ID } from '@watchtower/shared/layout.js';

describe('tabId helpers', () => {
  it('builds project tab ids', () => {
    expect(projectTabId(42)).toBe('project:42');
  });
  it('builds cwd tab ids', () => {
    expect(cwdTabId('/Users/me/repo')).toBe('cwd:/Users/me/repo');
  });
  it('classifies tab ids', () => {
    expect(isProjectTabId('project:1')).toBe(true);
    expect(isCwdTabId('cwd:/x')).toBe(true);
    expect(isDashboardTabId(DASHBOARD_TAB_ID)).toBe(true);
    expect(isProjectTabId('cwd:/x')).toBe(false);
  });
  it('parses project ids', () => {
    expect(parseTabId('project:7')).toEqual({ kind: 'project', projectId: 7 });
    expect(parseTabId('cwd:/Users/x')).toEqual({ kind: 'cwd', cwd: '/Users/x' });
    expect(parseTabId(DASHBOARD_TAB_ID)).toEqual({ kind: 'dashboard' });
  });
});
