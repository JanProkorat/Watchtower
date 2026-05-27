// Outlook → Watchtower meetings sync.
//
// Calls Microsoft Graph directly via the `MsGraphAuthService` token cache,
// applies the routing rules from `meetingRules`, and inserts worklogs via
// `WorklogsRepo`. The `(source, external_id)` partial unique index in
// `timetracker_schema.sql` makes re-runs idempotent — duplicate inserts
// are counted as `duplicate` rather than treated as errors.

import type { SqliteLike } from '../db/migrations.js';
import { WorklogsRepo } from '../db/repositories/worklogs.js';
import {
  decide,
  type RawEvent,
  type RuleConfig,
  type TaskRef,
} from './meetingRules.js';
import { MsGraphAuthService, NotAuthenticatedError } from './msGraphAuth.js';
import { fetchCalendarEvents } from './msGraphCalendar.js';

export interface MeetingsSyncRequest {
  /** Inclusive YYYY-MM-DD. */
  from: string;
  /** Inclusive YYYY-MM-DD. */
  to: string;
}

export interface MeetingsSyncResult {
  ok: boolean;
  exitCode: number | null;
  summary: string;
  logged: number;
  skipped: number;
  unresolved: number;
  duplicate: number;
  total: number;
  /** True when the user must sign in to Microsoft 365 before retrying. */
  needsAuth?: boolean;
  /** Set when the call failed before counts could be produced. */
  error?: string;
}

export interface MeetingsSyncDeps {
  auth: Pick<MsGraphAuthService, 'getValidAccessToken'>;
  fetchEvents(token: string, from: string, to: string): Promise<RawEvent[]>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SETTING_DEFAULT_TASK = 'meetings.default_task_id';

function lookupTaskByNumber(db: SqliteLike, number: string): TaskRef | null {
  const row = db
    .prepare('SELECT id, number, title FROM tasks WHERE number = ? LIMIT 1')
    .get(number) as TaskRef | undefined;
  return row ?? null;
}

function loadRuleConfig(db: SqliteLike): RuleConfig {
  const lookupByNumber = (n: string) => lookupTaskByNumber(db, n);
  const defaultIdRow = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(SETTING_DEFAULT_TASK) as { value: string | null } | undefined;
  const defaultId = defaultIdRow?.value ? Number(defaultIdRow.value) : null;
  const defaultTask = defaultId
    ? ((db.prepare('SELECT id, number, title FROM tasks WHERE id = ?').get(defaultId) as
        | TaskRef
        | undefined) ?? null)
    : null;
  return {
    green100: lookupByNumber('GREEN-100'),
    green34: lookupByNumber('GREEN-34'),
    defaultTask,
    lookupByNumber,
  };
}

export class MeetingsSyncService {
  private worklogs: WorklogsRepo;

  constructor(
    private db: SqliteLike,
    private deps: MeetingsSyncDeps = {
      auth: new MsGraphAuthService(),
      fetchEvents: (token, from, to) => fetchCalendarEvents(token, from, to),
    },
  ) {
    this.worklogs = new WorklogsRepo(db);
  }

  async sync(request: MeetingsSyncRequest): Promise<MeetingsSyncResult> {
    console.log(`[meetings:sync] start ${request.from} → ${request.to}`);
    if (!ISO_DATE_RE.test(request.from) || !ISO_DATE_RE.test(request.to)) {
      return emptyResult({ ok: false, error: 'from/to must be YYYY-MM-DD' });
    }
    if (request.from > request.to) {
      return emptyResult({ ok: false, error: 'from must be on or before to' });
    }

    let token: string;
    try {
      token = await this.deps.auth.getValidAccessToken();
    } catch (err) {
      if (err instanceof NotAuthenticatedError) {
        return emptyResult({
          ok: false,
          needsAuth: true,
          error: 'Sign in to Microsoft 365 in Settings first.',
        });
      }
      return emptyResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    let events: RawEvent[];
    try {
      events = await this.deps.fetchEvents(token, request.from, request.to);
    } catch (err) {
      return emptyResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    console.log(`[meetings:sync] fetched ${events.length} events from Graph`);

    const config = loadRuleConfig(this.db);
    let logged = 0;
    let skipped = 0;
    let unresolved = 0;
    let duplicate = 0;

    for (const event of events) {
      const decision = decide(event, config);
      if (decision.status === 'skipped') {
        skipped++;
        continue;
      }
      if (decision.status === 'unresolved' || !decision.worklog) {
        unresolved++;
        continue;
      }
      const w = decision.worklog;
      if (!w.externalId) {
        unresolved++;
        continue;
      }
      try {
        this.worklogs.create({
          taskId: w.taskId,
          workDate: w.workDate,
          minutes: w.minutes,
          description: w.description,
          source: w.source,
          externalId: w.externalId,
        });
        logged++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE constraint failed/i.test(msg)) {
          duplicate++;
        } else {
          console.warn('[meetings:sync] insert failed:', msg);
          unresolved++;
        }
      }
    }

    const total = events.length;
    const summary =
      `${logged} logged, ${duplicate} duplicate, ${skipped} skipped, ` +
      `${unresolved} unresolved, ${total} total`;
    console.log(`[meetings:sync] done — ${summary}`);
    return {
      ok: unresolved === 0,
      exitCode: 0,
      summary,
      logged,
      skipped,
      unresolved,
      duplicate,
      total,
    };
  }
}

function emptyResult(
  overrides: Partial<MeetingsSyncResult> & Pick<MeetingsSyncResult, 'ok'>,
): MeetingsSyncResult {
  return {
    exitCode: null,
    summary: '',
    logged: 0,
    skipped: 0,
    unresolved: 0,
    duplicate: 0,
    total: 0,
    ...overrides,
  };
}
