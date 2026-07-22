/** Pure helpers for the Teams meetings cache. No Electron/DOM imports. */

export interface MeetingSummary {
  id: string;
  subject: string;
  subtitle: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  joinUrl: string | null;
}

export interface MeetingsToday {
  syncedAt: number;
  meetings: MeetingSummary[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Tolerant parse of the `teams.meetings_today` settings blob. */
export function parseMeetingsToday(raw: string | null): {
  meetings: MeetingSummary[];
  syncedAt: number | null;
} {
  if (!raw) return { meetings: [], syncedAt: null };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { meetings: [], syncedAt: null };
  }
  if (typeof obj !== 'object' || obj === null) return { meetings: [], syncedAt: null };
  const rec = obj as Record<string, unknown>;
  const syncedAt = typeof rec.syncedAt === 'number' ? rec.syncedAt : null;
  const list = Array.isArray(rec.meetings) ? rec.meetings : [];
  const meetings: MeetingSummary[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const m = item as Record<string, unknown>;
    if (!isNonEmptyString(m.id) || !isNonEmptyString(m.subject) || !isNonEmptyString(m.startsAt) || !isNonEmptyString(m.endsAt)) {
      continue;
    }
    meetings.push({
      id: m.id,
      subject: m.subject,
      subtitle: typeof m.subtitle === 'string' ? m.subtitle : '',
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      joinUrl: isNonEmptyString(m.joinUrl) ? m.joinUrl : null,
    });
  }
  return { meetings, syncedAt };
}

/**
 * Drop meetings that have already ended (endsAt at or before `nowMs`), keeping
 * in-progress and upcoming ones. Meetings with an unparseable `endsAt` are kept
 * (fail-open — better to show a joinable link than to hide a real meeting).
 * Time-relative, so callers re-run it with a fresh `nowMs` each render.
 */
export function upcomingMeetings(meetings: MeetingSummary[], nowMs: number): MeetingSummary[] {
  return meetings.filter((m) => {
    const end = Date.parse(m.endsAt);
    return Number.isNaN(end) || end > nowMs;
  });
}
