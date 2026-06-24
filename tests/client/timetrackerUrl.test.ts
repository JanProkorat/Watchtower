import { describe, it, expect } from 'vitest';
import {
  parseTimeTrackerHash,
  timetrackerHash,
  viewsEqual,
  DEFAULT_VIEW,
  type TimeTrackerView,
} from '../../apps/desktop/src/util/timetrackerUrl.js';

describe('parseTimeTrackerHash', () => {
  it('parses every tab without a project id', () => {
    expect(parseTimeTrackerHash('#billing/projects')).toEqual({ tab: 'projects', projectId: null });
    expect(parseTimeTrackerHash('#billing/worklogs')).toEqual({ tab: 'worklogs', projectId: null });
    expect(parseTimeTrackerHash('#billing/grid')).toEqual({ tab: 'grid', projectId: null });
    expect(parseTimeTrackerHash('#billing/timeoff')).toEqual({ tab: 'timeoff', projectId: null });
    expect(parseTimeTrackerHash('#billing/reports')).toEqual({ tab: 'reports', projectId: null });
    expect(parseTimeTrackerHash('#billing/board')).toEqual({ tab: 'board', projectId: null });
  });

  it('parses a selected project on the projects tab', () => {
    expect(parseTimeTrackerHash('#billing/projects/42')).toEqual({
      tab: 'projects',
      projectId: 42,
    });
    expect(parseTimeTrackerHash('#billing/projects/1')).toEqual({
      tab: 'projects',
      projectId: 1,
    });
  });

  it('tolerates a missing leading #', () => {
    expect(parseTimeTrackerHash('billing/projects')).toEqual({ tab: 'projects', projectId: null });
    expect(parseTimeTrackerHash('billing/projects/7')).toEqual({ tab: 'projects', projectId: 7 });
  });

  it('still accepts the legacy #timetracker/ prefix (rename back-compat)', () => {
    expect(parseTimeTrackerHash('#timetracker/projects')).toEqual({ tab: 'projects', projectId: null });
    expect(parseTimeTrackerHash('#timetracker/projects/42')).toEqual({ tab: 'projects', projectId: 42 });
    expect(parseTimeTrackerHash('timetracker/worklogs')).toEqual({ tab: 'worklogs', projectId: null });
  });

  it('returns null for an unrelated hash', () => {
    expect(parseTimeTrackerHash('')).toBeNull();
    expect(parseTimeTrackerHash('#')).toBeNull();
    expect(parseTimeTrackerHash('#instances')).toBeNull();
    expect(parseTimeTrackerHash('#settings/general')).toBeNull();
  });

  it('returns null for unknown tabs', () => {
    expect(parseTimeTrackerHash('#billing/dashboard')).toBeNull();
    expect(parseTimeTrackerHash('#billing/projects/extra/segment')).toBeNull();
  });

  it('returns null for non-positive / non-integer / malformed project ids', () => {
    expect(parseTimeTrackerHash('#billing/projects/abc')).toBeNull();
    expect(parseTimeTrackerHash('#billing/projects/-1')).toBeNull();
    expect(parseTimeTrackerHash('#billing/projects/0')).toBeNull();
    expect(parseTimeTrackerHash('#billing/projects/1.5')).toBeNull();
  });

  it('does not accept project ids on tabs other than projects', () => {
    expect(parseTimeTrackerHash('#billing/worklogs/42')).toBeNull();
    expect(parseTimeTrackerHash('#billing/board/42')).toBeNull();
  });
});

describe('timetrackerHash', () => {
  it('serialises every tab without a selection to a stable hash', () => {
    expect(timetrackerHash({ tab: 'projects', projectId: null })).toBe('#billing/projects');
    expect(timetrackerHash({ tab: 'worklogs', projectId: null })).toBe('#billing/worklogs');
    expect(timetrackerHash({ tab: 'grid', projectId: null })).toBe('#billing/grid');
    expect(timetrackerHash({ tab: 'timeoff', projectId: null })).toBe('#billing/timeoff');
    expect(timetrackerHash({ tab: 'reports', projectId: null })).toBe('#billing/reports');
    expect(timetrackerHash({ tab: 'board', projectId: null })).toBe('#billing/board');
  });

  it('serialises a selected project on the projects tab', () => {
    expect(timetrackerHash({ tab: 'projects', projectId: 42 })).toBe('#billing/projects/42');
    expect(timetrackerHash({ tab: 'projects', projectId: 1 })).toBe('#billing/projects/1');
  });

  it('ignores projectId on non-projects tabs (defensive normalisation)', () => {
    // The hook never sets projectId for non-projects tabs, but if a caller
    // builds the view by hand we still produce a clean hash.
    expect(timetrackerHash({ tab: 'worklogs', projectId: 99 } as TimeTrackerView)).toBe(
      '#billing/worklogs',
    );
  });

  it('round-trips parse↔serialise for every view', () => {
    const samples: TimeTrackerView[] = [
      { tab: 'projects', projectId: null },
      { tab: 'projects', projectId: 42 },
      { tab: 'worklogs', projectId: null },
      { tab: 'grid', projectId: null },
      { tab: 'timeoff', projectId: null },
      { tab: 'reports', projectId: null },
      { tab: 'board', projectId: null },
    ];
    for (const v of samples) {
      expect(parseTimeTrackerHash(timetrackerHash(v))).toEqual(v);
    }
  });
});

describe('viewsEqual', () => {
  it('returns true for identical views', () => {
    expect(
      viewsEqual({ tab: 'projects', projectId: null }, { tab: 'projects', projectId: null }),
    ).toBe(true);
    expect(
      viewsEqual({ tab: 'projects', projectId: 42 }, { tab: 'projects', projectId: 42 }),
    ).toBe(true);
  });

  it('returns false for different tabs', () => {
    expect(
      viewsEqual({ tab: 'projects', projectId: null }, { tab: 'worklogs', projectId: null }),
    ).toBe(false);
  });

  it('returns false for different project ids on the projects tab', () => {
    expect(
      viewsEqual({ tab: 'projects', projectId: 1 }, { tab: 'projects', projectId: 2 }),
    ).toBe(false);
  });

  it('ignores projectId on non-projects tabs', () => {
    // The hook normalises projectId to null for non-projects tabs, so two
    // worklogs views with different (stale) projectIds are still equal.
    expect(
      viewsEqual(
        { tab: 'worklogs', projectId: 99 } as TimeTrackerView,
        { tab: 'worklogs', projectId: 1 } as TimeTrackerView,
      ),
    ).toBe(true);
  });
});

describe('DEFAULT_VIEW', () => {
  it('lands on Projects with no selection', () => {
    expect(DEFAULT_VIEW).toEqual({ tab: 'projects', projectId: null });
  });
});
