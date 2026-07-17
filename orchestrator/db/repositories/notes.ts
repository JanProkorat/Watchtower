import type { SqliteLike } from '../migrations.js';
import { nowIso, newSyncId } from '../syncColumns.js';

export type NotePriority = 'none' | 'low' | 'med' | 'high';
export type NoteDone = null | 0 | 1;

export interface NoteRow {
  id: number;
  title: string;
  body: string;
  done: NoteDone;
  doneAt: string | null;
  dueDate: string | null;
  priority: NotePriority;
  pinned: boolean;
  projectId: number | null;
  projectName: string | null;
  projectColor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  title?: string;
  body?: string;
  done?: NoteDone;
  dueDate?: string | null;
  priority?: NotePriority;
  pinned?: boolean;
  projectId?: number | null;
}

export interface NoteListFilter {
  scope?: 'all' | 'global' | 'project';
  projectId?: number;
  search?: string;
  openTodosOnly?: boolean;
  dueSoon?: boolean;
  includeCompleted?: boolean;
}

type DbRow = {
  id: number;
  title: string;
  body: string;
  done: number | null;
  done_at: string | null;
  due_date: string | null;
  priority: NotePriority;
  pinned: number;
  project_id: number | null;
  project_name: string | null;
  project_color: string | null;
  created_at: string;
  updated_at: string;
};

function toRow(r: DbRow): NoteRow {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    done: (r.done === null ? null : r.done === 1 ? 1 : 0),
    doneAt: r.done_at,
    dueDate: r.due_date,
    priority: r.priority,
    pinned: r.pinned === 1,
    projectId: r.project_id,
    projectName: r.project_name,
    projectColor: r.project_color,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// LEFT JOIN so Global notes (project_id NULL) and notes whose project was
// soft-deleted both surface with null project name/color.
const LIST_SQL = `
  SELECT
    n.id, n.title, n.body, n.done, n.done_at, n.due_date, n.priority, n.pinned,
    n.project_id, p.name AS project_name, p.color AS project_color,
    n.created_at, n.updated_at
  FROM notes n
  LEFT JOIN projects p ON p.id = n.project_id AND p.deleted_at IS NULL
`;

// priority rank for ORDER BY (high first).
const PRIORITY_RANK = `CASE n.priority WHEN 'high' THEN 3 WHEN 'med' THEN 2 WHEN 'low' THEN 1 ELSE 0 END`;

export class NotesRepo {
  constructor(private db: SqliteLike) {}

  list(filter: NoteListFilter = {}): NoteRow[] {
    const where: string[] = ['n.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filter.scope === 'global') where.push('n.project_id IS NULL');
    if (filter.scope === 'project' && filter.projectId !== undefined) {
      where.push('n.project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.openTodosOnly) where.push('n.done = 0');
    if (filter.includeCompleted === false) where.push('(n.done IS NULL OR n.done = 0)');
    if (filter.dueSoon) {
      where.push("(n.done IS NULL OR n.done != 1) AND n.due_date IS NOT NULL AND n.due_date <= date('now', '+3 days')");
    }
    if (filter.search && filter.search.trim()) {
      where.push("(LOWER(n.title) LIKE '%' || LOWER(?) || '%' OR LOWER(n.body) LIKE '%' || LOWER(?) || '%')");
      params.push(filter.search.trim(), filter.search.trim());
    }

    const sql =
      LIST_SQL +
      ` WHERE ${where.join(' AND ')}` +
      // Completed todos sink; then pinned first; then priority; then due date
      // (nulls last); then most-recently-updated.
      ` ORDER BY (CASE WHEN n.done = 1 THEN 1 ELSE 0 END) ASC,
                 n.pinned DESC,
                 ${PRIORITY_RANK} DESC,
                 (n.due_date IS NULL) ASC, n.due_date ASC,
                 n.updated_at DESC, n.id DESC`;

    return (this.db.prepare(sql).all(...params) as DbRow[]).map(toRow);
  }

  get(id: number): NoteRow | null {
    const row = this.db.prepare(LIST_SQL + ' WHERE n.id = ? AND n.deleted_at IS NULL').get(id) as DbRow | undefined;
    return row ? toRow(row) : null;
  }

  create(input: NoteInput): NoteRow {
    const done = input.done === undefined ? null : input.done;
    const doneAt = done === 1 ? nowIso() : null;
    const ts = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO notes (title, body, done, done_at, due_date, priority, pinned, project_id, created_at, sync_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.title ?? '',
        input.body ?? '',
        done,
        doneAt,
        input.dueDate ?? null,
        input.priority ?? 'none',
        input.pinned ? 1 : 0,
        input.projectId ?? null,
        ts,
        newSyncId(),
        ts,
      ) as { lastInsertRowid: number | bigint };
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, input: Partial<NoteInput>): NoteRow {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown) => {
      sets.push(`${col} = ?`);
      params.push(value);
    };

    if (input.title !== undefined) push('title', input.title);
    if (input.body !== undefined) push('body', input.body);
    if (input.done !== undefined) {
      push('done', input.done);
      // done_at is set when transitioning to completed, cleared otherwise.
      push('done_at', input.done === 1 ? nowIso() : null);
    }
    if (input.dueDate !== undefined) push('due_date', input.dueDate);
    if (input.priority !== undefined) push('priority', input.priority);
    if (input.pinned !== undefined) push('pinned', input.pinned ? 1 : 0);
    if (input.projectId !== undefined) push('project_id', input.projectId);

    push('updated_at', nowIso());
    params.push(id);
    this.db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    const row = this.get(id);
    if (!row) throw new Error(`note ${id} not found after update`);
    return row;
  }

  delete(id: number): void {
    const ts = nowIso();
    this.db.prepare(`UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
  }
}
