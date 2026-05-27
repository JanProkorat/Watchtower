import { describe, it, expect } from 'vitest';
import {
  decide,
  eventDate,
  eventMinutes,
  norm,
  roundUp15,
  type RawEvent,
  type RuleConfig,
} from '../../orchestrator/services/meetingRules.js';

const G100 = { id: 1, number: 'GREEN-100', title: '1:1 + syncs' };
const G34 = { id: 2, number: 'GREEN-34', title: 'Celofiremní porada' };
const DEFAULT_TASK = { id: 3, number: 'GREEN-345', title: 'Sprint 19' };
const G456 = { id: 4, number: 'GREEN-456', title: 'Some other epic' };

const CFG: RuleConfig = {
  green100: G100,
  green34: G34,
  defaultTask: DEFAULT_TASK,
  lookupByNumber: (n) => (n === 'GREEN-456' ? G456 : null),
};

function graphEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: 'evt-1',
    subject: 'Demo',
    isAllDay: false,
    responseStatus: { response: 'accepted' },
    start: { dateTime: '2026-05-13T09:00:00.0000000', timeZone: 'Europe/Prague' },
    end: { dateTime: '2026-05-13T10:00:00.0000000', timeZone: 'Europe/Prague' },
    ...overrides,
  };
}

function mcpEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: 'mcp-evt-1',
    subject: 'Demo',
    isAllDay: false,
    isCancelled: false,
    start: '2026-05-13T07:00:00.000Z',
    end: '2026-05-13T08:00:00.000Z',
    ...overrides,
  };
}

describe('helpers', () => {
  it('norm lowercases and collapses whitespace', () => {
    expect(norm('  Foo   Bar  ')).toBe('foo bar');
    expect(norm(null)).toBe('');
  });

  it('roundUp15 rounds up to the nearest quarter hour', () => {
    expect(roundUp15(0)).toBe(0);
    expect(roundUp15(-5)).toBe(0);
    expect(roundUp15(1)).toBe(15);
    expect(roundUp15(15)).toBe(15);
    expect(roundUp15(16)).toBe(30);
    expect(roundUp15(50)).toBe(60);
  });

  it('eventMinutes uses the graph and mcp shapes', () => {
    expect(eventMinutes(graphEvent())).toBe(60);
    expect(eventMinutes(mcpEvent())).toBe(60);
  });

  it('eventDate projects into Europe/Prague local day', () => {
    expect(eventDate(graphEvent())).toBe('2026-05-13');
    expect(eventDate(mcpEvent())).toBe('2026-05-13');
  });
});

describe('decide', () => {
  it('skips all-day events', () => {
    expect(decide(graphEvent({ isAllDay: true }), CFG).status).toBe('skipped');
  });
  it('skips declined invites', () => {
    expect(
      decide(graphEvent({ responseStatus: { response: 'declined' } }), CFG).status,
    ).toBe('skipped');
  });
  it('skips cancelled events', () => {
    expect(decide(graphEvent({ isCancelled: true }), CFG).status).toBe('skipped');
  });
  it('skips Tech lunch (case-insensitive)', () => {
    expect(decide(graphEvent({ subject: 'Tech lunch' }), CFG).status).toBe('skipped');
    expect(decide(graphEvent({ subject: 'TECH LUNCH May' }), CFG).status).toBe('skipped');
  });

  it('routes 1:1 meetings to GREEN-100', () => {
    const d = decide(graphEvent({ subject: '1:1 with Pavel' }), CFG);
    expect(d.status).toBe('logged');
    expect(d.worklog?.taskId).toBe(G100.id);
  });

  it('routes .NET sync to GREEN-100', () => {
    const d = decide(graphEvent({ subject: '.NET sync' }), CFG);
    expect(d.worklog?.taskId).toBe(G100.id);
  });

  it('routes celofiremní porada to GREEN-34 (with and without diacritics)', () => {
    expect(decide(graphEvent({ subject: 'Celofiremní porada' }), CFG).worklog?.taskId).toBe(
      G34.id,
    );
    expect(decide(graphEvent({ subject: 'celofiremni porada' }), CFG).worklog?.taskId).toBe(
      G34.id,
    );
  });

  it('routes by in-title task number when known', () => {
    const d = decide(graphEvent({ subject: 'GREEN-456 — design review' }), CFG);
    expect(d.worklog?.taskId).toBe(G456.id);
    expect(d.matchedRule).toContain('GREEN-456');
  });

  it('falls back to the default task when in-title task number is unknown', () => {
    const d = decide(graphEvent({ subject: 'GREEN-999 random' }), CFG);
    expect(d.worklog?.taskId).toBe(DEFAULT_TASK.id);
  });

  it('falls back to the default task for arbitrary titles', () => {
    const d = decide(graphEvent({ subject: 'Backlog grooming' }), CFG);
    expect(d.worklog?.taskId).toBe(DEFAULT_TASK.id);
  });

  it('rounds minutes up to nearest 15', () => {
    const d = decide(
      graphEvent({
        end: { dateTime: '2026-05-13T09:50:00.0000000', timeZone: 'Europe/Prague' },
      }),
      CFG,
    );
    expect(d.worklog?.minutes).toBe(60);
  });

  it('preserves the event id verbatim as externalId', () => {
    const d = decide(graphEvent({ id: 'AAMkAGI=' }), CFG);
    expect(d.worklog?.externalId).toBe('AAMkAGI=');
    expect(d.worklog?.source).toBe('outlook');
  });

  it('handles MCP flat shape (ISO UTC strings)', () => {
    expect(decide(mcpEvent(), CFG).worklog?.minutes).toBe(60);
    expect(
      decide(mcpEvent({ end: '2026-05-13T07:30:00.000Z' }), CFG).worklog?.minutes,
    ).toBe(30);
    expect(decide(mcpEvent({ subject: '1:1 Honza' }), CFG).worklog?.taskId).toBe(G100.id);
    expect(decide(mcpEvent({ isAllDay: true }), CFG).status).toBe('skipped');
  });

  it('returns unresolved when no task is available and no default exists', () => {
    const cfg: RuleConfig = { ...CFG, defaultTask: null };
    const d = decide(graphEvent({ subject: 'Unmatched' }), cfg);
    expect(d.status).toBe('unresolved');
  });
});
