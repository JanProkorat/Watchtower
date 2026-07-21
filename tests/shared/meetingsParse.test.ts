import { describe, it, expect } from 'vitest';
import { parseMeetingsToday } from '@watchtower/shared/meetings.js';
import { ELECTRON_ONLY_KINDS } from '@watchtower/shared/ipcContract.js';

describe('parseMeetingsToday', () => {
  it('returns empty + null syncedAt for null/blank/invalid', () => {
    expect(parseMeetingsToday(null)).toEqual({ meetings: [], syncedAt: null });
    expect(parseMeetingsToday('')).toEqual({ meetings: [], syncedAt: null });
    expect(parseMeetingsToday('not json')).toEqual({ meetings: [], syncedAt: null });
    expect(parseMeetingsToday('{"meetings":123}')).toEqual({ meetings: [], syncedAt: null });
  });

  it('parses a valid blob and normalizes optional fields', () => {
    const raw = JSON.stringify({
      syncedAt: 1000,
      meetings: [
        { id: 'a', subject: 'Standup', subtitle: '6 people', startsAt: '2026-07-21T10:00:00Z', endsAt: '2026-07-21T10:15:00Z', joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' },
        { id: 'b', subject: 'In person', startsAt: '2026-07-21T13:00:00Z', endsAt: '2026-07-21T14:00:00Z' },
      ],
    });
    expect(parseMeetingsToday(raw)).toEqual({
      syncedAt: 1000,
      meetings: [
        { id: 'a', subject: 'Standup', subtitle: '6 people', startsAt: '2026-07-21T10:00:00Z', endsAt: '2026-07-21T10:15:00Z', joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' },
        { id: 'b', subject: 'In person', subtitle: '', startsAt: '2026-07-21T13:00:00Z', endsAt: '2026-07-21T14:00:00Z', joinUrl: null },
      ],
    });
  });

  it('drops entries missing required fields', () => {
    const raw = JSON.stringify({ syncedAt: 5, meetings: [{ subject: 'no id', startsAt: 'x', endsAt: 'y' }] });
    expect(parseMeetingsToday(raw)).toEqual({ meetings: [], syncedAt: 5 });
  });
});

describe('teams IPC kinds (v2)', () => {
  it('registers join/focus as electron-only and drops teams:open', () => {
    expect(ELECTRON_ONLY_KINDS.has('teams:joinMeeting')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('teams:focusCall')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('teams:open' as never)).toBe(false);
    expect(ELECTRON_ONLY_KINDS.has('meetings:listToday' as never)).toBe(false);
  });
});
