import type { SqliteLike } from '../migrations.js';
import { nowIso, newSyncId } from '../syncColumns.js';

export type WorklogSource = 'manual' | 'watchtower-auto' | 'jira-sync' | string;

/** Settings key for the inclusive "lock through" date (ISO YYYY-MM-DD). */
export const WORKLOG_LOCK_SETTING_KEY = 'worklogs.locked_through';

/**
 * Thrown by `WorklogsRepo.create/update/delete` when the mutation would touch
 * a row whose `work_date` falls within the locked window. Mirrors the
 * structure of `RateOverlapError` so the orchestrator can convert it into
 * a tagged IPC response.
 */
export class WorklogLockedError extends Error {
  constructor(
    public readonly lockedThrough: string,
    public readonly attemptedDate: string,
  ) {
    super(
      `Worklogs on or before ${lockedThrough} are locked. Unlock in Settings to edit.`,
    );
    this.name = 'WorklogLockedError';
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface WorklogRow {
  id: number;
  taskId: number;
  description: string | null;
  workDate: string;
  minutes: number;
  reportedMinutes: number | null;
  source: WorklogSource | null;
  externalId: string | null;
  jiraUploaded: boolean;
  createdAt: string;
  // Joined fields (project / task / epic context for the list view).
  taskNumber: string;
  taskTitle: string;
  epicId: number;
  epicName: string;
  projectId: number;
  projectName: string;
  projectColor: string;
}

export interface WorklogInput {
  taskId: number;
  description?: string | null;
  workDate: string;
  minutes: number;
  reportedMinutes?: number | null;
  /** Defaults to 'manual' for new rows when omitted. */
  source?: WorklogSource | null;
  externalId?: string | null;
  jiraUploaded?: boolean;
}

export interface WorklogListFilter {
  projectId?: number;
  epicId?: number;
  taskId?: number;
  /** Inclusive lower bound (YYYY-MM-DD). */
  from?: string;
  /** Inclusive upper bound (YYYY-MM-DD). */
  to?: string;
  source?: WorklogSource;
  /** Free-text match against description, task title, task number. */
  search?: string;
}

type DbRow = {
  id: number;
  task_id: number;
  description: string | null;
  work_date: string;
  minutes: number;
  reported_minutes: number | null;
  source: string | null;
  external_id: string | null;
  jira_uploaded: number;
  created_at: string;
  task_number: string;
  task_title: string;
  epic_id: number;
  epic_name: string;
  project_id: number;
  project_name: string;
  project_color: string;
};

function toRow(r: DbRow): WorklogRow {
  return {
    id: r.id,
    taskId: r.task_id,
    description: r.description,
    workDate: r.work_date,
    minutes: r.minutes,
    reportedMinutes: r.reported_minutes,
    source: r.source,
    externalId: r.external_id,
    jiraUploaded: r.jira_uploaded === 1,
    createdAt: r.created_at,
    taskNumber: r.task_number,
    taskTitle: r.task_title,
    epicId: r.epic_id,
    epicName: r.epic_name,
    projectId: r.project_id,
    projectName: r.project_name,
    projectColor: r.project_color,
  };
}

const SELECT_JOINED = `
  SELECT
    w.id, w.task_id, w.description, w.work_date, w.minutes,
    w.reported_minutes, w.source, w.external_id, w.jira_uploaded, w.created_at,
    t.number AS task_number, t.title AS task_title,
    e.id AS epic_id, e.name AS epic_name,
    p.id AS project_id, p.name AS project_name, p.color AS project_color
  FROM worklogs w
  JOIN tasks t ON t.id = w.task_id
  JOIN epics e ON e.id = t.epic_id
  JOIN projects p ON p.id = e.project_id
`;

export class WorklogsRepo {
  constructor(private db: SqliteLike) {}

  /**
   * Returns the inclusive lock date (ISO YYYY-MM-DD) or null when no lock is
   * set. Reads directly from the `settings` table so the repo stays
   * self-contained — no SettingsRepo dependency.
   */
  lockedThrough(): string | null {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(WORKLOG_LOCK_SETTING_KEY) as { value: string | null } | undefined;
    const v = row?.value?.trim();
    return v && DATE_RE.test(v) ? v : null;
  }

  private throwIfLocked(...candidateDates: (string | null | undefined)[]): void {
    const lock = this.lockedThrough();
    if (!lock) return;
    for (const d of candidateDates) {
      if (d && d <= lock) throw new WorklogLockedError(lock, d);
    }
  }

  list(filter: WorklogListFilter = {}): WorklogRow[] {
    const where: string[] = ['w.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filter.projectId !== undefined) {
      where.push('p.id = ?');
      params.push(filter.projectId);
    }
    if (filter.epicId !== undefined) {
      where.push('e.id = ?');
      params.push(filter.epicId);
    }
    if (filter.taskId !== undefined) {
      where.push('w.task_id = ?');
      params.push(filter.taskId);
    }
    if (filter.from) {
      where.push('w.work_date >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      where.push('w.work_date <= ?');
      params.push(filter.to);
    }
    if (filter.source) {
      where.push('w.source = ?');
      params.push(filter.source);
    }
    if (filter.search && filter.search.trim()) {
      where.push(
        `(LOWER(w.description) LIKE '%' || LOWER(?) || '%'
          OR LOWER(t.title) LIKE '%' || LOWER(?) || '%'
          OR LOWER(t.number) LIKE '%' || LOWER(?) || '%')`,
      );
      const q = filter.search.trim();
      params.push(q, q, q);
    }

    const sql =
      SELECT_JOINED +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      // Newest day first, newest row within a day first — matches how the
      // prototype groups by day.
      ` ORDER BY w.work_date DESC, w.id DESC`;

    return (this.db.prepare(sql).all(...params) as DbRow[]).map(toRow);
  }

  get(id: number): WorklogRow | null {
    const row = this.db.prepare(SELECT_JOINED + ' WHERE w.id = ? AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL').get(id) as DbRow | undefined;
    return row ? toRow(row) : null;
  }

  create(input: WorklogInput): WorklogRow {
    this.throwIfLocked(input.workDate);
    // Treat undefined as "no preference, default to 'manual'", but preserve
    // an explicit null (it disables the (source, external_id) dedupe index).
    const source = input.source === undefined ? 'manual' : input.source;
    const info = this.db
      .prepare(
        `INSERT INTO worklogs
           (task_id, description, work_date, minutes, reported_minutes,
            source, external_id, jira_uploaded, sync_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.taskId,
        input.description ?? null,
        input.workDate,
        input.minutes,
        input.reportedMinutes ?? null,
        source,
        input.externalId ?? null,
        input.jiraUploaded ? 1 : 0,
        newSyncId(), nowIso(),
      ) as { lastInsertRowid: number | bigint };
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, input: Partial<WorklogInput>): WorklogRow {
    // Check both the row's current date AND the proposed new date — moving a
    // row into or out of the locked window counts as a mutation either way.
    const existing = this.get(id);
    this.throwIfLocked(existing?.workDate, input.workDate);

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown) => {
      sets.push(`${col} = ?`);
      params.push(value);
    };
    if (input.taskId !== undefined) push('task_id', input.taskId);
    if (input.description !== undefined) push('description', input.description);
    if (input.workDate !== undefined) push('work_date', input.workDate);
    if (input.minutes !== undefined) push('minutes', input.minutes);
    if (input.reportedMinutes !== undefined) push('reported_minutes', input.reportedMinutes);
    // source / external_id are deliberately NOT updatable on edit so the
    // origin of the worklog stays accurate (Jira-sourced rows can't be
    // re-labelled as manual). To re-import, delete + recreate.
    if (input.jiraUploaded !== undefined) push('jira_uploaded', input.jiraUploaded ? 1 : 0);
    push('updated_at', nowIso());

    if (sets.length > 0) {
      params.push(id);
      this.db.prepare(`UPDATE worklogs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    const row = this.get(id);
    if (!row) throw new Error(`worklog ${id} not found after update`);
    return row;
  }

  delete(id: number): void {
    const existing = this.get(id);
    this.throwIfLocked(existing?.workDate);
    const ts = nowIso();
    this.db.prepare(`UPDATE worklogs SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
  }
}
