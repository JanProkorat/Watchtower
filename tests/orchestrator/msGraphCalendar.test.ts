import { describe, it, expect, vi } from 'vitest';
import { fetchCalendarEvents } from '../../orchestrator/services/msGraphCalendar.js';

describe('fetchCalendarEvents', () => {
  it('returns events on a single page', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          {
            id: '1',
            subject: 'A',
            isAllDay: false,
            isCancelled: false,
            responseStatus: { response: 'accepted' },
            start: { dateTime: '2026-05-14T09:00:00.0000000', timeZone: 'Europe/Prague' },
            end: { dateTime: '2026-05-14T10:00:00.0000000', timeZone: 'Europe/Prague' },
          },
        ],
      }),
    } as unknown as Response));
    const events = await fetchCalendarEvents('AT', '2026-05-14', '2026-05-14', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('1');
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('graph.microsoft.com/v1.0/me/calendarView');
    expect(url).toContain('startDateTime=2026-05-14T00:00:00');
    expect(url).toContain('endDateTime=2026-05-14T23:59:59.999');
  });

  it('follows @odata.nextLink across pages', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: [{ id: 'p1' }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView?skip=50',
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ value: [{ id: 'p2' }] }),
      } as unknown as Response;
    });
    const events = await fetchCalendarEvents('AT', '2026-05-14', '2026-05-27', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(events.map((e) => e.id)).toEqual(['p1', 'p2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when access token is unauthorized (401)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as unknown as Response));
    await expect(
      fetchCalendarEvents('AT', '2026-05-14', '2026-05-14', {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/401/);
  });

  it('caps results at the safety limit (500)', async () => {
    let page = 0;
    const fetchMock = vi.fn(async () => {
      page++;
      const value = Array.from({ length: 200 }, (_, i) => ({ id: `${page}-${i}` }));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          value,
          '@odata.nextLink': page < 5 ? 'https://graph.microsoft.com/next' : undefined,
        }),
      } as unknown as Response;
    });
    const events = await fetchCalendarEvents('AT', '2026-05-14', '2026-05-27', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(events.length).toBe(500);
  });

  it('sends the Prague timezone Prefer header and Bearer token', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ value: [] }),
    } as unknown as Response));
    await fetchCalendarEvents('AT', '2026-05-14', '2026-05-14', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer AT');
    expect(headers.prefer).toContain('Europe/Prague');
  });
});
