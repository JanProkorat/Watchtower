// Microsoft Graph calendarView fetcher.
//
// Returns RawEvent[] in the shape the existing meetingRules engine expects
// (same field names as `outlook_calendar_search` MCP returns when given
// `Prefer: outlook.timezone="Europe/Prague"`). Paginates via
// `@odata.nextLink` and caps at MAX_EVENTS to avoid runaway loops if a
// huge window is requested.

import type { RawEvent } from './meetingRules.js';

export interface FetchDeps {
  fetch: typeof fetch;
}

const SELECT = '$select=id,subject,isAllDay,isCancelled,responseStatus,start,end';
const TOP = '$top=50';
const MAX_EVENTS = 500;

export async function fetchCalendarEvents(
  accessToken: string,
  from: string, // YYYY-MM-DD
  to: string, // YYYY-MM-DD
  deps: FetchDeps = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<RawEvent[]> {
  const initial =
    `https://graph.microsoft.com/v1.0/me/calendarView` +
    `?startDateTime=${from}T00:00:00` +
    `&endDateTime=${to}T23:59:59.999` +
    `&${SELECT}&${TOP}`;

  const headers = {
    authorization: `Bearer ${accessToken}`,
    prefer: 'outlook.timezone="Europe/Prague"',
  } as const;

  let url: string | undefined = initial;
  const events: RawEvent[] = [];

  while (url) {
    const r = await deps.fetch(url, { headers });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Graph calendarView failed (${r.status}): ${text}`);
    }
    const j = (await r.json()) as {
      value?: RawEvent[];
      '@odata.nextLink'?: string;
    };
    for (const e of j.value ?? []) {
      events.push(e);
      if (events.length >= MAX_EVENTS) return events;
    }
    url = j['@odata.nextLink'];
  }
  return events;
}
