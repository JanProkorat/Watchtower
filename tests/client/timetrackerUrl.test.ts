import { describe, it, expect } from 'vitest';
import {
  parseTimeTrackerHash,
  timetrackerHash,
  viewsEqual,
  DEFAULT_VIEW,
  type TimeTrackerView,
} from '../../client/src/util/timetrackerUrl.js';

describe('parseTimeTrackerHash', () => {
  it('parses every list-mode tab', () => {
    expect(parseTimeTrackerHash('#timetracker/projects')).toEqual({ mode: 'list', tab: 'projects' });
    expect(parseTimeTrackerHash('#timetracker/worklogs')).toEqual({ mode: 'list', tab: 'worklogs' });
    expect(parseTimeTrackerHash('#timetracker/grid')).toEqual({ mode: 'list', tab: 'grid' });
    expect(parseTimeTrackerHash('#timetracker/timeoff')).toEqual({ mode: 'list', tab: 'timeoff' });
    expect(parseTimeTrackerHash('#timetracker/reports')).toEqual({ mode: 'list', tab: 'reports' });
  });

  it('parses every detail-mode tab', () => {
    expect(parseTimeTrackerHash('#timetracker/detail/42/epics')).toEqual({
      mode: 'detail',
      projectId: 42,
      tab: 'epics',
    });
    expect(parseTimeTrackerHash('#timetracker/detail/42/worklogs')).toEqual({
      mode: 'detail',
      projectId: 42,
      tab: 'worklogs',
    });
    expect(parseTimeTrackerHash('#timetracker/detail/42/contracts')).toEqual({
      mode: 'detail',
      projectId: 42,
      tab: 'contracts',
    });
  });

  it('tolerates a missing leading #', () => {
    expect(parseTimeTrackerHash('timetracker/projects')).toEqual({ mode: 'list', tab: 'projects' });
    expect(parseTimeTrackerHash('timetracker/detail/7/epics')).toEqual({
      mode: 'detail',
      projectId: 7,
      tab: 'epics',
    });
  });

  it('returns null for an unrelated hash', () => {
    expect(parseTimeTrackerHash('')).toBeNull();
    expect(parseTimeTrackerHash('#')).toBeNull();
    expect(parseTimeTrackerHash('#instances')).toBeNull();
    expect(parseTimeTrackerHash('#settings/general')).toBeNull();
  });

  it('returns null for unknown list tabs', () => {
    expect(parseTimeTrackerHash('#timetracker/dashboard')).toBeNull();
    expect(parseTimeTrackerHash('#timetracker/projects/extra')).toBeNull();
  });

  it('returns null for unknown or malformed detail-mode hashes', () => {
    expect(parseTimeTrackerHash('#timetracker/detail')).toBeNull();
    expect(parseTimeTrackerHash('#timetracker/detail/42')).toBeNull();
    expect(parseTimeTrackerHash('#timetracker/detail/abc/epics')).toBeNull();
    expect(parseTimeTrackerHash('#timetracker/detail/-1/epics')).toBeNull();
    expect(parseTimeTrackerHash('#timetracker/detail/0/epics')).toBeNull();
    expect(parseTimeTrackerHash('#timetracker/detail/1.5/epics')).toBeNull();
    expect(parseTimeTrackerHash('#timetracker/detail/42/dashboard')).toBeNull();
    expect(parseTimeTrackerHash('#timetracker/detail/42/epics/extra')).toBeNull();
  });
});

describe('timetrackerHash', () => {
  it('serialises every list-mode view to a stable hash', () => {
    expect(timetrackerHash({ mode: 'list', tab: 'projects' })).toBe('#timetracker/projects');
    expect(timetrackerHash({ mode: 'list', tab: 'worklogs' })).toBe('#timetracker/worklogs');
    expect(timetrackerHash({ mode: 'list', tab: 'grid' })).toBe('#timetracker/grid');
    expect(timetrackerHash({ mode: 'list', tab: 'timeoff' })).toBe('#timetracker/timeoff');
    expect(timetrackerHash({ mode: 'list', tab: 'reports' })).toBe('#timetracker/reports');
  });

  it('serialises every detail-mode view to a stable hash', () => {
    expect(timetrackerHash({ mode: 'detail', projectId: 42, tab: 'epics' })).toBe(
      '#timetracker/detail/42/epics',
    );
    expect(timetrackerHash({ mode: 'detail', projectId: 7, tab: 'worklogs' })).toBe(
      '#timetracker/detail/7/worklogs',
    );
    expect(timetrackerHash({ mode: 'detail', projectId: 1, tab: 'contracts' })).toBe(
      '#timetracker/detail/1/contracts',
    );
  });

  it('round-trips parse↔serialise for every view', () => {
    const samples: TimeTrackerView[] = [
      { mode: 'list', tab: 'projects' },
      { mode: 'list', tab: 'worklogs' },
      { mode: 'list', tab: 'grid' },
      { mode: 'list', tab: 'timeoff' },
      { mode: 'list', tab: 'reports' },
      { mode: 'detail', projectId: 42, tab: 'epics' },
      { mode: 'detail', projectId: 7, tab: 'worklogs' },
      { mode: 'detail', projectId: 999, tab: 'contracts' },
    ];
    for (const v of samples) {
      expect(parseTimeTrackerHash(timetrackerHash(v))).toEqual(v);
    }
  });
});

describe('viewsEqual', () => {
  it('returns true for identical list views', () => {
    expect(viewsEqual({ mode: 'list', tab: 'projects' }, { mode: 'list', tab: 'projects' })).toBe(true);
  });

  it('returns true for identical detail views', () => {
    expect(
      viewsEqual(
        { mode: 'detail', projectId: 42, tab: 'epics' },
        { mode: 'detail', projectId: 42, tab: 'epics' },
      ),
    ).toBe(true);
  });

  it('returns false across modes', () => {
    expect(
      viewsEqual({ mode: 'list', tab: 'projects' }, { mode: 'detail', projectId: 1, tab: 'epics' }),
    ).toBe(false);
  });

  it('returns false for different list tabs', () => {
    expect(
      viewsEqual({ mode: 'list', tab: 'projects' }, { mode: 'list', tab: 'worklogs' }),
    ).toBe(false);
  });

  it('returns false for different project ids', () => {
    expect(
      viewsEqual(
        { mode: 'detail', projectId: 1, tab: 'epics' },
        { mode: 'detail', projectId: 2, tab: 'epics' },
      ),
    ).toBe(false);
  });

  it('returns false for different detail tabs', () => {
    expect(
      viewsEqual(
        { mode: 'detail', projectId: 1, tab: 'epics' },
        { mode: 'detail', projectId: 1, tab: 'contracts' },
      ),
    ).toBe(false);
  });
});

describe('DEFAULT_VIEW', () => {
  it('lands on Projects in list mode', () => {
    expect(DEFAULT_VIEW).toEqual({ mode: 'list', tab: 'projects' });
  });
});
