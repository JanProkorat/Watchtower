// Pure routing rules for Outlook calendar events → Watchtower worklogs.
// Ported from the now-deprecated TimeTracker meeting-rules.mjs; behaviour and
// thresholds are identical so any TT-flavoured event JSON routes the same way.
//
// Accepts two event shapes:
//   1. Microsoft Graph raw — start/end are { dateTime, timeZone } and a
//      responseStatus.response field is present.
//   2. Claude M365 MCP flat — start/end are ISO UTC strings; responseStatus is
//      absent, showAs carries free/busy.
//
// LOCAL_TZ controls the local-day projection when an event crosses UTC
// midnight (e.g. 23:30 UTC on day X is "tomorrow" in Prague). Override with
// WATCHTOWER_TIMEZONE for non-Czech users.

const LOCAL_TZ = process.env.WATCHTOWER_TIMEZONE ?? 'Europe/Prague';

export interface TaskRef {
  id: number;
  number: string;
  title: string;
}

export interface RuleConfig {
  /** Resolved task for "1:1" / ".NET sync" meetings (GREEN-100 by convention). */
  green100: TaskRef | null;
  /** Resolved task for "celofiremní porada" (GREEN-34 by convention). */
  green34: TaskRef | null;
  /** Fallback when no rule matches and no in-title task number resolves. */
  defaultTask: TaskRef | null;
  /** Look up a task by its `number` column (e.g. "GREEN-456"). */
  lookupByNumber(number: string): TaskRef | null;
}

export interface DecidedWorklog {
  taskId: number;
  /** YYYY-MM-DD in LOCAL_TZ. */
  workDate: string;
  /** Rounded up to nearest 15. */
  minutes: number;
  description: string;
  source: 'outlook';
  externalId: string;
}

export type DecisionStatus = 'logged' | 'skipped' | 'unresolved';

export interface Decision {
  status: DecisionStatus;
  reason: string;
  worklog?: DecidedWorklog;
  matchedRule?: string;
}

export interface RawEvent {
  id?: string;
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  responseStatus?: { response?: string };
  start?: string | { dateTime?: string; timeZone?: string };
  end?: string | { dateTime?: string; timeZone?: string };
}

export function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function roundUp15(m: number): number {
  if (m <= 0) return 0;
  return Math.ceil(m / 15) * 15;
}

function pickIsoTime(value: RawEvent['start'] | RawEvent['end']): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  const s = value.dateTime;
  if (!s) return null;
  return s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s) ? s : s + 'Z';
}

export function eventMinutes(event: RawEvent): number {
  const startIso = pickIsoTime(event.start);
  const endIso = pickIsoTime(event.end);
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const raw = Math.round((end - start) / 60_000);
  return roundUp15(raw);
}

export function eventDate(event: RawEvent): string | null {
  const startIso = pickIsoTime(event.start);
  if (!startIso) return null;
  const d = new Date(startIso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: LOCAL_TZ });
}

const TASK_NUMBER_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const TECH_LUNCH_RE = /tech\s*lunch/;
const ONE_ON_ONE_RE = /(^|[^a-z0-9])1\s*[:x]\s*1($|[^a-z0-9])/;
const DOTNET_SYNC_RE = /\.?\s*net\s*sync/;
const CELOFIREMNI_RE = /celofirem[nň][ií]\s*porada/;

export function decide(event: RawEvent, config: RuleConfig): Decision {
  const subject = event.subject ?? '(no subject)';
  const lower = norm(subject);

  if (event.isAllDay) return { status: 'skipped', reason: 'all-day event' };
  if (event.responseStatus?.response === 'declined') {
    return { status: 'skipped', reason: 'declined' };
  }
  if (event.isCancelled === true) return { status: 'skipped', reason: 'cancelled' };
  if (TECH_LUNCH_RE.test(lower)) return { status: 'skipped', reason: 'tech lunch' };

  let task: TaskRef | null = null;
  let matchedRule = '';

  if (CELOFIREMNI_RE.test(lower)) {
    task = config.green34;
    matchedRule = 'celofiremni-porada';
  } else if (ONE_ON_ONE_RE.test(lower) || DOTNET_SYNC_RE.test(lower)) {
    task = config.green100;
    matchedRule = '1:1 / .NET sync';
  } else {
    const m = subject.match(TASK_NUMBER_RE);
    const found = m?.[1];
    if (found) {
      task = config.lookupByNumber(found);
      matchedRule = `title task number ${found}`;
    }
    if (!task) {
      task = config.defaultTask;
      matchedRule = matchedRule || 'default sprint task';
    }
  }

  if (!task) {
    return {
      status: 'unresolved',
      reason: `no task available for "${subject}" (rule: ${matchedRule || 'default'})`,
    };
  }

  const minutes = eventMinutes(event);
  if (minutes <= 0) return { status: 'skipped', reason: 'zero duration' };

  const workDate = eventDate(event);
  if (!workDate) return { status: 'skipped', reason: 'unparseable start time' };

  return {
    status: 'logged',
    reason: `routed via ${matchedRule}`,
    matchedRule,
    worklog: {
      taskId: task.id,
      workDate,
      minutes,
      description: subject,
      source: 'outlook',
      externalId: event.id ?? '',
    },
  };
}
