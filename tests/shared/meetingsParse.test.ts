import { describe, it, expect } from 'vitest';
import { parseMeetingsToday, upcomingMeetings } from '@watchtower/shared/meetings.js';
import type { MeetingSummary } from '@watchtower/shared/meetings.js';
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

describe('upcomingMeetings', () => {
  const now = Date.parse('2026-07-21T12:00:00Z');
  const mk = (id: string, startsAt: string, endsAt: string): MeetingSummary => ({
    id,
    subject: id,
    subtitle: '',
    startsAt,
    endsAt,
    joinUrl: null,
  });

  it('hides meetings that already ended; keeps in-progress and future', () => {
    const past = mk('past', '2026-07-21T10:00:00Z', '2026-07-21T11:00:00Z');
    const inProgress = mk('now', '2026-07-21T11:30:00Z', '2026-07-21T12:30:00Z');
    const future = mk('later', '2026-07-21T14:00:00Z', '2026-07-21T15:00:00Z');
    expect(upcomingMeetings([past, inProgress, future], now).map((m) => m.id)).toEqual(['now', 'later']);
  });

  it('keeps a meeting whose end time is unparseable (fail-open)', () => {
    const bad = mk('bad', '2026-07-21T00:00:00Z', 'not-a-date');
    expect(upcomingMeetings([bad], now).map((m) => m.id)).toEqual(['bad']);
  });

  it('returns [] when every meeting has ended', () => {
    const past = mk('past', '2026-07-21T09:00:00Z', '2026-07-21T09:30:00Z');
    expect(upcomingMeetings([past], now)).toEqual([]);
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
